import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { default: router, handleRecipeClone } = await import("./recipeRoutes.js");

const SOURCE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ADDED_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const OWNER_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const VIEWER_ID = "7ba7b810-9dad-11d1-80b4-00c04fd430c9";

const source = {
  id: SOURCE_ID, user_id: OWNER_ID, title: "Soup", author: "Chef Ada",
  prep_time: "5m", cook_time: "20m", servings: "4", difficulty: "Easy",
  ingredients: "Water", instructions: "Simmer", notes: "Warm",
  source_url: "https://example.test/soup", status: "published", original_author: null,
  photo_url: "https://storage.test/photo.jpg", thumbnail_url: "https://storage.test/thumb.jpg",
  created_at: "forged", tags: ["not copied"], user_id_from_browser: "forged",
};

function response() {
  return {
    redirected: null,
    redirect(path) { this.redirected = path; return this; },
  };
}

function request({ id = SOURCE_ID, userId = VIEWER_ID } = {}) {
  const flashes = [];
  return {
    params: { id }, user: { id: userId }, accessToken: "token",
    flash: (...args) => flashes.push(args), flashes,
  };
}

function client({ sourceRecipe = source, sourceError = null, categoryReadError = null, categoryInsertError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      let operation = "read";
      const query = {
        select(columns) { calls.push(["select", table, columns]); return query; },
        eq(column, value) { calls.push(["eq", table, column, value]); return query; },
        insert(rows) { operation = "insert"; calls.push(["insert", table, rows]); return query; },
        delete() { operation = "delete"; calls.push(["delete", table]); return query; },
        async single() {
          if (table === "recipes" && operation === "read") return { data: sourceRecipe, error: sourceError };
          if (table === "recipes" && operation === "insert") return { data: { id: ADDED_ID }, error: null };
          throw new Error(`Unexpected single for ${table}/${operation}`);
        },
        then(resolve) {
          if (table === "recipe_categories" && operation === "read") {
            return Promise.resolve({ data: [{ category_id: "cat-1" }, { category_id: "cat-2" }], error: categoryReadError }).then(resolve);
          }
          if (table === "recipe_categories" && operation === "insert") {
            return Promise.resolve({ error: categoryInsertError }).then(resolve);
          }
          if (table === "recipes" && operation === "delete") return Promise.resolve({ error: null }).then(resolve);
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

test("Add Recipe is registered as an authenticated, limited, CSRF-protected POST", () => {
  const route = router.stack.find((layer) => layer.route?.path === "/:id/clone").route;
  assert.equal(route.methods.post, true);
  assert.equal(route.methods.get, undefined);
  assert.equal(route.stack.length, 4);
});

test("Add Recipe copies only allowed content, categories, and server-owned provenance", async () => {
  const db = client();
  const req = request();
  const res = response();
  await handleRecipeClone(req, res, { createClient: () => db });

  const recipeInsert = db.calls.find(([method, table]) => method === "insert" && table === "recipes")[2][0];
  assert.deepEqual(recipeInsert, {
    user_id: VIEWER_ID, title: "Soup", author: "Chef Ada", prep_time: "5m", cook_time: "20m",
    servings: "4", difficulty: "Easy", ingredients: "Water", instructions: "Simmer", notes: "Warm",
    source_url: "https://example.test/soup", photo_url: null, thumbnail_url: null, status: "draft",
    cloned_from_recipe_id: SOURCE_ID, original_author: "Chef Ada",
  });
  assert.deepEqual(db.calls.find(([method, table]) => method === "insert" && table === "recipe_categories")[2], [
    { recipe_id: ADDED_ID, category_id: "cat-1" },
    { recipe_id: ADDED_ID, category_id: "cat-2" },
  ]);
  assert.equal(res.redirected, `/recipes/${ADDED_ID}`);
  assert.deepEqual(req.flashes.at(-1), ["success", "Recipe added as Private!"]);
});

test("a clone of a clone propagates root attribution and records its direct source", async () => {
  const db = client({ sourceRecipe: { ...source, author: "Adapter", original_author: "Root Chef" } });
  await handleRecipeClone(request(), response(), { createClient: () => db });
  const inserted = db.calls.find(([method, table]) => method === "insert" && table === "recipes")[2][0];
  assert.equal(inserted.original_author, "Root Chef");
  assert.equal(inserted.cloned_from_recipe_id, SOURCE_ID);
});

test("malformed, inaccessible, and owner sources never insert", async () => {
  let madeClient = false;
  const malformedReq = request({ id: "not-a-uuid" });
  await handleRecipeClone(malformedReq, response(), { createClient: () => { madeClient = true; } });
  assert.equal(madeClient, false);

  for (const options of [
    { sourceRecipe: null, sourceError: { code: "PGRST116" } },
    { sourceRecipe: source, userId: OWNER_ID },
  ]) {
    const db = client(options);
    const req = request({ userId: options.userId });
    await handleRecipeClone(req, response(), { createClient: () => db });
    assert.equal(db.calls.some(([method]) => method === "insert"), false);
  }
});

test("category failure removes the incomplete recipe and reports no success", async () => {
  const db = client({ categoryInsertError: { code: "42501" } });
  const req = request();
  const res = response();
  const originalError = console.error;
  console.error = () => {};
  try {
    await handleRecipeClone(req, res, { createClient: () => db });
  } finally {
    console.error = originalError;
  }
  assert.ok(db.calls.some(([method, table]) => method === "delete" && table === "recipes"));
  assert.deepEqual(db.calls.filter(([method, table]) => method === "eq" && table === "recipes").slice(-2), [
    ["eq", "recipes", "id", ADDED_ID],
    ["eq", "recipes", "user_id", VIEWER_ID],
  ]);
  assert.equal(req.flashes.some(([kind]) => kind === "success"), false);
  assert.equal(res.redirected, "/recipes");
});
