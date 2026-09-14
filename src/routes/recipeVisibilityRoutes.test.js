import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const {
  handleRecipeCreate,
  handleRecipeCloneForm,
  handleRecipeUpdate,
  suggestCloneTitle,
} = await import("./recipeRoutes.js");

function responseRecorder() {
  return {
    redirectPath: null,
    renderCall: null,
    redirect(path) { this.redirectPath = path; },
    render(view, data) { this.renderCall = { view, data }; },
  };
}

test("manual create persists Public and fails closed to Private", async () => {
  for (const [visibility, expected] of [["public", "published"], ["private", "draft"], [["public"], "draft"], [undefined, "draft"]]) {
    const inserted = [];
    const query = {
      insert(rows) { inserted.push(...rows); return this; }, select() { return this; },
      async single() { return { data: { id: "new-id" }, error: null }; },
    };
    const req = {
      body: { title: "Soup", instructions: "Simmer", prepTime: "5m", cookTime: "20m", visibility },
      user: { id: "owner" }, accessToken: "token", flash() {},
    };
    await handleRecipeCreate(req, responseRecorder(), { createClient: () => ({ from: () => query }) });
    assert.equal(inserted[0].user_id, "owner");
    assert.equal(inserted[0].status, expected);
  }
});

test("clone title suggestions avoid case-insensitive collisions", () => {
  assert.equal(suggestCloneTitle("Soup", []), "Soup (Copy)");
  assert.equal(suggestCloneTitle("Soup", ["soup (copy)", "Soup (Copy 2)"]), "Soup (Copy 3)");
});

test("clone form copies only editable fields and always starts Private", async () => {
  const source = {
    id: "source", user_id: "other", title: "Soup", status: "published",
    author: "Chef", prep_time: "5m", cook_time: "20m", servings: "4", difficulty: "Easy",
    ingredients: "Water", instructions: "Simmer", notes: "Warm", photo_url: "https://example.test/source.jpg",
  };
  const relationResults = [
    { data: [{ category_id: "cat-1", categories: { id: "cat-1", name: "Dinner" } }] },
    { data: [{ tag_id: "tag-1", tags: { id: "tag-1", name: "Warm" } }] },
  ];
  const genericResults = [{ data: [] }, { data: [] }, { data: [] }, { data: [{ title: "Soup (Copy)" }] }];
  let relationIndex = 0;
  let genericIndex = 0;
  const client = {
    from(table) {
      const query = {
        select() { return this; }, eq() { return this; }, order() { return Promise.resolve(genericResults[genericIndex++]); },
        single() { return Promise.resolve({ data: source, error: null }); },
        then(resolve) {
          if (table === "recipe_categories" || table === "recipe_tags") return Promise.resolve(relationResults[relationIndex++]).then(resolve);
          return Promise.resolve(genericResults[genericIndex++]).then(resolve);
        },
      };
      return query;
    },
  };
  const req = { params: { id: "source" }, user: { id: "cloner" }, accessToken: "token", flash() {} };
  const res = responseRecorder();
  await handleRecipeCloneForm(req, res, { createClient: () => client });
  assert.equal(res.renderCall.view, "recipes/new");
  assert.equal(res.renderCall.data.visibility, "private");
  assert.equal(res.renderCall.data.recipe.title, "Soup (Copy 2)");
  assert.equal(res.renderCall.data.recipe.photo_url, undefined);
  assert.deepEqual(res.renderCall.data.selectedCategories, ["cat-1"]);
  assert.deepEqual(res.renderCall.data.selectedTags, ["Warm"]);
});

test("clone form conceals a source that is not RLS-visible", async () => {
  const query = { select() { return this; }, eq() { return this; }, async single() { return { data: null, error: { code: "PGRST116" } }; } };
  const req = { params: { id: "private-source" }, user: { id: "viewer" }, accessToken: "token", flash() {} };
  const res = responseRecorder();
  await handleRecipeCloneForm(req, res, { createClient: () => ({ from: () => query }) });
  assert.equal(res.redirectPath, "/recipes");
  assert.equal(res.renderCall, null);
});

test("owner updates switch Public and Private with explicit id and user_id filters", async () => {
  for (const [visibility, expectedStatus] of [["public", "published"], ["private", "draft"]]) {
    const calls = [];
    const query = {
      update(value) { calls.push(["update", value]); return this; },
      eq(...args) { calls.push(["eq", ...args]); return this; },
      select() { calls.push(["select"]); return this; },
      async single() { return { data: { id: "recipe-1" }, error: null }; },
    };
    const req = {
      params: { id: "recipe-1" },
      body: { title: "Soup", instructions: "Cook", prepTime: "5m", cookTime: "20m", visibility },
      user: { id: "owner-1" }, accessToken: "token", flash() {},
    };
    const res = responseRecorder();
    await handleRecipeUpdate(req, res, { createClient: () => ({ from: () => query }) });
    assert.equal(calls[0][1].status, expectedStatus);
    assert.deepEqual(calls.filter(([method]) => method === "eq"), [
      ["eq", "id", "recipe-1"], ["eq", "user_id", "owner-1"],
    ]);
    assert.equal(res.redirectPath, "/recipes/recipe-1");
  }
});

test("a non-owner update failure cannot continue to relationship mutations", async () => {
  const tables = [];
  const query = {
    update() { return this; }, eq() { return this; }, select() { return this; },
    async single() { return { data: null, error: { code: "PGRST116" } }; },
  };
  const req = {
    params: { id: "recipe-1" },
    body: { title: "Soup", instructions: "Cook", prepTime: "5m", cookTime: "20m", visibility: "public", categories: ["forged"] },
    user: { id: "not-owner" }, accessToken: "token", flash() {},
  };
  const res = responseRecorder();
  await handleRecipeUpdate(req, res, { createClient: () => ({ from(table) { tables.push(table); return query; } }) });
  assert.deepEqual(tables, ["recipes"]);
  assert.equal(res.redirectPath, "/recipes/recipe-1/edit");
});
