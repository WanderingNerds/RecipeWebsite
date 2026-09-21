/**
 * REW-102: route-level CSRF protection on POST /api/likes/:recipeId, plus the
 * surrounding contract this router must keep (public GET, untouched DELETE).
 *
 * The global csrfProtectionExceptMultipart wrapper in src/app.js skips token
 * validation for any multipart/form-data body, and the like handler reads no
 * body fields (only req.params.recipeId and the caller's identity), so without
 * a route-level csrfProtection a forged cross-site multipart POST reaches the
 * handler and favorites a published recipe as the victim. Additive and
 * reversible, hence Tier 2 in the REW-102 audit, but the same defect class as
 * the deletes fixed by REW-101 / REW-105.
 *
 * The chain assertions compare against the EXACT csrfProtection export rather
 * than matching a function name, so a re-wrapped or renamed look-alike (in
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

const { default: router } = await import("./likeRoutes.js");
const { csrfProtection, csrfProtectionExceptMultipart, generateCsrfToken } = await import(
  "../middleware/csrfMiddleware.js"
);

const RECIPE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const LIKE_PATH = `/api/likes/${RECIPE_ID}`;
const BOUNDARY = "rew102likeboundary";
const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`;

function findLayer(method) {
  return router.stack.find(
    (entry) => entry.route?.path === "/:recipeId" && entry.route?.methods?.[method]
  );
}

function handlesFor(method) {
  const layer = findLayer(method);
  assert.ok(layer, `${method.toUpperCase()} /api/likes/:recipeId should be registered`);
  return layer.route.stack.map((entry) => entry.handle);
}

// express-rate-limit exposes an anonymous middleware, so it is identified by
// the instance methods it carries rather than by name or stack position.
const isRateLimiter = (handle) =>
  typeof handle.resetKey === "function" && typeof handle.getKey === "function";

// ---------------------------------------------------------------------------
// Chain shape (no HTTP)
// ---------------------------------------------------------------------------

test("POST /api/likes/:recipeId is mounted as requireApiAuth -> csrfProtection -> likeLimiter -> handler", () => {
  const handles = handlesFor("post");

  assert.equal(
    handles.length,
    4,
    "chain should be exactly requireApiAuth + csrfProtection + likeLimiter + handler"
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
    "likeLimiter must run directly after csrfProtection: CSRF must run before the limiter so a forged cross-site request cannot burn the victim's quota"
  );

  const terminal = handles[3];
  assert.notEqual(terminal, csrfProtection, "index 3 must be the terminal handler, not csrfProtection");
  assert.ok(!isRateLimiter(terminal), "index 3 must be the terminal handler, not a rate limiter");
});

test("GET /api/likes/:recipeId stays public: no auth, no CSRF, no limiter", () => {
  const handles = handlesFor("get");

  // The public like count is read by anonymous visitors on published recipes.
  // Adding auth or CSRF here would silently lock it down, so the shape is
  // pinned: the GET route is the handler and nothing else.
  assert.equal(handles.length, 1, "GET must be the handler alone");
  assert.ok(!handles.includes(csrfProtection), "a read-only GET must not require a CSRF token");
  assert.ok(!handles.includes(csrfProtectionExceptMultipart), "GET must carry no route-level CSRF wrapper");
  assert.notEqual(handles[0].name, "requireApiAuth", "GET must stay reachable without a session");
  assert.ok(!handles.some(isRateLimiter), "GET is unchanged by REW-102 and carries no limiter");
});

test("DELETE /api/likes/:recipeId is deliberately left unchanged by REW-102", () => {
  const handles = handlesFor("delete");

  // Recorded, not fixed. An HTML form can only emit GET or POST, and a
  // cross-origin fetch with method DELETE is preflighted and rejected by the
  // CORS origin allow-list in app.js, so the multipart-bypass vector cannot
  // reach this verb at all. Adding csrfProtection here would be unverifiable
  // scope creep; it is REW-99's call when the global wrapper is fixed.
  assert.equal(handles[0].name, "requireApiAuth", "DELETE must still authenticate first");
  assert.ok(handles.some(isRateLimiter), "DELETE must still be rate limited");
  assert.ok(
    !handles.includes(csrfProtection),
    "DELETE is out of scope for REW-102: if this ever changes, update the audit in docs/api/README.md too"
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
 * csrfProtectionExceptMultipart wrapper) and mounts the like route's REAL
 * middleware slice between a stubbed auth and a spy handler. stubAuth runs
 * first because likeLimiter keys on req.user?.id.
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
  // router's own stack: after the fix, exactly [csrfProtection, likeLimiter].
  const realSlice = handlesFor("post").slice(1, -1);
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
    assert.ok(slice.some(isRateLimiter), "CONTROL: the pre-fix chain must still include likeLimiter");
  }

  app.post("/api/likes/:recipeId", stubAuth, ...slice, (req, res) => {
    calls.push({ recipeId: req.params.recipeId });
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

const postLike = (base, { headers, body = "" }) =>
  request(base, { path: LIKE_PATH, method: "POST", headers, body });

test("a forged multipart POST with no token is rejected before the handler", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { cookie } = await csrfSession(base);
    const body = multipartBody({ ignored: "1" });

    const withCookie = await postLike(base, {
      headers: { "content-type": MULTIPART, cookie },
      body,
    });
    assert.equal(withCookie.status, 403, "multipart POST with the victim's cookie but no token must be 403");
    assert.equal(calls.length, 0, "the like handler must not run for a forged multipart POST");

    const withoutCookie = await postLike(base, { headers: { "content-type": MULTIPART }, body });
    assert.equal(withoutCookie.status, 403, "multipart POST with no cookie and no token must be 403");
    assert.equal(calls.length, 0, "the like handler must not run for a forged multipart POST with no cookie");
  }, t);
});

test("harness control: with only likeLimiter mounted (the pre-fix chain) the same forged multipart POST reaches the handler", async (t) => {
  const { app, calls } = buildHarness({ withRouteCsrf: false });
  await withServer(app, async (base) => {
    const { cookie } = await csrfSession(base);
    const res = await postLike(base, {
      headers: { "content-type": MULTIPART, cookie },
      body: multipartBody({ ignored: "1" }),
    });

    // CONTROL CASE, expected to succeed: it mounts the pre-fix chain
    // (requireApiAuth -> likeLimiter -> handler) and proves the global
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

    // public/js/likes.js calls fetch("/api/likes/:id", { method: "POST" }) with
    // no body; public/js/main.js patches window.fetch to attach x-csrf-token
    // from <meta name="csrf-token">, and csrfMiddleware.js reads that header as
    // an alternative to req.body._csrf. This is the exact shape of the
    // production request, so the fix is transparent to the like button.
    const res = await postLike(base, {
      headers: { "content-type": "application/json", cookie, "x-csrf-token": token },
    });
    assert.equal(res.status, 204, "a valid x-csrf-token header must reach the handler");
    assert.equal(calls.length, 1, "the like handler must run exactly once");
    assert.equal(calls[0].recipeId, RECIPE_ID);
  }, t);
});

test("a fetch-shaped POST with no token, or a tampered one, is rejected before the handler", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { token, cookie } = await csrfSession(base);

    const missing = await postLike(base, { headers: { "content-type": "application/json", cookie } });
    assert.equal(missing.status, 403, "a fetch without x-csrf-token must be 403");

    const tampered = (token[0] === "a" ? "b" : "a") + token.slice(1);
    const tamperedRes = await postLike(base, {
      headers: { "content-type": "application/json", cookie, "x-csrf-token": tampered },
    });
    assert.equal(tamperedRes.status, 403, "a tampered x-csrf-token must be 403");

    assert.equal(calls.length, 0, "the like handler must not run for either rejected request");
  }, t);
});
