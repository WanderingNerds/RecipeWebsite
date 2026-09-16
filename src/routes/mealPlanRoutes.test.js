/**
 * REW-89: handler-level coverage for GET /meal-plans/:id and the widened
 * getMealPlanRecipes helper behind it.
 *
 * Same responseRecorder() + injected-fake-client style as
 * cookbookRoutes.test.js and mealPlanVisibilityRoutes.test.js, so no live
 * Supabase is needed. The point of these tests is the data contract the
 * standardized meal plan card depends on: the columns it needs, flattened
 * categories/tags, and a like status batched into one query rather than one
 * per recipe.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { getMealPlanRecipes, handleMealPlanView } = await import("./mealPlanRoutes.js");

const MEAL_PLAN_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
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
  mealPlan = {
    id: MEAL_PLAN_ID,
    title: "Week of Sept 20",
    start_date: "2026-09-20",
    end_date: "2026-09-26",
    is_public: false,
  },
  mealPlanError = null,
  rows = [],
  rowsError = null,
  likes = [],
  likesError = null,
} = {}) {
  const calls = [];
  const tables = [];
  const results = {
    meal_plans: { data: mealPlan, error: mealPlanError },
    meal_plan_recipes: { data: rows, error: rowsError },
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
    params: { id: MEAL_PLAN_ID },
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
// getMealPlanRecipes -- the widened read
// ---------------------------------------------------------------------------

test("the meal plan recipe query asks for every column the standardized card needs", async () => {
  const fake = fakeClient({ rows: [junctionRow(NEWER)] });
  await getMealPlanRecipes(fake.client, MEAL_PLAN_ID);

  assert.deepEqual(fake.tables, ["meal_plan_recipes"]);
  const select = fake.calls.find(([table, method]) => table === "meal_plan_recipes" && method === "select");
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

  // Body fields stay off a listing query -- getMealPlanRecipeIngredients() is
  // the one that reads ingredients, and only for the grocery list (REW-26).
  for (const column of ["instructions", "notes", "ingredients"]) {
    assert.ok(!select[2].includes(column), `card query must not select ${column}`);
  }

  // Scoped to this plan, in added-to-plan order (the junction row's
  // created_at), newest first -- unchanged by the widening.
  assert.ok(
    fake.calls.some(([table, method, column, value]) =>
      table === "meal_plan_recipes" && method === "eq" && column === "meal_plan_id" && value === MEAL_PLAN_ID
    ),
    "query must be scoped to the meal plan"
  );
  assert.ok(
    fake.calls.some(([table, method, column, options]) =>
      table === "meal_plan_recipes" && method === "order" && column === "created_at" && options.ascending === false
    ),
    "rows are read newest-added first"
  );
});

test("categories and tags are flattened, and the junction rows are not handed to the view", async () => {
  const fake = fakeClient({ rows: [junctionRow(NEWER)] });
  const [recipe] = await getMealPlanRecipes(fake.client, MEAL_PLAN_ID);

  assert.deepEqual(recipe.categories, [{ id: "c1", name: "Dinner", slug: "dinner", icon: "*" }]);
  assert.deepEqual(recipe.tags, [{ id: "t1", name: "Family", slug: "family" }]);
  assert.equal(recipe.recipe_categories, undefined);
  assert.equal(recipe.recipe_tags, undefined);
  // user_id is fetched deliberately: the card computes isOwner from it. It
  // matters more here than on any earlier surface, because a meal plan can
  // genuinely hold another user's published recipe (migration 012).
  assert.equal(recipe.user_id, OWNER_ID);
});

test("missing category and tag links flatten to empty arrays, not undefined", async () => {
  const fake = fakeClient({
    rows: [junctionRow(NEWER, { recipe_categories: null, recipe_tags: [{ tags: null }] })],
  });
  const [recipe] = await getMealPlanRecipes(fake.client, MEAL_PLAN_ID);

  assert.deepEqual(recipe.categories, []);
  assert.deepEqual(recipe.tags, []);
});

test("a membership row whose recipe vanished mid-query is dropped, not rendered as a hole", async () => {
  // Deleted outright, or another user's recipe that has since been switched
  // from Public to Private -- RLS hides both, and the page must survive it.
  const fake = fakeClient({
    rows: [junctionRow(NEWER), { recipe_id: OLDER, created_at: "2026-01-01T00:00:00Z", recipes: null }],
  });
  const recipes = await getMealPlanRecipes(fake.client, MEAL_PLAN_ID);

  assert.deepEqual(recipes.map((r) => r.id), [NEWER]);
});

test("a failed recipe read yields an empty meal plan rather than throwing", async () => {
  const fake = fakeClient({ rows: null, rowsError: { message: "boom" } });
  assert.deepEqual(await getMealPlanRecipes(fake.client, MEAL_PLAN_ID), []);
});

// ---------------------------------------------------------------------------
// GET /meal-plans/:id -- batched like status
// ---------------------------------------------------------------------------

test("like status is stamped from one batched query, not one query per recipe", async () => {
  const fake = fakeClient({
    rows: [junctionRow(NEWER), junctionRow(OLDER)],
    likes: [{ recipe_id: NEWER }],
  });
  const res = responseRecorder();
  await handleMealPlanView(request(), res, fake);

  // One meal plan read, one recipe read, one likes read -- regardless of how
  // many recipes are in the plan.
  assert.deepEqual(fake.tables, ["meal_plans", "meal_plan_recipes", "recipe_likes"]);

  assert.equal(res.renderedView, "meal-plans/view");
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

test("an empty meal plan issues no likes query at all", async () => {
  const fake = fakeClient({ rows: [] });
  const res = responseRecorder();
  await handleMealPlanView(request(), res, fake);

  assert.deepEqual(fake.tables, ["meal_plans", "meal_plan_recipes"]);
  assert.deepEqual(res.renderedLocals.recipes, []);
});

test("a failed likes query still renders the page, with every heart unfavorited", async () => {
  const fake = fakeClient({
    rows: [junctionRow(NEWER)],
    likes: null,
    likesError: { message: "boom" },
  });
  const res = responseRecorder();
  await handleMealPlanView(request(), res, fake);

  assert.equal(res.renderedView, "meal-plans/view");
  assert.equal(res.renderedLocals.recipes[0].isLiked, false);
});

test("the page is still plan-owner scoped and still passes its share-link locals", async () => {
  const fake = fakeClient({ rows: [junctionRow(NEWER)] });
  const res = responseRecorder();
  await handleMealPlanView(request(), res, fake);

  assert.deepEqual(
    fake.calls.filter(([table, method]) => table === "meal_plans" && method === "eq"),
    [["meal_plans", "eq", "id", MEAL_PLAN_ID], ["meal_plans", "eq", "user_id", OWNER_ID]]
  );
  assert.equal(res.renderedLocals.title, "Week of Sept 20");
  assert.equal(res.renderedLocals.mealPlan.id, MEAL_PLAN_ID);
  assert.ok(res.renderedLocals.appUrl, "appUrl is still supplied for the share panel");
});

test("a non-UUID id and a meal plan the caller does not own are indistinguishable", async () => {
  const badId = fakeClient();
  const badIdRes = responseRecorder();
  await handleMealPlanView(request({ params: { id: "not-a-uuid" } }), badIdRes, badId);
  assert.equal(badIdRes.renderedView, null);
  assert.equal(badIdRes.redirectPath, "/meal-plans");
  assert.deepEqual(badId.tables, [], "a malformed id never reaches the database");

  const notOwned = fakeClient({ mealPlan: null });
  const notOwnedRes = responseRecorder();
  await handleMealPlanView(request(), notOwnedRes, notOwned);
  assert.equal(notOwnedRes.renderedView, null);
  assert.equal(notOwnedRes.redirectPath, "/meal-plans");
  assert.deepEqual(notOwned.tables, ["meal_plans"], "no recipes are read for a plan you do not own");
});

test("both not-found paths flash the same message, so existence is never leaked", async () => {
  const messages = [];
  const flash = (type, message) => messages.push([type, message]);

  await handleMealPlanView(
    request({ params: { id: "not-a-uuid" }, flash }),
    responseRecorder(),
    fakeClient()
  );
  await handleMealPlanView(request({ flash }), responseRecorder(), fakeClient({ mealPlan: null }));

  assert.deepEqual(messages, [
    ["error", "Meal plan not found"],
    ["error", "Meal plan not found"],
  ]);
});
