import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const newRecipeView = await readFile(new URL("../../views/recipes/new.ejs", import.meta.url), "utf8");
const importView = await readFile(new URL("../../views/recipes/import.ejs", import.meta.url), "utf8");
const importClient = await readFile(new URL("../../public/js/import.js", import.meta.url), "utf8");

test("manual recipe form offers one optional existing meal plan", () => {
  assert.match(newRecipeView, /name="mealPlanId"/);
  assert.match(newRecipeView, /Don't add to a meal plan/);
  assert.match(newRecipeView, /mealPlans\.forEach/);
  assert.match(newRecipeView, /\/meal-plans\/new/);
});

test("import review form offers the same optional existing meal plan", () => {
  assert.match(importView, /id="importMealPlanId" name="mealPlanId"/);
  assert.match(importView, /Don't add to a meal plan/);
  assert.match(importView, /mealPlans\.forEach/);
  assert.match(importView, /\/meal-plans\/new/);
});

test("import save payload includes the optional meal plan ID", () => {
  assert.match(importClient, /mealPlanId: importMealPlanId \? importMealPlanId\.value : ""/);
  assert.match(importClient, /window\.location\.href = "\/recipes"/);
});
