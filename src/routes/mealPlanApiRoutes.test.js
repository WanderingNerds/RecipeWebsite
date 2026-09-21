/**
 * REW-102: route-level CSRF protection on
 * POST /api/meal-plans/:id/recipes/:recipeId, and the middleware contract of
 * the two sibling mutations this router exposes.
 *
 * No test file existed for this router before. The global
 * csrfProtectionExceptMultipart wrapper in src/app.js skips token validation
 * for any multipart/form-data body, and the add-recipe handler reads no body
 * fields (only its two route params and the caller's identity), so without a
 * route-level csrfProtection a forged cross-site multipart POST reaches it and
 * upserts a meal_plan_recipes row on the victim's behalf. Its already-protected
 * twin, POST /api/cookbooks/:id/recipes/:recipeId, made this a straight
 * inconsistency rather than a new policy decision.
 *
 * Chain assertions compare against the EXACT csrfProtection export rather than
 * matching a function name, so a re-wrapped or renamed look-alike (in
 * particular csrfProtectionExceptMultipart, the bypass being closed) cannot
 * satisfy them. The HTTP cases drive the route's REAL middleware slice and
 * include a control case, so they cannot pass vacuously.
 *
 * Harness notes: listens on 127.0.0.1 port 0 (ephemeral TCP), never a /tmp unix
 * socket (REW-90 / REW-98), and skips rather than fails where the sandbox
 * forbids listeners.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { default: router } = await import("./mealPlanApiRoutes.js");
const { csrfProtection, csrfProtectionExceptMultipart, generateCsrfToken } = await import(
  "../middleware/csrfMiddleware.js"
);

const MEAL_PLAN_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const RECIPE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const MEMBER_ROUTE = "/:id/recipes/:recipeId";
const ADD_PATH = `/api/meal-plans/${MEAL_PLAN_ID}/recipes/${RECIPE_ID}`;
const BOUNDARY = "rew102mealplanapiboundary";
const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`;

function findLayer(path, method) {
  return router.stack.find(
    (entry) => entry.route?.path === path && entry.route?.methods?.[method]
  );
}

function handlesFor(path, method) {
  const layer = findLayer(path, method);
  assert.ok(layer, `${method.toUpperCase()} ${path} should be registered`);
  return layer.route.stack.map((entry) => entry.handle);
}

// express-rate-limit exposes an anonymous middleware, so it is identified by
// the instance methods it carries rather than by name or stack position.
const isRateLimiter = (handle) =>
  typeof handle.resetKey === "function" && typeof handle.getKey === "function";

// ---------------------------------------------------------------------------
// Chain shape (no HTTP)
// ---------------------------------------------------------------------------

test("every meal plan API route authenticates first and is rate limited", () => {
  const MUTATIONS = [
    ["/", "post"],
    [MEMBER_ROUTE, "post"],
    [MEMBER_ROUTE, "delete"],
  ];

  // Unlike likeRoutes.js there is no public read here: meal plans have no
  // shared/anonymous read at all, so GET / authenticates too.
  const readHandles = handlesFor("/", "get");
  assert.equal(readHandles[0].name, "requireApiAuth", "GET /api/meal-plans must authenticate");

  for (const [path, method] of MUTATIONS) {
    const handles = handlesFor(path, method);
    const label = `${method.toUpperCase()} ${path}`;
    assert.equal(handles[0].name, "requireApiAuth", `${label} must authenticate first`);
    assert.ok(handles.findIndex(isRateLimiter) > -1, `${label} must be rate limited`);
  }
});

test("POST /api/meal-plans/:id/recipes/:recipeId is mounted as requireApiAuth -> csrfProtection -> mealPlanApiLimiter -> handler", () => {
  const handles = handlesFor(MEMBER_ROUTE, "post");

  assert.equal(
    handles.length,
    4,
    "chain should be exactly requireApiAuth + csrfProtection + mealPlanApiLimiter + handler"
  );
  assert.equal(handles[0].name, "requireApiAuth", "requireApiAuth must authenticate first");

  const csrfIndex = handles.indexOf(csrfProtection);
  assert.equal(
    csrfIndex,
    1,
    "csrfProtection (the exact export from csrfMiddleware.js) must run directly after requireApiAuth, not be left to the global multipart-exempt wrapper"
  );
  assert.ok(
    !handles.includes(csrfProtectionExceptMultipart),
    "the multipart-exempt wrapper must never be the route-level check"
  );

  const limiterIndex = handles.findIndex(isRateLimiter);
  assert.equal(
    limiterIndex,
    2,
    "mealPlanApiLimiter must run directly after csrfProtection: CSRF must run before the limiter so a forged cross-site request cannot burn the victim's quota"
  );

  const terminal = handles[3];
  assert.notEqual(terminal, csrfProtection, "index 3 must be the terminal handler, not csrfProtection");
  assert.ok(!isRateLimiter(terminal), "index 3 must be the terminal handler, not a rate limiter");
});

test("POST /api/meal-plans and DELETE /api/meal-plans/:id/recipes/:recipeId are deliberately left unchanged by REW-102", () => {
  // Recorded, not fixed, with the reason:
  // - POST / reads req.body and hands it to validateMealPlanTitle /
  //   validateDateRange before any write, so an unparsed (undefined) or empty
  //   body is rejected with 400 rather than mutating anything.
  // - An HTML form can only emit GET or POST, and a cross-origin fetch with
  //   method DELETE is preflighted and rejected by the CORS origin allow-list
  //   in app.js, so the multipart-bypass vector cannot reach that verb at all.
  // Both are REW-99's call when the global wrapper itself is fixed. If either
  // gains csrfProtection later, update the audit in docs/api/README.md too.
  const createHandles = handlesFor("/", "post");
  assert.ok(
    !createHandles.includes(csrfProtection),
    "POST /api/meal-plans is out of scope for REW-102 (its body is validated before any write)"
  );

  const deleteHandles = handlesFor(MEMBER_ROUTE, "delete");
  assert.ok(
    !deleteHandles.includes(csrfProtection),
    "DELETE /api/meal-plans/:id/recipes/:recipeId is out of scope for REW-102 (not form-forgeable; CORS blocks a cross-origin DELETE)"
  );
});

// ---------------------------------------------------------------------------
// HTTP harness: the route's real middleware slice
// ---------------------------------------------------------------------------

function stubAuth(req, _res, next) {
  req.user = { id: "owner-1" };
  req.accessToken = "token";
  next();
}

/**
 * Mirrors app.js (cookie-parser, json, urlencoded, then the global
 * csrfProtectionExceptMultipart wrapper) and mounts the add-recipe route's REAL
 * middleware slice between a stubbed auth and a spy handler. stubAuth runs
 * first because mealPlanApiLimiter keys on req.user?.id.
 */
function buildHarness({ withRouteCsrf = true } = {}) {
  const app = express();
  const calls = [];

  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(csrfProtectionExceptMultipart);

  app.get("/token", (req, res) => res.send(generateCsrfToken(req, res)));

  // Everything between requireApiAuth and the terminal handler, taken from the
  // router's own stack: after the fix, exactly
  // [csrfProtection, mealPlanApiLimiter].
  const realSlice = handlesFor(MEMBER_ROUTE, "post").slice(1, -1);
  assert.ok(
    realSlice.includes(csrfProtection),
    "the harness must mount the route's real csrfProtection slice, never an empty one"
  );
  assert.ok(
    realSlice.some(isRateLimiter),
    "the harness must mount the route's real rate limiter; the slice must not silently lose it"
  );

  const slice = withRouteCsrf
    ? realSlice
    : realSlice.filter((handle) => handle !== csrfProtection);
  if (!withRouteCsrf) {
    assert.ok(!slice.includes(csrfProtection), "CONTROL: csrfProtection must be filtered out of the pre-fix chain");
    assert.ok(slice.some(isRateLimiter), "CONTROL: the pre-fix chain must still include mealPlanApiLimiter");
  }

  app.post("/api/meal-plans/:id/recipes/:recipeId", stubAuth, ...slice, (req, res) => {
    calls.push({ id: req.params.id, recipeId: req.params.recipeId });
    res.sendStatus(204);
  });

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

const postAdd = (base, { headers, body = "" }) =>
  request(base, { path: ADD_PATH, method: "POST", headers, body });

test("a forged multipart POST with no token is rejected before the handler", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { cookie } = await csrfSession(base);
    const body = multipartBody({ ignored: "1" });

    const withCookie = await postAdd(base, { headers: { "content-type": MULTIPART, cookie }, body });
    assert.equal(withCookie.status, 403, "multipart POST with the victim's cookie but no token must be 403");
    assert.equal(calls.length, 0, "the add handler must not run for a forged multipart POST");

    const withoutCookie = await postAdd(base, { headers: { "content-type": MULTIPART }, body });
    assert.equal(withoutCookie.status, 403, "multipart POST with no cookie and no token must be 403");
    assert.equal(calls.length, 0, "the add handler must not run for a forged multipart POST with no cookie");
  }, t);
});

test("harness control: with only mealPlanApiLimiter mounted (the pre-fix chain) the same forged multipart POST reaches the handler", async (t) => {
  const { app, calls } = buildHarness({ withRouteCsrf: false });
  await withServer(app, async (base) => {
    const { cookie } = await csrfSession(base);
    const res = await postAdd(base, {
      headers: { "content-type": MULTIPART, cookie },
      body: multipartBody({ ignored: "1" }),
    });

    // CONTROL CASE, expected to succeed: it mounts the pre-fix chain
    // (requireApiAuth -> mealPlanApiLimiter -> handler) and proves the global
    // multipart-exempt wrapper plus the limiter let the forged POST through.
    // Without this, the 403 assertions above could pass for unrelated reasons.
    // Do not "fix" this by making it 403.
    assert.equal(
      res.status,
      204,
      "CONTROL: with route-level csrfProtection removed, the forged multipart POST must reach the handler (otherwise the rejection tests are vacuous)"
    );
    assert.equal(calls.length, 1, "CONTROL: the handler must run exactly once when the route-level check is absent");
  }, t);
});

test("the browser client's x-csrf-token header (the only real caller) still reaches the handler", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { token, cookie } = await csrfSession(base);

    // public/js/meal-plans.js calls fetch on this path with method POST and no
    // body (lines 241 and 298); public/js/main.js patches window.fetch to
    // attach x-csrf-token from <meta name="csrf-token">, and csrfMiddleware.js
    // reads that header as an alternative to req.body._csrf. This is the exact
    // shape of the production request, so the fix is transparent to the
    // "+ Meal Plan" modal.
    const res = await postAdd(base, {
      headers: { "content-type": "application/json", cookie, "x-csrf-token": token },
    });
    assert.equal(res.status, 204, "a valid x-csrf-token header must reach the handler");
    assert.equal(calls.length, 1, "the add handler must run exactly once");
    assert.equal(calls[0].id, MEAL_PLAN_ID);
    assert.equal(calls[0].recipeId, RECIPE_ID);
  }, t);
});

test("a fetch-shaped POST with no token, or a tampered one, is rejected before the handler", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { token, cookie } = await csrfSession(base);

    const missing = await postAdd(base, { headers: { "content-type": "application/json", cookie } });
    assert.equal(missing.status, 403, "a fetch without x-csrf-token must be 403");

    const tampered = (token[0] === "a" ? "b" : "a") + token.slice(1);
    const tamperedRes = await postAdd(base, {
      headers: { "content-type": "application/json", cookie, "x-csrf-token": tampered },
    });
    assert.equal(tamperedRes.status, 403, "a tampered x-csrf-token must be 403");

    assert.equal(calls.length, 0, "the add handler must not run for either rejected request");
  }, t);
});
