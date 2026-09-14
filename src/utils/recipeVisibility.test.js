import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRecipeVisibility,
  visibilityFromRecipeStatus,
} from "./recipeVisibility.js";

test("visibility maps the two UI values to persisted recipe statuses", () => {
  assert.equal(normalizeRecipeVisibility("private"), "draft");
  assert.equal(normalizeRecipeVisibility("public"), "published");
});

test("visibility fails closed for missing, malformed, and legacy action values", () => {
  for (const value of [undefined, null, "", "publish", "published", "PUBLIC", ["public"]]) {
    assert.equal(normalizeRecipeVisibility(value), "draft");
  }
});

test("persisted status maps back to the UI vocabulary and defaults private", () => {
  assert.equal(visibilityFromRecipeStatus("published"), "public");
  assert.equal(visibilityFromRecipeStatus("draft"), "private");
  assert.equal(visibilityFromRecipeStatus("unexpected"), "private");
});
