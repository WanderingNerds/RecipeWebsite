/**
 * REW-101 / REW-102: route-level CSRF protection on POST /recipes/:id/delete.
 *
 * The global csrfProtectionExceptMultipart wrapper in src/app.js skips token
 * validation for any multipart/form-data body, and the delete handler reads no
 * body fields, so without a route-level csrfProtection a forged cross-site
 * multipart POST reaches the handler and runs the delete. These tests pin the
 * route's middleware chain and drive the real middleware slice over HTTP.
 *
 * Harness notes:
 * - Listens on 127.0.0.1 port 0 (ephemeral TCP), never a /tmp unix socket
 *   (REW-90 / REW-98), and skips rather than fails if the sandbox forbids
 *   listeners.
 * - Includes a CONTROL case (withRouteCsrf: false) proving the same forged
 *   request DOES reach the handler when the route-level check is absent, so
 *   the rejection cases cannot pass vacuously.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { default: router } = await import("./recipeRoutes.js");
const { csrfProtection, csrfProtectionExceptMultipart, generateCsrfToken } = await import(
  "../middleware/csrfMiddleware.js"
);

const RECIPE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const DELETE_PATH = `/recipes/${RECIPE_ID}/delete`;
const BOUNDARY = "rew101boundary";
const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`;
const URLENCODED = "application/x-www-form-urlencoded";

function findDeleteLayer() {
  return router.stack.find(
    (entry) => entry.route?.path === "/:id/delete" && entry.route?.methods?.post
  );
}

function deleteRouteHandles() {
  const layer = findDeleteLayer();
  assert.ok(layer, "POST /recipes/:id/delete should be registered");
  return layer.route.stack.map((entry) => entry.handle);
}

// express-rate-limit exposes an anonymous middleware, so it is identified by
// the instance methods it carries rather than by name or stack position.
const isRateLimiter = (handle) =>
  typeof handle.resetKey === "function" && typeof handle.getKey === "function";

// ---------------------------------------------------------------------------
// Test 1: chain shape (no HTTP)
// ---------------------------------------------------------------------------

test("POST /recipes/:id/delete is mounted as requireAuth -> csrfProtection -> handler", () => {
  const layer = findDeleteLayer();
  assert.ok(layer, "POST /recipes/:id/delete should be registered");
  assert.equal(layer.route.methods.get, undefined, "the delete route must be POST-only");

  const handles = layer.route.stack.map((entry) => entry.handle);

  assert.equal(handles[0].name, "requireAuth", "requireAuth must run first");

  // The global csrfProtectionExceptMultipart skips multipart bodies, so this
  // destructive route must carry its own unconditional CSRF check. It must be
  // the exact export from csrfMiddleware.js (not a look-alike) and it must sit
  // directly after auth.
  const csrfIndex = handles.indexOf(csrfProtection);
  assert.equal(
    csrfIndex,
    1,
    "csrfProtection (the exact export from csrfMiddleware.js) must run directly after requireAuth, not be left to the global multipart-exempt wrapper"
  );
  assert.ok(csrfIndex < handles.length - 1, "csrfProtection must run before the terminal handler");

  // No limiter exists on this route today. If one is ever added it must run
  // after csrfProtection so a forged cross-site request is rejected without
  // burning the victim's rate-limit quota.
  const limiterIndex = handles.findIndex(isRateLimiter);
  if (limiterIndex > -1) {
    assert.ok(
      csrfIndex < limiterIndex,
      "csrfProtection must run before any rate limiter so a forged request cannot burn the victim's limiter quota"
    );
  }
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
 * the global csrfProtectionExceptMultipart wrapper) and mounts the delete
 * route's REAL middleware slice between a stubbed auth and a spy handler.
 */
function buildHarness({ withRouteCsrf = true } = {}) {
  const app = express();
  const calls = [];

  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(csrfProtectionExceptMultipart);

  app.get("/token", (req, res) => res.send(generateCsrfToken(req, res)));

  const chain = [stubAuth];
  if (withRouteCsrf) {
    // Everything between requireAuth and the terminal handler, taken from the
    // router's own stack. After the fix this is exactly [csrfProtection].
    const slice = deleteRouteHandles().slice(1, -1);
    assert.ok(
      slice.includes(csrfProtection),
      "the harness must mount the route's real csrfProtection slice, never an empty one"
    );
    chain.push(...slice);
  }
  chain.push((req, res) => {
    calls.push({ id: req.params.id });
    res.sendStatus(204);
  });
  app.post("/recipes/:id/delete", ...chain);

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

const postDelete = (base, { contentType, cookie, body }) =>
  request(base, {
    path: DELETE_PATH,
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

    const withCookie = await postDelete(base, { contentType: MULTIPART, cookie, body });
    assert.equal(withCookie.status, 403, "multipart POST with the victim's cookie but no token must be 403");
    assert.equal(calls.length, 0, "the delete handler must not run for a forged multipart POST carrying the victim's cookie");

    const withoutCookie = await postDelete(base, { contentType: MULTIPART, body });
    assert.equal(withoutCookie.status, 403, "multipart POST with no cookie and no token must be 403");
    assert.equal(calls.length, 0, "the delete handler must not run for a forged multipart POST with no cookie");
  }, t);
});

test("harness control: without the route-level check the same forged multipart POST reaches the handler", async (t) => {
  const { app, calls } = buildHarness({ withRouteCsrf: false });
  await withServer(app, async (base) => {
    const { cookie } = await csrfSession(base);
    const res = await postDelete(base, { contentType: MULTIPART, cookie, body: multipartBody({ ignored: "1" }) });

    // CONTROL CASE. This is expected to succeed. It proves the global
    // csrfProtectionExceptMultipart wrapper alone lets a multipart POST
    // through, so the rejection cases in this file are not passing for some
    // unrelated harness reason. Do not "fix" this by making it 403.
    assert.equal(
      res.status,
      204,
      "CONTROL: with the route-level csrfProtection removed, the global wrapper must let the forged multipart POST through (otherwise the rejection tests are vacuous)"
    );
    assert.equal(calls.length, 1, "CONTROL: the handler must run exactly once when the route-level check is absent");
  }, t);
});

test("a urlencoded POST with no _csrf is rejected before the handler", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { cookie } = await csrfSession(base);
    const res = await postDelete(base, { contentType: URLENCODED, cookie, body: "ignored=1" });
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0, "the delete handler must not run when _csrf is missing");
  }, t);
});

test("a urlencoded POST with an invalid _csrf (tampered, or from another session) is rejected before the handler", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const first = await csrfSession(base);

    // (i) the real token with one character altered
    const tampered = (first.token[0] === "a" ? "b" : "a") + first.token.slice(1);
    assert.notEqual(tampered, first.token);
    const tamperedRes = await postDelete(base, {
      contentType: URLENCODED,
      cookie: first.cookie,
      body: new URLSearchParams({ _csrf: tampered }).toString(),
    });
    assert.equal(tamperedRes.status, 403, "a tampered token must be 403");
    assert.equal(calls.length, 0, "the delete handler must not run for a tampered token");

    // (ii) a token issued for a second session, sent with the first session's cookie
    const second = await csrfSession(base);
    assert.notEqual(second.token, first.token, "the second session should get its own token");
    const crossRes = await postDelete(base, {
      contentType: URLENCODED,
      cookie: first.cookie,
      body: new URLSearchParams({ _csrf: second.token }).toString(),
    });
    assert.equal(crossRes.status, 403, "a token from another session must be 403");
    assert.equal(calls.length, 0, "the delete handler must not run for a cross-session token");
  }, t);
});

test("a urlencoded POST with a valid _csrf reaches the handler exactly once", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { token, cookie } = await csrfSession(base);
    const res = await postDelete(base, {
      contentType: URLENCODED,
      cookie,
      body: new URLSearchParams({ _csrf: token }).toString(),
    });
    assert.equal(res.status, 204, "a valid urlencoded token must reach the handler");
    assert.equal(calls.length, 1, "the delete handler must run exactly once");
    assert.equal(calls[0].id, RECIPE_ID);
  }, t);
});

test("a multipart POST is rejected even when it carries a valid _csrf part (no Multer stage on this route)", async (t) => {
  const { app, calls } = buildHarness();
  await withServer(app, async (base) => {
    const { token, cookie } = await csrfSession(base);
    // Nothing on this route parses multipart bodies, so a _csrf part is
    // invisible to csrf-csrf and the request is rejected. All five delete
    // forms post urlencoded, so this is correct - and it pins the absence of
    // a Multer / .none() stage on the route so one cannot be added silently.
    const res = await postDelete(base, { contentType: MULTIPART, cookie, body: multipartBody({ _csrf: token }) });
    assert.equal(res.status, 403, "multipart must be rejected even with a valid _csrf part");
    assert.equal(calls.length, 0, "the delete handler must not run for a multipart body");
  }, t);
});
