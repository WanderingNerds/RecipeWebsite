import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { handleRecipeCreate } = await import("./recipeRoutes.js");
const { handleImportForm, handleImportSave } = await import("./importRoutes.js");

const PLAN_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const RECIPE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const USER_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function createClient({ mealPlan = { id: PLAN_ID, title: "This Week" }, upsertError = null } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      calls.push(["from", table]);
      if (table === "recipes") {
        let operation = "lookup";
        const query = {
          insert(records) { operation = "insert"; calls.push(["recipeInsert", records]); return query; },
          select() { return query; },
          eq() { return query; },
          ilike() { return query; },
          async single() {
            return operation === "insert"
              ? { data: { id: RECIPE_ID }, error: null }
              : { data: null, error: { code: "PGRST116" } };
          },
        };
        return query;
      }
      if (table === "meal_plans") {
        const query = {
          select() { return query; },
          eq(column, value) { calls.push(["planEq", column, value]); return query; },
          async maybeSingle() { return { data: mealPlan, error: null }; },
        };
        return query;
      }
      if (table === "meal_plan_recipes") {
        return {
          async upsert(records, options) {
            calls.push(["membershipUpsert", records, options]);
            return { error: upsertError };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
  return client;
}

function request(body) {
  const flashes = [];
  return {
    body,
    user: { id: USER_ID, email: "cook@example.com", user_metadata: {} },
    accessToken: "access-token",
    flash: (...args) => flashes.push(args),
    flashes,
  };
}

function response() {
  const output = {};
  return {
    output,
    status(code) { output.status = code; return this; },
    json(body) { output.json = body; return this; },
    redirect(path) { output.redirect = path; return this; },
    render(view, data) { output.render = { view, data }; return this; },
  };
}

const manualBody = (mealPlanId) => ({
  title: "Soup",
  instructions: "Simmer.",
  prepTime: "10 min",
  cookTime: "30 min",
  action: "publish",
  mealPlanId,
});

const importBody = (mealPlanId) => ({
  title: "Soup",
  instructions: "Simmer.",
  action: "publish",
  mealPlanId,
});

async function runFlow(flow, options = {}) {
  const client = createClient(options);
  const req = request(flow === "manual" ? manualBody(options.mealPlanId) : importBody(options.mealPlanId));
  const res = response();
  const originalError = console.error;
  console.error = () => {};
  try {
    if (flow === "manual") {
      await handleRecipeCreate(req, res, { createClient: () => client });
    } else {
      await handleImportSave(req, res, { createClient: () => client });
    }
  } finally {
    console.error = originalError;
  }
  return { client, req, res };
}

for (const flow of ["manual", "import"]) {
  test(`${flow} save with no plan persists recipe and skips membership queries`, async () => {
    const { client, req, res } = await runFlow(flow);
    assert.equal(client.calls.filter((call) => call[0] === "recipeInsert").length, 1);
    assert.equal(client.calls.some((call) => call[1] === "meal_plans" || call[1] === "meal_plan_recipes"), false);
    assert.equal(req.flashes.some(([type]) => type === "error"), false);
    if (flow === "manual") assert.equal(res.output.redirect, "/recipes");
    else assert.equal(res.output.json.success, true);
  });

  test(`${flow} save assigns the newly inserted recipe to an owned plan`, async () => {
    const { client, req, res } = await runFlow(flow, { mealPlanId: PLAN_ID });
    assert.deepEqual(client.calls.filter((call) => call[0] === "planEq"), [
      ["planEq", "id", PLAN_ID],
      ["planEq", "user_id", USER_ID],
    ]);
    assert.deepEqual(client.calls.find((call) => call[0] === "membershipUpsert"), [
      "membershipUpsert",
      [{ meal_plan_id: PLAN_ID, recipe_id: RECIPE_ID }],
      { onConflict: "meal_plan_id,recipe_id", ignoreDuplicates: true },
    ]);
    assert.match(req.flashes.find(([type]) => type === "success")[1], /Added to This Week/);
    if (flow === "manual") assert.equal(res.output.redirect, "/recipes");
    else assert.deepEqual(res.output.json.mealPlanAssignment, { status: "assigned", mealPlanTitle: "This Week" });
  });

  for (const scenario of [
    ["malformed", { mealPlanId: "not-a-uuid" }],
    ["foreign or stale", { mealPlanId: PLAN_ID, mealPlan: null }],
    ["membership failure", { mealPlanId: PLAN_ID, upsertError: { code: "42501" } }],
  ]) {
    test(`${flow} save remains successful with a warning for ${scenario[0]} plan assignment`, async () => {
      const { client, req, res } = await runFlow(flow, scenario[1]);
      assert.equal(client.calls.filter((call) => call[0] === "recipeInsert").length, 1);
      assert.match(req.flashes.find(([type]) => type === "error")[1], /Recipe saved, but it could not be added/);
      if (flow === "manual") {
        assert.equal(res.output.redirect, "/recipes");
      } else {
        assert.equal(res.output.json.success, true);
        assert.deepEqual(res.output.json.mealPlanAssignment, { status: "failed" });
      }
    });
  }
}

test("import form renders with an empty plan list when the plan query throws", async () => {
  const req = request({});
  const res = response();
  const originalError = console.error;
  console.error = () => {};
  try {
    await handleImportForm(req, res, { createClient: () => ({ from() { throw new Error("offline"); } }) });
  } finally {
    console.error = originalError;
  }
  assert.equal(res.output.render.view, "recipes/import");
  assert.deepEqual(res.output.render.data.mealPlans, []);
});

