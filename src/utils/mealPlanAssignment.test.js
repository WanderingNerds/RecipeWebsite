import test from "node:test";
import assert from "node:assert/strict";
import { assignRecipeToMealPlan } from "./mealPlanAssignment.js";

const PLAN_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const RECIPE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const USER_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function createClient({ mealPlan = { id: PLAN_ID, title: "This Week" }, lookupError = null, upsertError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      if (table === "meal_plans") {
        const query = {
          select(columns) { calls.push(["select", columns]); return query; },
          eq(column, value) { calls.push(["eq", column, value]); return query; },
          async maybeSingle() { return { data: mealPlan, error: lookupError }; },
        };
        return query;
      }
      return {
        async upsert(records, options) {
          calls.push(["upsert", records, options]);
          return { error: upsertError };
        },
      };
    },
  };
}

test("skips assignment when no meal plan is selected", async () => {
  const client = createClient();
  const result = await assignRecipeToMealPlan(client, { recipeId: RECIPE_ID, userId: USER_ID });
  assert.deepEqual(result, { status: "skipped" });
  assert.deepEqual(client.calls, []);
});

test("rejects malformed plan IDs without querying", async () => {
  const client = createClient();
  const result = await assignRecipeToMealPlan(client, { mealPlanId: "not-a-uuid", recipeId: RECIPE_ID, userId: USER_ID });
  assert.deepEqual(result, { status: "failed" });
  assert.deepEqual(client.calls, []);
});

test("does not assign a missing, stale, or foreign plan", async () => {
  const client = createClient({ mealPlan: null });
  const result = await assignRecipeToMealPlan(client, { mealPlanId: PLAN_ID, recipeId: RECIPE_ID, userId: USER_ID });
  assert.deepEqual(result, { status: "failed" });
  assert.equal(client.calls.some((call) => call[0] === "upsert"), false);
  assert.deepEqual(client.calls.filter((call) => call[0] === "eq"), [
    ["eq", "id", PLAN_ID],
    ["eq", "user_id", USER_ID],
  ]);
});

test("idempotently assigns a recipe to an owned plan", async () => {
  const client = createClient();
  const result = await assignRecipeToMealPlan(client, { mealPlanId: PLAN_ID, recipeId: RECIPE_ID, userId: USER_ID });
  assert.deepEqual(result, { status: "assigned", mealPlanTitle: "This Week" });
  assert.deepEqual(client.calls.find((call) => call[0] === "upsert"), [
    "upsert",
    [{ meal_plan_id: PLAN_ID, recipe_id: RECIPE_ID }],
    { onConflict: "meal_plan_id,recipe_id", ignoreDuplicates: true },
  ]);
});

test("returns failure when lookup or membership write fails", async () => {
  const lookupClient = createClient({ lookupError: { message: "lookup failed" } });
  assert.deepEqual(
    await assignRecipeToMealPlan(lookupClient, { mealPlanId: PLAN_ID, recipeId: RECIPE_ID, userId: USER_ID }),
    { status: "failed" }
  );

  const upsertClient = createClient({ upsertError: { message: "insert failed" } });
  assert.deepEqual(
    await assignRecipeToMealPlan(upsertClient, { mealPlanId: PLAN_ID, recipeId: RECIPE_ID, userId: USER_ID }),
    { status: "failed" }
  );
});

test("turns unexpected database exceptions into partial-success failure", async () => {
  const client = { from() { throw new Error("offline"); } };
  assert.deepEqual(
    await assignRecipeToMealPlan(client, { mealPlanId: PLAN_ID, recipeId: RECIPE_ID, userId: USER_ID }),
    { status: "failed" }
  );
});
