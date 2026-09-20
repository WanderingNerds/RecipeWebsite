/**
 * REW-88: handler-level coverage for GET /cookbooks/:id and the widened
 * getCookbookRecipes helper behind it.
 *
 * Same responseRecorder() + injected-fake-client style as
 * likedRecipes.test.js and cookbookVisibilityRoutes.test.js, so no live
 * Supabase is needed. The point of these tests is the data contract the
 * standardized cookbook card depends on: the columns it needs, flattened
 * categories/tags, and a like status batched into one query rather than one
 * per recipe.
 *
 * REW-102 appends a second, unrelated concern at the bottom of this file: the
 * route-level CSRF contract of POST /cookbooks/:id/recipes/:recipeId. It lives
 * here rather than in a new file because this is the cookbook router's own test
 * file and the route needed no handler-level changes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const {
  default: router,
  getCookbookRecipes,
  handleCookbookView,
} = await import("./cookbookRoutes.js");
const { csrfProtection, csrfProtectionExceptMultipart, generateCsrfToken } = await import(
  "../middleware/csrfMiddleware.js"
);

const COOKBOOK_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const OWNER_ID = "owner-1";
const OLDER = "recipe-older";
const NEWER = "recipe-newer";

function responseRecorder() {
  return {
    renderedView: null,
    renderedLocals: null,
    redirectPath: null,
    render(view, locals) { this.renderedView = view; this.renderedLocals = locals; },
    redirect(path) { this.redirectPath = path; },
  };
}

/**
 * Thenable fake PostgREST query builder: the recipe and like queries are
 * awaited directly rather than through .maybeSingle(), so the fake has to be
 * awaitable too. Every call is recorded so a test can assert the filters.
 */
function fakeQuery(table, result, calls) {
  const query = {
    select(...args) { calls.push([table, "select", ...args]); return query; },
    eq(...args) { calls.push([table, "eq", ...args]); return query; },
    in(...args) { calls.push([table, "in", ...args]); return query; },
    order(...args) { calls.push([table, "order", ...args]); return query; },
    async maybeSingle() { calls.push([table, "maybeSingle"]); return result; },
    then(onFulfilled, onRejected) { return Promise.resolve(result).then(onFulfilled, onRejected); },
  };
  return query;
}

function fakeClient({
  cookbook = { id: COOKBOOK_ID, title: "Weeknight Favorites", is_public: false },
  cookbookError = null,
  rows = [],
  rowsError = null,
  likes = [],
  likesError = null,
} = {}) {
  const calls = [];
  const tables = [];
  const results = {
    cookbooks: { data: cookbook, error: cookbookError },
    cookbook_recipes: { data: rows, error: rowsError },
    recipe_likes: { data: likes, error: likesError },
  };
  const client = {
    from(table) {
      tables.push(table);
      return fakeQuery(table, results[table], calls);
    },
  };
  return { calls, tables, client, createClient: () => client };
}

function request(overrides = {}) {
  return {
    params: { id: COOKBOOK_ID },
    user: { id: OWNER_ID },
    accessToken: "token",
    flash() {},
    ...overrides,
  };
}

function junctionRow(recipeId, overrides = {}) {
  return {
    recipe_id: recipeId,
    created_at: "2026-02-01T00:00:00Z",
    recipes: {
      id: recipeId,
      user_id: OWNER_ID,
      title: `Recipe ${recipeId}`,
      author: "Chef",
      original_author: null,
      prep_time: "10 minutes",
      cook_time: "30 minutes",
      servings: "4",
      difficulty: "Easy",
      thumbnail_url: null,
      status: "published",
      created_at: "2026-01-01T00:00:00Z",
      recipe_categories: [{ categories: { id: "c1", name: "Dinner", slug: "dinner", icon: "*" } }],
      recipe_tags: [{ tags: { id: "t1", name: "Family", slug: "family" } }],
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// getCookbookRecipes -- the widened read
// ---------------------------------------------------------------------------

test("the cookbook recipe query asks for every column the standardized card needs", async () => {
  const fake = fakeClient({ rows: [junctionRow(NEWER)] });
  await getCookbookRecipes(fake.client, COOKBOOK_ID);

  assert.deepEqual(fake.tables, ["cookbook_recipes"]);
  const select = fake.calls.find(([table, method]) => table === "cookbook_recipes" && method === "select");
  for (const column of [
    "user_id",
    "original_author",
    "difficulty",
    "status",
    "thumbnail_url",
    "recipe_categories(",
    "recipe_tags(",
  ]) {
    assert.ok(select[2].includes(column), `card query must select ${column}`);
  }

  // Scoped to this cookbook, in added-to-cookbook order (the junction row's
  // created_at), newest first -- unchanged by the widening.
  assert.ok(
    fake.calls.some(([table, method, column, value]) =>
      table === "cookbook_recipes" && method === "eq" && column === "cookbook_id" && value === COOKBOOK_ID
    ),
    "query must be scoped to the cookbook"
  );
  assert.ok(
    fake.calls.some(([table, method, column, options]) =>
      table === "cookbook_recipes" && method === "order" && column === "created_at" && options.ascending === false
    ),
    "rows are read newest-added first"
  );
});

test("categories and tags are flattened, and the junction rows are not handed to the view", async () => {
  const fake = fakeClient({ rows: [junctionRow(NEWER)] });
  const [recipe] = await getCookbookRecipes(fake.client, COOKBOOK_ID);

  assert.deepEqual(recipe.categories, [{ id: "c1", name: "Dinner", slug: "dinner", icon: "*" }]);
  assert.deepEqual(recipe.tags, [{ id: "t1", name: "Family", slug: "family" }]);
  assert.equal(recipe.recipe_categories, undefined);
  assert.equal(recipe.recipe_tags, undefined);
  // user_id is fetched deliberately: the card computes isOwner from it.
  assert.equal(recipe.user_id, OWNER_ID);
});

test("missing category and tag links flatten to empty arrays, not undefined", async () => {
  const fake = fakeClient({
    rows: [junctionRow(NEWER, { recipe_categories: null, recipe_tags: [{ tags: null }] })],
  });
  const [recipe] = await getCookbookRecipes(fake.client, COOKBOOK_ID);

  assert.deepEqual(recipe.categories, []);
  assert.deepEqual(recipe.tags, []);
});

test("a membership row whose recipe vanished mid-query is dropped, not rendered as a hole", async () => {
  const fake = fakeClient({
    rows: [junctionRow(NEWER), { recipe_id: OLDER, created_at: "2026-01-01T00:00:00Z", recipes: null }],
  });
  const recipes = await getCookbookRecipes(fake.client, COOKBOOK_ID);

  assert.deepEqual(recipes.map((r) => r.id), [NEWER]);
});

test("a failed recipe read yields an empty cookbook rather than throwing", async () => {
  const fake = fakeClient({ rows: null, rowsError: { message: "boom" } });
  assert.deepEqual(await getCookbookRecipes(fake.client, COOKBOOK_ID), []);
});

// ---------------------------------------------------------------------------
// GET /cookbooks/:id -- batched like status
// ---------------------------------------------------------------------------

test("like status is stamped from one batched query, not one query per recipe", async () => {
  const fake = fakeClient({
    rows: [junctionRow(NEWER), junctionRow(OLDER)],
    likes: [{ recipe_id: NEWER }],
  });
  const res = responseRecorder();
  await handleCookbookView(request(), res, fake);

  // One cookbook read, one recipe read, one likes read -- regardless of how
  // many recipes are in the cookbook.
  assert.deepEqual(fake.tables, ["cookbooks", "cookbook_recipes", "recipe_likes"]);

  assert.equal(res.renderedView, "cookbooks/view");
  assert.deepEqual(
    res.renderedLocals.recipes.map((r) => [r.id, r.isLiked]),
    [[NEWER, true], [OLDER, false]]
  );

  // The likes read is scoped to the caller and to exactly these recipes.
  assert.ok(
    fake.calls.some(([table, method, column, value]) =>
      table === "recipe_likes" && method === "eq" && column === "user_id" && value === OWNER_ID
    ),
    "likes are filtered to the signed-in user"
  );
  assert.ok(
    fake.calls.some(([table, method, column, values]) =>
      table === "recipe_likes" && method === "in" && column === "recipe_id" &&
      values.length === 2 && values.includes(NEWER) && values.includes(OLDER)
    ),
    "likes are fetched for all recipes in one query"
  );
});

test("an empty cookbook issues no likes query at all", async () => {
  const fake = fakeClient({ rows: [] });
  const res = responseRecorder();
  await handleCookbookView(request(), res, fake);

  assert.deepEqual(fake.tables, ["cookbooks", "cookbook_recipes"]);
  assert.deepEqual(res.renderedLocals.recipes, []);
});

test("a failed likes query still renders the page, with every heart unfavorited", async () => {
  const fake = fakeClient({
    rows: [junctionRow(NEWER)],
    likes: null,
    likesError: { message: "boom" },
  });
  const res = responseRecorder();
  await handleCookbookView(request(), res, fake);

  assert.equal(res.renderedView, "cookbooks/view");
  assert.equal(res.renderedLocals.recipes[0].isLiked, false);
});

test("the page is still cookbook-owner scoped and still passes its share-link locals", async () => {
  const fake = fakeClient({ rows: [junctionRow(NEWER)] });
  const res = responseRecorder();
  await handleCookbookView(request(), res, fake);

  assert.deepEqual(
    fake.calls.filter(([table, method]) => table === "cookbooks" && method === "eq"),
    [["cookbooks", "eq", "id", COOKBOOK_ID], ["cookbooks", "eq", "user_id", OWNER_ID]]
  );
  assert.equal(res.renderedLocals.title, "Weeknight Favorites");
  assert.equal(res.renderedLocals.cookbook.id, COOKBOOK_ID);
  assert.ok(res.renderedLocals.appUrl, "appUrl is still supplied for the share panel");
});

test("a non-UUID id and a cookbook the caller does not own are indistinguishable", async () => {
  const badId = fakeClient();
  const badIdRes = responseRecorder();
  await handleCookbookView(request({ params: { id: "not-a-uuid" } }), badIdRes, badId);
  assert.equal(badIdRes.renderedView, null);
  assert.equal(badIdRes.redirectPath, "/cookbooks");
  assert.deepEqual(badId.tables, [], "a malformed id never reaches the database");

  const notOwned = fakeClient({ cookbook: null });
  const notOwnedRes = responseRecorder();
  await handleCookbookView(request(), notOwnedRes, notOwned);
  assert.equal(notOwnedRes.renderedView, null);
  assert.equal(notOwnedRes.redirectPath, "/cookbooks");
  assert.deepEqual(notOwned.tables, ["cookbooks"], "no recipes are read for a cookbook you do not own");
});

// ---------------------------------------------------------------------------
// REW-102: route-level CSRF on POST /cookbooks/:id/recipes/:recipeId
//
// The global csrfProtectionExceptMultipart wrapper in src/app.js skips token
// validation for any multipart/form-data body, and the add-recipe handler reads
// no body fields (only its two route params and the caller's identity), so
// without a route-level csrfProtection a forged cross-site multipart POST
// reaches it and upserts a cookbook_recipes row on the victim's behalf. Its
// already-protected twin POST /api/cookbooks/:id/recipes/:recipeId made this a
// consistency fix rather than a new policy.
//
// The chain assertions compare against the EXACT csrfProtection export rather
// than matching a function name, so a re-wrapped or renamed look-alike (in
// particular csrfProtectionExceptMultipart, the bypass being closed) cannot
// satisfy them. The HTTP cases drive the route's REAL middleware slice and
// include a control case, so they cannot pass vacuously. The harness listens on
// 127.0.0.1 port 0 (never a /tmp unix socket -- REW-90 / REW-98) and skips
// rather than fails where listeners are forbidden.
// ---------------------------------------------------------------------------

const ADD_RECIPE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const ADD_ROUTE = "/:id/recipes/:recipeId";
const ADD_PATH = `/cookbooks/${COOKBOOK_ID}/recipes/${ADD_RECIPE_ID}`;
const BOUNDARY = "rew102cookbookboundary";
const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`;
const URLENCODED = "application/x-www-form-urlencoded";

function addRouteHandles() {
  const layer = router.stack.find(
    (entry) => entry.route?.path === ADD_ROUTE && entry.route?.methods?.post
  );
  assert.ok(layer, "POST /cookbooks/:id/recipes/:recipeId should be registered");
  return { layer, handles: layer.route.stack.map((entry) => entry.handle) };
}

// express-rate-limit exposes an anonymous middleware, so it is identified by
// the instance methods it carries rather than by name or stack position.
const isRateLimiter = (handle) =>
  typeof handle.resetKey === "function" && typeof handle.getKey === "function";

test("POST /cookbooks/:id/recipes/:recipeId is mounted as requireAuth -> csrfProtection -> cookbookLimiter -> handler", () => {
  const { layer, handles } = addRouteHandles();
  assert.equal(layer.route.methods.get, undefined, "the add route must be POST-only");

  assert.equal(
    handles.length,
    4,
    "chain should be exactly requireAuth + csrfProtection + cookbookLimiter + handler"
  );
  assert.equal(handles[0].name, "requireAuth", "requireAuth must run first");

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

  const limiterIndex = handles.findIndex(isRateLimiter);
  assert.equal(
    limiterIndex,
    2,
    "cookbookLimiter must run directly after csrfProtection: CSRF must run before the limiter so a forged cross-site request cannot burn the victim's quota"
  );

  const terminal = handles[3];
  assert.notEqual(terminal, csrfProtection, "index 3 must be the terminal handler, not csrfProtection");
  assert.ok(!isRateLimiter(terminal), "index 3 must be the terminal handler, not a rate limiter");
});

function stubAuth(req, _res, next) {
  req.user = { id: OWNER_ID };
  req.accessToken = "token";
  next();
}

/**
 * Mirrors app.js (cookie-parser, json, urlencoded, then the global
 * csrfProtectionExceptMultipart wrapper) and mounts the add route's REAL
 * middleware slice between a stubbed auth and a spy handler. stubAuth runs
 * first because cookbookLimiter keys on req.user?.id.
 */
function buildCsrfHarness({ withRouteCsrf = true } = {}) {
  const app = express();
  const calls = [];

  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(csrfProtectionExceptMultipart);

  app.get("/token", (req, res) => res.send(generateCsrfToken(req, res)));

  const realSlice = addRouteHandles().handles.slice(1, -1);
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
    assert.ok(slice.some(isRateLimiter), "CONTROL: the pre-fix chain must still include cookbookLimiter");
  }

  app.post("/cookbooks/:id/recipes/:recipeId", stubAuth, ...slice, (req, res) => {
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

function httpRequest(base, { path, method = "GET", headers = {}, body = "" }) {
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
  const res = await httpRequest(base, { path: "/token" });
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

const postAdd = (base, { contentType, cookie, body = "" }) =>
  httpRequest(base, {
    path: ADD_PATH,
    method: "POST",
    headers: { "content-type": contentType, ...(cookie ? { cookie } : {}) },
    body,
  });

test("a forged multipart POST to the cookbook add route is rejected before the handler", async (t) => {
  const { app, calls } = buildCsrfHarness();
  await withServer(app, async (base) => {
    const { cookie } = await csrfSession(base);
    const body = multipartBody({ ignored: "1" });

    const withCookie = await postAdd(base, { contentType: MULTIPART, cookie, body });
    assert.equal(withCookie.status, 403, "multipart POST with the victim's cookie but no token must be 403");
    assert.equal(calls.length, 0, "the add handler must not run for a forged multipart POST");

    const withoutCookie = await postAdd(base, { contentType: MULTIPART, body });
    assert.equal(withoutCookie.status, 403, "multipart POST with no cookie and no token must be 403");
    assert.equal(calls.length, 0, "the add handler must not run for a forged multipart POST with no cookie");
  }, t);
});

test("harness control: with only cookbookLimiter mounted (the pre-fix chain) the same forged multipart POST reaches the handler", async (t) => {
  const { app, calls } = buildCsrfHarness({ withRouteCsrf: false });
  await withServer(app, async (base) => {
    const { cookie } = await csrfSession(base);
    const res = await postAdd(base, { contentType: MULTIPART, cookie, body: multipartBody({ ignored: "1" }) });

    // CONTROL CASE, expected to succeed: it mounts the pre-fix chain
    // (requireAuth -> cookbookLimiter -> handler) and proves the global
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

test("the real add-to-cookbook form (urlencoded with a hidden _csrf) still reaches the handler", async (t) => {
  const { app, calls } = buildCsrfHarness();
  await withServer(app, async (base) => {
    const { token, cookie } = await csrfSession(base);

    // views/recipes/view.ejs:97 posts this route urlencoded with a hidden
    // _csrf field, which is the exact shape asserted here, so the fix is
    // transparent to the "+ Add to <cookbook>" widget.
    const res = await postAdd(base, {
      contentType: URLENCODED,
      cookie,
      body: new URLSearchParams({ _csrf: token }).toString(),
    });
    assert.equal(res.status, 204, "a valid urlencoded token must reach the handler");
    assert.equal(calls.length, 1, "the add handler must run exactly once");
    assert.equal(calls[0].id, COOKBOOK_ID);
    assert.equal(calls[0].recipeId, ADD_RECIPE_ID);

    const missing = await postAdd(base, { contentType: URLENCODED, cookie, body: "ignored=1" });
    assert.equal(missing.status, 403, "the same form without _csrf must be 403");
    assert.equal(calls.length, 1, "the add handler must not run when _csrf is missing");
  }, t);
});
