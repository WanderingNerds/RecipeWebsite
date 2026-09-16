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
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { getCookbookRecipes, handleCookbookView } = await import("./cookbookRoutes.js");

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
