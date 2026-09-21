/**
 * REW-102: route-level CSRF protection on
 * POST /meal-plans/:id/recipes/:recipeId/remove.
 *
 * The global csrfProtectionExceptMultipart wrapper in src/app.js skips token
 * validation for any multipart/form-data body, and this handler reads NO body
 * fields at all (only req.params.id, req.params.recipeId, req.user.id and
 * req.accessToken), so without a route-level csrfProtection a forged cross-site
 * multipart POST reaches the handler and deletes the victim's meal_plan_recipes
 * row. Its cookbook twin (POST /cookbooks/:id/recipes/:recipeId/remove) reads
 * req.body.returnTo and is therefore stopped today only by the TypeError that
 * an unparsed body throws -- an accident, not a control, which is exactly why
 * this route needed the explicit check.
 *
 * Same structure as mealPlanDeleteRoutes.test.js (REW-105): pin the route's
 * middleware chain, then drive the route's REAL middleware slice over HTTP.
 *
 * Harness notes:
 * - Listens on 127.0.0.1 port 0 (ephemeral TCP), never a /tmp unix socket
 *   (REW-90 / REW-98), and skips rather than fails if the sandbox forbids
 *   listeners.
 * - Includes a CONTROL case (withRouteCsrf: false) that mounts the PRE-FIX
 *   chain (the real limiter with csrfProtection filtered out) and proves the
 *   same forged request DOES reach the handler, so the rejection cases cannot
 *   pass vacuously and the limiter is documented as not being a CSRF control.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { default: router } = await import("./mealPlanRoutes.js");
const { csrfProtection, csrfProtectionExceptMultipart, generateCsrfToken } = await import(
  "../middleware/csrfMiddleware.js"
);

const MEAL_PLAN_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const RECIPE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const ROUTE_PATH = "/:id/recipes/:recipeId/remove";
const REMOVE_PATH = `/meal-plans/${MEAL_PLAN_ID}/recipes/${RECIPE_ID}/remove`;
const BOUNDARY = "rew102boundary";
const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`;
const URLENCODED = "application/x-www-form-urlencoded";

function findRemoveLayer() {
  return router.stack.find(
    (entry) => entry.route?.path === ROUTE_PATH && entry.route?.methods?.post
  );
}

function removeRouteHandles() {
  const layer = findRemoveLayer();
  assert.ok(layer, "POST /meal-plans/:id/recipes/:recipeId/remove should be registered");
  return layer.route.stack.map((entry) => entry.handle);
}

// express-rate-limit exposes an anonymous middleware, so it is identified by
// the instance methods it carries rather than by name or stack position.
const isRateLimiter = (handle) =>
  typeof handle.resetKey === "function" && typeof handle.getKey === "function";

// ---------------------------------------------------------------------------
// Test 1: chain shape (no HTTP)
// ---------------------------------------------------------------------------

test("POST /meal-plans/:id/recipes/:recipeId/remove is mounted as requireAuth -> csrfProtection -> mealPlanLimiter -> handler", () => {
  const layer = findRemoveLayer();
  assert.ok(layer, "POST /meal-plans/:id/recipes/:recipeId/remove should be registered");
  assert.equal(layer.route.methods.get, undefined, "the remove route must be POST-only");
  assert.equal(layer.route.methods.delete, undefined, "the remove route must be POST-only");

  const handles = layer.route.stack.map((entry) => entry.handle);

  assert.equal(
    handles.length,
    4,
    "chain should be exactly requireAuth + csrfProtection + mealPlanLimiter + handler"
  );

  assert.equal(handles[0].name, "requireAuth", "requireAuth must run first");

  // The global csrfProtectionExceptMultipart skips multipart bodies, so this
  // destructive route must carry its own unconditional CSRF check. It must be
  // the exact export from csrfMiddleware.js (not a look-alike, and never
  // csrfProtectionExceptMultipart, which is the bypass being closed) and it
  // must sit directly after auth.
  const csrfIndex = handles.indexOf(csrfProtection);
  assert.equal(
    csrfIndex,
    1,
    "csrfProtection (the exact export from csrfMiddleware.js) must run directly after requireAuth, not be left to the global multipart-exempt wrapper"
  );
  assert.ok(
    !handles.includes(csrfProtectionExceptMultipart),
    "the multipart-exempt wrapper must never be the route-level check"
  );

  // mealPlanLimiter already existed on this route; its position is asserted
  // unconditionally. It must come AFTER csrfProtection.
  const limiterIndex = handles.findIndex(isRateLimiter);
  assert.equal(
    limiterIndex,
    2,
    "mealPlanLimiter must run directly after csrfProtection: CSRF must run before the limiter so a forged cross-site request cannot burn the victim's limiter quota"
  );

  const terminal = handles[3];
  assert.notEqual(terminal, csrfProtection, "index 3 must be the terminal handler, not csrfProtection");
  assert.ok(!isRateLimiter(terminal), "index 3 must be the terminal handler, not a rate limiter");
  assert.ok(csrfIndex < 3, "csrfProtection must run before the terminal handler");
});

// ---------------------------------------------------------------------------
// HTTP harness
// ---------------------------------------------------------------------------

function stubAuth(req, _res, next) {
  req.user = { id: "owner-1" };
  req.accessToken = "token";
  next();
}

/**
 * Assemble an app that mirrors app.js (cookie-parser, json, urlencoded, then
 * the global csrfProtectionExceptMultipart wrapper) and mounts the remove
 * route's REAL middleware slice between a stubbed auth and a spy handler.
 *
 * stubAuth must run before the slice because mealPlanLimiter keys on
 * req.user?.id.
 */
function buildHarness({ withRouteCsrf = true } = {}) {
  const app = express();
  const calls = [];

  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(csrfProtectionExceptMultipart);

  app.get("/token", (req, res) => res.send(generateCsrfToken(req, res)));

  // Everything between requireAuth and the terminal handler, taken from the
  // router's own stack. After the fix this is exactly
  // [csrfProtection, mealPlanLimiter].
  const realSlice = removeRouteHandles().slice(1, -1);
  assert.ok(
    realSlice.includes(csrfProtection),
    "the harness must mount the route's real csrfProtection slice, never an empty one"
  );
  assert.ok(
    realSlice.some(isRateLimiter),
    "the harness must mount the route's real rate limiter; the slice must not silently lose it"
  );

  // withRouteCsrf: false mounts the PRE-FIX chain: the real limiter with
  // csrfProtection filtered out (not an empty slice), so the control case
  // proves the limiter alone is not a CSRF control.
  const slice = withRouteCsrf
    ? realSlice
    : realSlice.filter((handle) => handle !== csrfProtection);
  if (!withRouteCsrf) {
    assert.ok(!slice.includes(csrfProtection), "CONTROL: csrfProtection must be filtered out of the pre-fix chain");
    assert.ok(slice.some(isRateLimiter), "CONTROL: the pre-fix chain must still include mealPlanLimiter");
  }

  const chain = [stubAuth, ...slice];
  chain.push((req, res) => {
    calls.push({ id: req.params.id, recipeId: req.params.recipeId });
    res.sendStatus(204);
  });
  app.post("/meal-plans/:id/recipes/:recipeId/remove", ...chain);

  app.use((err, _req, res, _next) => res.sendStatus(err.code === "EBADCSRFTOKEN" ? 403 : 500));

  return { app, calls };
}

async function withServer(app, run, t) {
  const server = http.createServer(app);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      t.skip(`sandbox forbids local TCP listeners (${error.code})`);
      return;
    }
    throw error;
  }
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function request(base, { path, method = "GET", headers = {}, body = "" }) {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })
        );
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function csrfSession(base) {
  const res = await request(base, { path: "/token" });
  assert.equal(res.status, 200, "GET /token should issue a csrf token");
  const cookie = (res.headers["set-cookie"] ?? []).map((value) => value.split(";")[0]).join("; ");
  assert.ok(res.body, "a csrf token should be issued");
  assert.ok(cookie.includes("csrf-token="), "the csrf-token cookie should be set");
  return { token: res.body, cookie };
}

function multipartBody(parts) {
  const segments = Object.entries(parts).map(
    ([name, value]) => `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  );
  return `${segments.join("")}--${BOUNDARY}--\r\n`;
}

const postRemove = (base, { contentType, cookie, body }) =>
  request(base, {
    path: REMOVE_PATH,
    method: "POST",
    headers: { "content-type": contentType, ...(cookie ? { cookie } : {}) },
    body,
  });

// ---------------------------------------------------------------------------
// Tests 2-7: HTTP-level, through the real middleware slice
// ---------------------------------------------------------------------------

test("a forged multipart POST with no token is rejected before the handler, with or without the victim's csrf cookie", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { cookie } = await csrfSession(base);
    const body = multipartBody({ ignored: "1" });

    const withCookie = await postRemove(base, { contentType: MULTIPART, cookie, body });
    assert.equal(withCookie.status, 403, "multipart POST with the victim's cookie but no token must be 403");
    assert.equal(calls.length, 0, "the remove handler must not run for a forged multipart POST carrying the victim's cookie");

    const withoutCookie = await postRemove(base, { contentType: MULTIPART, body });
    assert.equal(withoutCookie.status, 403, "multipart POST with no cookie and no token must be 403");
    assert.equal(calls.length, 0, "the remove handler must not run for a forged multipart POST with no cookie");
  }, t);
});

test("harness control: with only mealPlanLimiter mounted (the pre-fix chain) the same forged multipart POST reaches the handler", async (t) => {
  const { app, calls } = buildHarness({ withRouteCsrf: false });
  await withServer(app, async (base) => {
    const { cookie } = await csrfSession(base);
    const res = await postRemove(base, { contentType: MULTIPART, cookie, body: multipartBody({ ignored: "1" }) });

    // CONTROL CASE. This is expected to succeed. It mounts the pre-fix chain
    // (requireAuth -> mealPlanLimiter -> handler) and proves the global
    // csrfProtectionExceptMultipart wrapper plus the limiter let a multipart
    // POST through, so the rejection cases in this file are not passing for
    // some unrelated harness reason, and the limiter is not a CSRF control.
    // Do not "fix" this by making it 403.
    assert.equal(
      res.status,
      204,
      "CONTROL: with route-level csrfProtection removed and only mealPlanLimiter in place, the forged multipart POST must reach the handler (otherwise the rejection tests are vacuous)"
    );
    assert.equal(calls.length, 1, "CONTROL: the handler must run exactly once when the route-level check is absent");
  }, t);
});

test("a urlencoded POST with no _csrf is rejected before the handler", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { cookie } = await csrfSession(base);
    const res = await postRemove(base, { contentType: URLENCODED, cookie, body: "ignored=1" });
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0, "the remove handler must not run when _csrf is missing");
  }, t);
});

test("a urlencoded POST with an invalid _csrf (tampered, or from another session) is rejected before the handler", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const first = await csrfSession(base);

    // (i) the real token with one character altered
    const tampered = (first.token[0] === "a" ? "b" : "a") + first.token.slice(1);
    assert.notEqual(tampered, first.token);
    const tamperedRes = await postRemove(base, {
      contentType: URLENCODED,
      cookie: first.cookie,
      body: new URLSearchParams({ _csrf: tampered }).toString(),
    });
    assert.equal(tamperedRes.status, 403, "a tampered token must be 403");
    assert.equal(calls.length, 0, "the remove handler must not run for a tampered token");

    // (ii) a token issued for a second session, sent with the first session's cookie
    const second = await csrfSession(base);
    assert.notEqual(second.token, first.token, "the second session should get its own token");
    const crossRes = await postRemove(base, {
      contentType: URLENCODED,
      cookie: first.cookie,
      body: new URLSearchParams({ _csrf: second.token }).toString(),
    });
    assert.equal(crossRes.status, 403, "a token from another session must be 403");
    assert.equal(calls.length, 0, "the remove handler must not run for a cross-session token");
  }, t);
});

test("a urlencoded POST with a valid _csrf reaches the handler exactly once, with both route params intact", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { token, cookie } = await csrfSession(base);
    const res = await postRemove(base, {
      contentType: URLENCODED,
      cookie,
      body: new URLSearchParams({ _csrf: token }).toString(),
    });
    assert.equal(res.status, 204, "a valid urlencoded token must reach the handler");
    assert.equal(calls.length, 1, "the remove handler must run exactly once");
    assert.equal(calls[0].id, MEAL_PLAN_ID);
    assert.equal(calls[0].recipeId, RECIPE_ID);
  }, t);
});

test("a multipart POST is rejected even when it carries a valid _csrf part (no Multer stage on this route)", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { token, cookie } = await csrfSession(base);
    // Nothing on this route parses multipart bodies, so a _csrf part is
    // invisible to csrf-csrf and the request is rejected. The Remove form in
    // views/partials/recipe-summary-card.ejs posts urlencoded, so this is
    // correct - and it pins the absence of a Multer / .none() stage on the
    // route so one cannot be added silently.
    const res = await postRemove(base, { contentType: MULTIPART, cookie, body: multipartBody({ _csrf: token }) });
    assert.equal(res.status, 403, "multipart must be rejected even with a valid _csrf part");
    assert.equal(calls.length, 0, "the remove handler must not run for a multipart body");
  }, t);
});

// ---------------------------------------------------------------------------
// Test 8: forged requests do not burn the victim's limiter quota
// ---------------------------------------------------------------------------

test("forged multipart POSTs do not consume the victim's mealPlanLimiter quota (csrfProtection runs before the limiter)", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { token, cookie } = await csrfSession(base);

    // csrf-csrf tokens are reusable within a session, so the same token and
    // cookie serve both valid requests.
    const validRequest = () =>
      postRemove(base, {
        contentType: URLENCODED,
        cookie,
        body: new URLSearchParams({ _csrf: token }).toString(),
      });

    // express-rate-limit 8.x with standardHeaders: true emits the draft-6
    // RateLimit-Remaining header (legacyHeaders: false, so no X-RateLimit-*).
    // Relative deltas are used because mealPlanLimiter is a module-level
    // singleton whose in-memory store persists across the tests in this file.
    const remaining = (res) => {
      const raw = res.headers["ratelimit-remaining"];
      const value = Number(raw);
      assert.ok(Number.isFinite(value), `expected a numeric RateLimit-Remaining header, got ${JSON.stringify(raw)}`);
      return value;
    };

    const first = await validRequest();
    assert.equal(first.status, 204, "the first valid request must reach the handler");
    assert.equal(calls.length, 1);
    const r1 = remaining(first);

    const forgedBody = multipartBody({ ignored: "1" });
    for (let i = 1; i <= 3; i += 1) {
      const forged = await postRemove(base, { contentType: MULTIPART, cookie, body: forgedBody });
      assert.equal(forged.status, 403, `forged multipart request #${i} must be 403`);
      assert.equal(
        forged.headers["ratelimit-remaining"],
        undefined,
        `forged multipart request #${i} must be rejected by csrfProtection before it reaches mealPlanLimiter, so it must carry no RateLimit-* headers`
      );
    }
    assert.equal(calls.length, 1, "the remove handler must not run for any of the forged requests");

    const second = await validRequest();
    assert.equal(second.status, 204, "the second valid request must still reach the handler");
    assert.equal(calls.length, 2);
    const r2 = remaining(second);

    assert.equal(
      r2,
      r1 - 1,
      `the three forged requests must consume no quota: expected RateLimit-Remaining ${r1 - 1} after one more valid request, got ${r2}`
    );
  }, t);
});
