/**
 * REW-86: coverage for the owner-scoped cookbook JSON API that powers the
 * "+ Cookbook" card action.
 *
 * The handlers are exported with an injectable Supabase client (the same
 * pattern as handleRecipeVisibilityUpdate in recipeRoutes.js), so the
 * ownership rules can be driven directly with a fake client and no live
 * database. The router's own layer stack is still inspected separately,
 * because auth, rate limiting and CSRF are part of this endpoint's contract
 * rather than incidental wiring.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const {
  default: router,
  handleCookbookList,
  handleCookbookCreate,
  handleCookbookRecipeAdd,
  handleCookbookRecipeRemove,
} = await import("./cookbookApiRoutes.js");
const { csrfProtection } = await import("../middleware/csrfMiddleware.js");

const COOKBOOK_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const OTHER_COOKBOOK_ID = "16fd2706-8baf-433b-82eb-8c7fada847da";
const RECIPE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

const BAD_IDS = [
  "not-a-uuid",
  "",
  "../../etc/passwd",
  `${COOKBOOK_ID}'; DROP TABLE cookbook_recipes;--`,
];

const MUTATIONS = [
  ["/", "post"],
  ["/:id/recipes/:recipeId", "post"],
  ["/:id/recipes/:recipeId", "delete"],
];

function findLayer(path, method) {
  return router.stack.find(
    (entry) => entry.route?.path === path && entry.route?.methods?.[method]
  );
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function request(overrides = {}) {
  return {
    params: {},
    query: {},
    body: {},
    cookies: {},
    user: { id: "owner-1" },
    accessToken: "token",
    ...overrides,
  };
}

/**
 * Fake PostgREST client. `results` maps a table name to the result its query
 * resolves to (or to an array of results, consumed in order). Every builder
 * call is recorded as [table, method, ...args] so a test can assert the
 * filters that were applied, not just the outcome.
 */
function fakeClient(results = {}) {
  const calls = [];
  const tables = [];
  const queues = Object.fromEntries(
    Object.entries(results).map(([table, value]) => [
      table,
      Array.isArray(value) ? [...value] : [value],
    ])
  );

  function nextResult(table) {
    const queue = queues[table];
    if (!queue || queue.length === 0) return { data: null, error: null };
    return queue.length > 1 ? queue.shift() : queue[0];
  }

  function builder(table) {
    const record = (method, ...args) => calls.push([table, method, ...args]);
    const api = {
      select(...a) { record("select", ...a); return api; },
      insert(...a) { record("insert", ...a); return api; },
      upsert(...a) { record("upsert", ...a); return api; },
      delete(...a) { record("delete", ...a); return api; },
      eq(...a) { record("eq", ...a); return api; },
      in(...a) { record("in", ...a); return api; },
      order(...a) { record("order", ...a); return api; },
      async maybeSingle() { record("maybeSingle"); return nextResult(table); },
      async single() { record("single"); return nextResult(table); },
      // PostgREST builders are thenable, so a query without a terminal
      // single()/maybeSingle() still resolves when awaited.
      then(resolve, reject) {
        return Promise.resolve(nextResult(table)).then(resolve, reject);
      },
    };
    return api;
  }

  return {
    calls,
    tables,
    createClient: () => ({
      from(table) { tables.push(table); return builder(table); },
    }),
  };
}

const ownedCookbook = { id: COOKBOOK_ID, title: "Weeknights" };

test("every cookbook API route requires auth; mutations add rate limiting and CSRF", () => {
  const readLayer = findLayer("/", "get");
  assert.ok(readLayer, "GET /api/cookbooks should be registered");
  assert.equal(readLayer.route.stack[0].handle.name, "requireApiAuth");

  for (const [path, method] of MUTATIONS) {
    const layer = findLayer(path, method);
    assert.ok(layer, `${method.toUpperCase()} ${path} should be registered`);

    const handles = layer.route.stack.map((entry) => entry.handle);
    const label = `${method.toUpperCase()} ${path}`;

    assert.equal(handles[0].name, "requireApiAuth", `${label} must authenticate first`);
    // express-rate-limit exposes an anonymous middleware, so it is identified
    // by the instance methods it carries rather than by name or position.
    const limiterIndex = handles.findIndex(
      (handle) =>
        typeof handle.resetKey === "function" && typeof handle.getKey === "function"
    );
    assert.ok(limiterIndex > -1, `${label} must be rate limited`);
    // The global csrfProtectionExceptMultipart skips multipart bodies, so
    // these state-changing routes must carry their own unconditional check.
    const csrfIndex = handles.indexOf(csrfProtection);
    assert.ok(
      csrfIndex > -1,
      `${label} must apply csrfProtection, not rely on the multipart-exempt global`
    );
    // Membership alone is not enough: a csrfProtection placed after the
    // terminal handler would never run. It must sit ahead of the handler and
    // ahead of the limiter, so a forged cross-site request is rejected
    // without burning the victim's rate-limit quota.
    assert.ok(
      csrfIndex < handles.length - 1,
      `${label} must run csrfProtection before the terminal handler`
    );
    assert.ok(
      csrfIndex < limiterIndex,
      `${label} must run csrfProtection before the rate limiter`
    );
    assert.ok(
      limiterIndex < handles.length - 1,
      `${label} must run the rate limiter before the terminal handler`
    );
  }
});

test("the read endpoint is not CSRF-checked, since it changes nothing", () => {
  const handles = findLayer("/", "get").route.stack.map((entry) => entry.handle);
  assert.equal(handles.includes(csrfProtection), false);
});

test("requireApiAuth rejects a request with no session cookie, as JSON", async () => {
  const layer = findLayer("/", "get");
  const res = responseRecorder();
  let nextCalled = false;

  await layer.route.stack[0].handle(request(), res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "Authentication required" });
});

test("a malformed recipeId on the list endpoint is rejected before any query", async () => {
  for (const recipeId of BAD_IDS) {
    const res = responseRecorder();
    const client = fakeClient();
    await handleCookbookList(request({ query: { recipeId } }), res, client);

    assert.equal(res.statusCode, 400, `${recipeId} should be rejected`);
    assert.deepEqual(res.body, { error: "Invalid recipe ID" });
    assert.deepEqual(client.tables, [], `${recipeId} must not open a query`);
  }
});

test("the list endpoint only ever returns the caller's own cookbooks", async () => {
  const client = fakeClient({
    cookbooks: { data: [ownedCookbook], error: null },
    cookbook_recipes: { data: [{ cookbook_id: COOKBOOK_ID }], error: null },
  });
  const res = responseRecorder();

  await handleCookbookList(request({ query: { recipeId: RECIPE_ID } }), res, client);

  assert.deepEqual(
    client.calls.filter(([table, method]) => table === "cookbooks" && method === "eq"),
    [["cookbooks", "eq", "user_id", "owner-1"]],
    "the cookbook list must be scoped by user_id, not by RLS alone"
  );
  // Membership is only ever probed for cookbooks that already passed that
  // owner filter, so it cannot leak another user's cookbook ids.
  assert.deepEqual(
    client.calls.find(([table, method]) => table === "cookbook_recipes" && method === "in"),
    ["cookbook_recipes", "in", "cookbook_id", [COOKBOOK_ID]]
  );
  assert.deepEqual(res.body, {
    cookbooks: [{ id: COOKBOOK_ID, title: "Weeknights", containsRecipe: true }],
  });
});

test("malformed ids on add/remove are rejected before any query", async () => {
  for (const [handler, name] of [
    [handleCookbookRecipeAdd, "add"],
    [handleCookbookRecipeRemove, "remove"],
  ]) {
    for (const badId of BAD_IDS) {
      for (const params of [
        { id: badId, recipeId: RECIPE_ID },
        { id: COOKBOOK_ID, recipeId: badId },
      ]) {
        const res = responseRecorder();
        const client = fakeClient();
        await handler(request({ params }), res, client);

        assert.equal(
          res.statusCode,
          400,
          `${name} ${JSON.stringify(params)} should be rejected`
        );
        assert.deepEqual(res.body, { error: "Invalid cookbook or recipe ID" });
        assert.deepEqual(client.tables, [], `${name} must not open a query`);
      }
    }
  }
});

test("adding to a cookbook the caller does not own is a 404 and writes nothing", async () => {
  // A cookbook owned by someone else and a cookbook that does not exist both
  // arrive here as data: null -- they must stay indistinguishable.
  for (const lookup of [{ data: null, error: null }, { data: null, error: { code: "PGRST116" } }]) {
    const client = fakeClient({ cookbooks: lookup });
    const res = responseRecorder();

    await handleCookbookRecipeAdd(
      request({ params: { id: OTHER_COOKBOOK_ID, recipeId: RECIPE_ID } }),
      res,
      client
    );

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: "Cookbook not found" });
    assert.deepEqual(
      client.tables,
      ["cookbooks"],
      "no membership row may be written for a non-owned cookbook"
    );
    assert.deepEqual(
      client.calls.filter(([, method]) => method === "eq"),
      [
        ["cookbooks", "eq", "id", OTHER_COOKBOOK_ID],
        ["cookbooks", "eq", "user_id", "owner-1"],
      ],
      "the cookbook lookup must be scoped by owner"
    );
  }
});

test("removing from a cookbook the caller does not own is a 404 and deletes nothing", async () => {
  const client = fakeClient({ cookbooks: { data: null, error: null } });
  const res = responseRecorder();

  await handleCookbookRecipeRemove(
    request({ params: { id: OTHER_COOKBOOK_ID, recipeId: RECIPE_ID } }),
    res,
    client
  );

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "Cookbook not found" });
  assert.deepEqual(client.tables, ["cookbooks"]);
  assert.equal(
    client.calls.some(([, method]) => method === "delete"),
    false,
    "a non-owner must never reach the delete"
  );
});

test("adding a recipe the caller does not own is a 404 and writes nothing", async () => {
  const client = fakeClient({
    cookbooks: { data: ownedCookbook, error: null },
    recipes: { data: null, error: null },
  });
  const res = responseRecorder();

  await handleCookbookRecipeAdd(
    request({ params: { id: COOKBOOK_ID, recipeId: RECIPE_ID } }),
    res,
    client
  );

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "Recipe not found" });
  assert.deepEqual(
    client.tables,
    ["cookbooks", "recipes"],
    "the membership insert must not run once the recipe check fails"
  );
  assert.deepEqual(
    client.calls.filter(([table, method]) => table === "recipes" && method === "eq"),
    [
      ["recipes", "eq", "id", RECIPE_ID],
      ["recipes", "eq", "user_id", "owner-1"],
    ],
    "the recipe must be checked against the caller, not just fetched"
  );
});

test("a failed recipe lookup is reported exactly like a non-owned recipe", async () => {
  const client = fakeClient({
    cookbooks: { data: ownedCookbook, error: null },
    recipes: { data: null, error: { message: "connection reset" } },
  });
  const res = responseRecorder();

  await handleCookbookRecipeAdd(
    request({ params: { id: COOKBOOK_ID, recipeId: RECIPE_ID } }),
    res,
    client
  );

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "Recipe not found" });
});

test("adding the same recipe twice is an idempotent no-op, not an error", async () => {
  const results = {
    cookbooks: { data: ownedCookbook, error: null },
    recipes: { data: { id: RECIPE_ID }, error: null },
    // ignoreDuplicates means the second upsert resolves without an error and
    // without returning a row, exactly like the first.
    cookbook_recipes: { data: null, error: null },
  };

  for (const attempt of [1, 2]) {
    const client = fakeClient(results);
    const res = responseRecorder();

    await handleCookbookRecipeAdd(
      request({ params: { id: COOKBOOK_ID, recipeId: RECIPE_ID } }),
      res,
      client
    );

    assert.equal(res.statusCode, 200, `attempt ${attempt} should succeed`);
    assert.deepEqual(res.body, {
      added: true,
      cookbookId: COOKBOOK_ID,
      recipeId: RECIPE_ID,
      cookbookTitle: "Weeknights",
    });
    assert.deepEqual(
      client.calls.find(([table, method]) => table === "cookbook_recipes" && method === "upsert"),
      [
        "cookbook_recipes",
        "upsert",
        [{ cookbook_id: COOKBOOK_ID, recipe_id: RECIPE_ID }],
        { onConflict: "cookbook_id,recipe_id", ignoreDuplicates: true },
      ],
      "duplicates must be absorbed by the upsert, not surfaced as a 500"
    );
  }
});

test("a genuine write failure on add is a 500, not a false success", async () => {
  const client = fakeClient({
    cookbooks: { data: ownedCookbook, error: null },
    recipes: { data: { id: RECIPE_ID }, error: null },
    cookbook_recipes: { data: null, error: { message: "deadlock detected" } },
  });
  const res = responseRecorder();
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args);

  try {
    await handleCookbookRecipeAdd(
      request({ params: { id: COOKBOOK_ID, recipeId: RECIPE_ID } }),
      res,
      client
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "Failed to add recipe to cookbook" });
  assert.equal(logged.length, 1);
});

test("a successful remove scopes the delete to the cookbook and recipe", async () => {
  const client = fakeClient({
    cookbooks: { data: ownedCookbook, error: null },
    cookbook_recipes: { data: null, error: null },
  });
  const res = responseRecorder();

  await handleCookbookRecipeRemove(
    request({ params: { id: COOKBOOK_ID, recipeId: RECIPE_ID } }),
    res,
    client
  );

  assert.deepEqual(res.body, {
    added: false,
    cookbookId: COOKBOOK_ID,
    recipeId: RECIPE_ID,
    cookbookTitle: "Weeknights",
  });
  assert.deepEqual(
    client.calls.filter(([table]) => table === "cookbook_recipes"),
    [
      ["cookbook_recipes", "delete"],
      ["cookbook_recipes", "eq", "cookbook_id", COOKBOOK_ID],
      ["cookbook_recipes", "eq", "recipe_id", RECIPE_ID],
    ],
    "the delete must only ever touch the membership row, never the recipe"
  );
  assert.equal(
    client.tables.includes("recipes"),
    false,
    "removing a recipe from a cookbook must not touch the recipes table"
  );
});

test("quick-create rejects an invalid title before touching the database", async () => {
  for (const title of [undefined, null, "", "   ", 42, ["Dinners"], "x".repeat(201)]) {
    const res = responseRecorder();
    const client = fakeClient();
    await handleCookbookCreate(request({ body: { title } }), res, client);

    assert.equal(res.statusCode, 400, `${String(title)} should be rejected`);
    assert.ok(res.body.error, "a user-facing reason is returned");
    assert.deepEqual(client.tables, [], `${String(title)} must not open a query`);
  }
});

test("quick-create always stamps the new cookbook with the caller's id", async () => {
  const client = fakeClient({ cookbooks: { data: ownedCookbook, error: null } });
  const res = responseRecorder();

  await handleCookbookCreate(
    request({ body: { title: "  Weeknights  ", user_id: "someone-else" } }),
    res,
    client
  );

  assert.deepEqual(client.calls[0], [
    "cookbooks",
    "insert",
    [{ user_id: "owner-1", title: "Weeknights" }],
  ]);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, {
    cookbook: { id: COOKBOOK_ID, title: "Weeknights", containsRecipe: false },
  });
});
