/**
 * REW-86: handler-level coverage for the card-level Private/Public toggle
 * (POST /recipes/:id/visibility).
 *
 * Deliberately a separate file from recipeVisibilityRoutes.test.js, which
 * covers visibility as it flows through recipe create/update. Same
 * responseRecorder() + injected-fake-client style as
 * cookbookVisibilityRoutes.test.js, so no live Supabase is needed.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { handleRecipeVisibilityUpdate, buildRecipesListPath } = await import(
  "./recipeRoutes.js"
);

const RECIPE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function responseRecorder() {
  return {
    redirectPath: null,
    redirect(path) { this.redirectPath = path; },
  };
}

/**
 * Fake PostgREST query builder that records every call made against it, so a
 * test can assert both the value written and the filters applied.
 */
function fakeClient({ data = { id: RECIPE_ID }, error = null } = {}) {
  const calls = [];
  const tables = [];
  const query = {
    update(value) { calls.push(["update", value]); return this; },
    eq(...args) { calls.push(["eq", ...args]); return this; },
    select() { calls.push(["select"]); return this; },
    async maybeSingle() { return { data, error }; },
  };
  return {
    calls,
    tables,
    createClient: () => ({ from(table) { tables.push(table); return query; } }),
  };
}

function request(overrides = {}) {
  return {
    params: { id: RECIPE_ID },
    body: {},
    user: { id: "owner-1" },
    accessToken: "token",
    flash() {},
    ...overrides,
  };
}

test("visibility flips both directions from the private|public form convention", async () => {
  for (const [visibility, expected] of [
    ["public", "published"],
    ["private", "draft"],
  ]) {
    const client = fakeClient();
    const res = responseRecorder();
    await handleRecipeVisibilityUpdate(request({ body: { visibility } }), res, client);

    assert.deepEqual(client.tables, ["recipes"]);
    assert.deepEqual(client.calls[0], ["update", { status: expected }]);
    assert.equal(res.redirectPath, "/recipes");
  }
});

test("every update is scoped by both id and user_id, not by RLS alone", async () => {
  for (const visibility of ["public", "private"]) {
    const client = fakeClient();
    await handleRecipeVisibilityUpdate(
      request({ body: { visibility } }),
      responseRecorder(),
      client
    );

    assert.deepEqual(
      client.calls.filter(([method]) => method === "eq"),
      [["eq", "id", RECIPE_ID], ["eq", "user_id", "owner-1"]]
    );
  }
});

test("an unrecognized or absent visibility value fails closed to Private", async () => {
  for (const visibility of [
    undefined,
    null,
    "",
    "PUBLIC",
    "Public",
    "nonsense",
    "true",
    "published",
    ["public"],
    ["public", "public"],
    { visibility: "public" },
    42,
  ]) {
    const client = fakeClient();
    await handleRecipeVisibilityUpdate(
      request({ body: { visibility } }),
      responseRecorder(),
      client
    );

    assert.deepEqual(
      client.calls[0],
      ["update", { status: "draft" }],
      `${String(visibility)} must not make a recipe Public`
    );
  }
});

test("a malformed recipe id never reaches the database", async () => {
  for (const id of [
    "not-a-uuid",
    "",
    "../../etc/passwd",
    `${RECIPE_ID}'; DROP TABLE recipes;--`,
  ]) {
    const client = fakeClient();
    const res = responseRecorder();
    const flashes = [];
    await handleRecipeVisibilityUpdate(
      request({
        params: { id },
        body: { visibility: "public" },
        flash: (...args) => flashes.push(args),
      }),
      res,
      client
    );

    assert.deepEqual(client.tables, [], `${id} must not open a query`);
    assert.deepEqual(client.calls, []);
    assert.equal(res.redirectPath, "/recipes");
    assert.equal(flashes[0][0], "error");
  }
});

test("a missing or non-owned row is reported identically and never claims success", async () => {
  for (const result of [
    { data: null, error: null },
    { data: null, error: { code: "PGRST116" } },
  ]) {
    const client = fakeClient(result);
    const res = responseRecorder();
    const flashes = [];
    await handleRecipeVisibilityUpdate(
      request({ body: { visibility: "public" }, flash: (...args) => flashes.push(args) }),
      res,
      client
    );

    assert.equal(flashes.length, 1);
    assert.equal(flashes[0][0], "error");
    assert.equal(res.redirectPath, "/recipes");

    // The single update attempt is all that happened -- no retry, no
    // fallback query, nothing further mutated after the miss.
    assert.deepEqual(
      client.calls.map(([method]) => method),
      ["update", "eq", "eq", "select"]
    );
  }
});

test("a not-found row is not logged as a database failure, but still reads identically", async () => {
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args);

  const flashes = [];
  try {
    // Not found / not owned: maybeSingle returns data: null with NO error
    const notFound = fakeClient({ data: null, error: null });
    await handleRecipeVisibilityUpdate(
      request({ body: { visibility: "public" }, flash: (...args) => flashes.push(args) }),
      responseRecorder(),
      notFound
    );
    assert.equal(logged.length, 0, "a legitimate not-found must not log null as a DB error");

    // A genuine database failure still gets logged
    const failure = fakeClient({ data: null, error: { message: "connection reset" } });
    await handleRecipeVisibilityUpdate(
      request({ body: { visibility: "public" }, flash: (...args) => flashes.push(args) }),
      responseRecorder(),
      failure
    );
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0][1], { message: "connection reset" });
  } finally {
    console.error = originalError;
  }

  // Both paths must be indistinguishable to the user, so a non-owner cannot
  // tell a recipe they don't own from one that doesn't exist.
  assert.deepEqual(flashes[0], flashes[1]);
});

test("the confirming flash uses Private/Public wording, never draft/published", async () => {
  for (const [visibility, expected] of [["public", /Public/], ["private", /Private/]]) {
    const flashes = [];
    await handleRecipeVisibilityUpdate(
      request({ body: { visibility }, flash: (...args) => flashes.push(args) }),
      responseRecorder(),
      fakeClient()
    );

    assert.equal(flashes[0][0], "success");
    assert.match(flashes[0][1], expected);
    assert.doesNotMatch(flashes[0][1], /draft|published/i);
  }
});

test("the active category/tags filter round-trips back into the redirect", async () => {
  const res = responseRecorder();
  await handleRecipeVisibilityUpdate(
    request({ body: { visibility: "public", category: "dessert", tags: "quick,vegan" } }),
    res,
    fakeClient()
  );

  assert.equal(res.redirectPath, "/recipes?category=dessert&tags=quick%2Cvegan");
});

test("the redirect is always the hard-coded /recipes path, never a caller-supplied URL", async () => {
  const hostileBodies = [
    { visibility: "public", returnTo: "https://evil.example.com" },
    { visibility: "public", redirect: "//evil.example.com" },
    { visibility: "public", next: "/\\evil.example.com" },
    { visibility: "public", category: "//evil.example.com" },
    { visibility: "public", tags: "https://evil.example.com" },
    { visibility: "public", category: "dessert\r\nLocation: https://evil.example.com" },
  ];

  for (const body of hostileBodies) {
    const res = responseRecorder();
    await handleRecipeVisibilityUpdate(request({ body }), res, fakeClient());

    assert.ok(
      res.redirectPath.startsWith("/recipes"),
      `${JSON.stringify(body)} produced ${res.redirectPath}`
    );
    assert.doesNotMatch(res.redirectPath, /[\r\n]/);
    // Anything after the hard-coded path can only ever be a query string:
    // a hostile value survives at most as a percent-encoded parameter.
    assert.equal(res.redirectPath.split("?")[0], "/recipes");
    // Resolved against any origin, it can never leave that origin.
    const resolved = new URL(res.redirectPath, "https://app.example");
    assert.equal(resolved.origin, "https://app.example");
    assert.equal(resolved.pathname, "/recipes");
  }
});

test("buildRecipesListPath only echoes whitelisted, plain-string filter values", () => {
  assert.equal(buildRecipesListPath(undefined), "/recipes");
  assert.equal(buildRecipesListPath(null), "/recipes");
  assert.equal(buildRecipesListPath("category=dessert"), "/recipes");
  assert.equal(buildRecipesListPath({}), "/recipes");
  assert.equal(buildRecipesListPath({ category: "   " }), "/recipes");
  assert.equal(buildRecipesListPath({ category: ["dessert"] }), "/recipes");
  assert.equal(buildRecipesListPath({ tags: { a: 1 } }), "/recipes");
  assert.equal(buildRecipesListPath({ tags: 42 }), "/recipes");
  assert.equal(buildRecipesListPath({ category: "x".repeat(301) }), "/recipes");
  assert.equal(buildRecipesListPath({ category: " dessert " }), "/recipes?category=dessert");
  assert.equal(
    buildRecipesListPath({ category: "dessert", tags: "quick", visibility: "public", _csrf: "t" }),
    "/recipes?category=dessert&tags=quick"
  );
});

test("the route is mounted behind requireAuth, a rate limiter and csrfProtection", async () => {
  const { default: router } = await import("./recipeRoutes.js");
  const { csrfProtection } = await import("../middleware/csrfMiddleware.js");
  const layer = router.stack.find(
    (entry) => entry.route?.path === "/:id/visibility" && entry.route?.methods?.post
  );

  assert.ok(layer, "POST /recipes/:id/visibility should be registered");

  const handles = layer.route.stack.map((entry) => entry.handle);

  const authIndex = handles.findIndex((handle) => handle.name === "requireAuth");
  assert.ok(authIndex > -1, "requireAuth must be in the chain");
  assert.equal(authIndex, 0, "requireAuth must run first");
  // express-rate-limit exposes an anonymous middleware, so it is identified
  // by the instance methods it carries rather than by name or stack position.
  const limiterIndex = handles.findIndex(
    (handle) =>
      typeof handle.resetKey === "function" && typeof handle.getKey === "function"
  );
  assert.ok(limiterIndex > -1, "a per-route rate limiter must be in the chain");
  // The global csrfProtectionExceptMultipart skips multipart bodies, so this
  // state-changing route must carry its own unconditional CSRF check.
  const csrfIndex = handles.indexOf(csrfProtection);
  assert.ok(
    csrfIndex > -1,
    "csrfProtection must be in the chain, not left to the global multipart-exempt wrapper"
  );
  // Membership alone is not enough: a csrfProtection placed after the terminal
  // handler would never run. It must sit ahead of the handler and ahead of the
  // limiter, so a forged cross-site request is rejected without burning the
  // victim's rate-limit quota.
  assert.ok(
    csrfIndex < handles.length - 1,
    "csrfProtection must run before the terminal handler"
  );
  assert.ok(csrfIndex < limiterIndex, "csrfProtection must run before the rate limiter");
  assert.ok(
    limiterIndex < handles.length - 1,
    "the rate limiter must run before the terminal handler"
  );
});
