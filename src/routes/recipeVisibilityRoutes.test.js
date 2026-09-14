import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const {
  handleRecipeCreate,
  handleRecipeUpdate,
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
