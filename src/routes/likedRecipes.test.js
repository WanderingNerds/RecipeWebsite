/**
 * REW-87: handler-level coverage for GET /recipes/liked ("My Favorites").
 *
 * Same responseRecorder() + injected-fake-client style as
 * recipeVisibilityToggle.test.js, so no live Supabase is needed. The point of
 * these tests is the data contract the standardized favorites card depends
 * on: published-only, liked-at ordering, flattened categories/tags, and
 * isLiked stamped without a second query.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { handleLikedRecipes } = await import("./index.js");

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
 * Thenable fake PostgREST query builder: the handler awaits the chain
 * directly rather than calling .single()/.maybeSingle(), so the fake has to
 * be awaitable too. Every call is recorded so a test can assert the filters.
 */
function fakeQuery(table, result, calls) {
  const query = {
    select(...args) { calls.push([table, "select", ...args]); return query; },
    order(...args) { calls.push([table, "order", ...args]); return query; },
    in(...args) { calls.push([table, "in", ...args]); return query; },
    eq(...args) { calls.push([table, "eq", ...args]); return query; },
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return query;
}

function fakeClients({ likes, likesError = null, recipes, recipesError = null } = {}) {
  const calls = [];
  const tables = [];
  return {
    calls,
    tables,
    createClient: () => ({
      from(table) {
        tables.push(["scoped", table]);
        return fakeQuery(table, { data: likes, error: likesError }, calls);
      },
    }),
    publicClient: {
      from(table) {
        tables.push(["anon", table]);
        return fakeQuery(table, { data: recipes, error: recipesError }, calls);
      },
    },
  };
}

function request(overrides = {}) {
  return {
    user: { id: "viewer-1" },
    accessToken: "token",
    flash() {},
    ...overrides,
  };
}

const likedNewestFirst = [
  { recipe_id: NEWER, created_at: "2026-02-01T00:00:00Z" },
  { recipe_id: OLDER, created_at: "2026-01-01T00:00:00Z" },
];

function recipeRow(id, overrides = {}) {
  return {
    id,
    user_id: "author-1",
    title: `Recipe ${id}`,
    status: "published",
    author: "Chef",
    original_author: null,
    prep_time: "10 minutes",
    cook_time: "30 minutes",
    servings: "4",
    difficulty: "Easy",
    thumbnail_url: null,
    created_at: "2026-01-01T00:00:00Z",
    recipe_categories: [{ categories: { id: "c1", name: "Dinner", slug: "dinner", icon: "*" } }],
    recipe_tags: [{ tags: { id: "t1", name: "Family", slug: "family" } }],
    ...overrides,
  };
}

test("favorites are fetched published-only, with the columns the card needs", async () => {
  const clients = fakeClients({
    likes: likedNewestFirst,
    recipes: [recipeRow(OLDER), recipeRow(NEWER)],
  });
  const res = responseRecorder();
  await handleLikedRecipes(request(), res, clients);

  // recipe_likes stays on the request-scoped client; the recipe rows come
  // from the anon client exactly as Browse does.
  assert.deepEqual(clients.tables, [["scoped", "recipe_likes"], ["anon", "recipes"]]);

  const recipeSelect = clients.calls.find(([table, method]) => table === "recipes" && method === "select");
  for (const column of ["user_id", "status", "original_author", "recipe_categories(", "recipe_tags("]) {
    assert.ok(recipeSelect[2].includes(column), `card query must select ${column}`);
  }

  // The published filter is what stops a favorite that was later made
  // Private from rendering to someone who once favorited it.
  assert.ok(
    clients.calls.some(([table, method, column, value]) =>
      table === "recipes" && method === "eq" && column === "status" && value === "published"
    ),
    "published-only filter must be applied"
  );
  assert.ok(
    clients.calls.some(([table, method, column]) => table === "recipes" && method === "in" && column === "id"),
    "recipes are fetched by id in one query, not per recipe"
  );
});

test("liked-at ordering survives the recipe fetch, which returns rows in any order", async () => {
  const clients = fakeClients({
    likes: likedNewestFirst,
    // Deliberately the opposite order to the likes list.
    recipes: [recipeRow(OLDER), recipeRow(NEWER)],
  });
  const res = responseRecorder();
  await handleLikedRecipes(request(), res, clients);

  assert.equal(res.renderedView, "recipes/liked");
  assert.deepEqual(res.renderedLocals.recipes.map(r => r.id), [NEWER, OLDER]);
  assert.ok(
    clients.calls.some(([table, method, column, options]) =>
      table === "recipe_likes" && method === "order" && column === "created_at" && options.ascending === false
    ),
    "likes are read newest-first"
  );
});

test("every favorite is stamped isLiked and has flattened categories and tags", async () => {
  const clients = fakeClients({ likes: likedNewestFirst, recipes: [recipeRow(NEWER), recipeRow(OLDER)] });
  const res = responseRecorder();
  await handleLikedRecipes(request(), res, clients);

  for (const recipe of res.renderedLocals.recipes) {
    assert.equal(recipe.isLiked, true);
    assert.deepEqual(recipe.categories, [{ id: "c1", name: "Dinner", slug: "dinner", icon: "*" }]);
    assert.deepEqual(recipe.tags, [{ id: "t1", name: "Family", slug: "family" }]);
    // The junction rows themselves are not handed to the view.
    assert.equal(recipe.recipe_categories, undefined);
    assert.equal(recipe.recipe_tags, undefined);
  }
});

test("missing category and tag links flatten to empty arrays, not undefined", async () => {
  const clients = fakeClients({
    likes: [likedNewestFirst[0]],
    recipes: [recipeRow(NEWER, { recipe_categories: null, recipe_tags: [{ tags: null }] })],
  });
  const res = responseRecorder();
  await handleLikedRecipes(request(), res, clients);

  assert.deepEqual(res.renderedLocals.recipes[0].categories, []);
  assert.deepEqual(res.renderedLocals.recipes[0].tags, []);
});

test("a favorite that is no longer published simply drops off the page", async () => {
  // The recipes query returns only the published row; the other liked id has
  // no match and must not render as a hole.
  const clients = fakeClients({ likes: likedNewestFirst, recipes: [recipeRow(OLDER)] });
  const res = responseRecorder();
  await handleLikedRecipes(request(), res, clients);

  assert.deepEqual(res.renderedLocals.recipes.map(r => r.id), [OLDER]);
});

test("no favorites renders the empty state without a second query", async () => {
  const clients = fakeClients({ likes: [] });
  const res = responseRecorder();
  await handleLikedRecipes(request(), res, clients);

  assert.equal(res.renderedView, "recipes/liked");
  assert.deepEqual(res.renderedLocals, { title: "My Favorites", recipes: [] });
  assert.deepEqual(clients.tables, [["scoped", "recipe_likes"]]);
});

test("either query failing redirects to the dashboard instead of rendering", async () => {
  for (const clients of [
    fakeClients({ likes: null, likesError: { message: "boom" } }),
    fakeClients({ likes: likedNewestFirst, recipes: null, recipesError: { message: "boom" } }),
  ]) {
    const res = responseRecorder();
    await handleLikedRecipes(request(), res, clients);
    assert.equal(res.renderedView, null);
    assert.equal(res.redirectPath, "/dashboard");
  }
});

test("the page is titled My Favorites (REW-66 terminology)", async () => {
  const clients = fakeClients({ likes: likedNewestFirst, recipes: [recipeRow(NEWER), recipeRow(OLDER)] });
  const res = responseRecorder();
  await handleLikedRecipes(request(), res, clients);
  assert.equal(res.renderedLocals.title, "My Favorites");
});
