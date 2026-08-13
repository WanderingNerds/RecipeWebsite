import test from "node:test";
import assert from "node:assert/strict";
import {
  parseIngredientLine,
  parseIngredients,
  formatQuantity,
  formatIngredient,
} from "./ingredientParser.js";

/** Convenience helper: parse a line and assert the interesting fields. */
function expectParse(line, expected) {
  const row = parseIngredientLine(line);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(row[key], value, `${line} -> ${key}`);
  }
}

test("parses a simple quantity, unit and ingredient", () => {
  expectParse("2 cups flour", {
    quantity: 2,
    unit: "cup",
    unitText: "cups",
    unitType: "volume",
    ingredient: "flour",
    scalable: true,
  });
});

test("parses abbreviations with and without periods", () => {
  expectParse("1 tsp salt", { quantity: 1, unit: "teaspoon", ingredient: "salt" });
  expectParse("3 tbsp. olive oil", { quantity: 3, unit: "tablespoon", ingredient: "olive oil" });
  expectParse("500 g bread flour", { quantity: 500, unit: "gram", ingredient: "bread flour" });
  expectParse("1 lb ground beef", { quantity: 1, unit: "pound", ingredient: "ground beef" });
});

test("distinguishes T (tablespoon) from t (teaspoon)", () => {
  expectParse("2 T butter", { quantity: 2, unit: "tablespoon" });
  expectParse("2 t vanilla", { quantity: 2, unit: "teaspoon" });
});

test("parses multi-word units", () => {
  expectParse("8 fl oz whole milk", { quantity: 8, unit: "fluid ounce", ingredient: "whole milk" });
  expectParse("2 fluid ounces cream", { quantity: 2, unit: "fluid ounce", ingredient: "cream" });
});

test("parses fractions, mixed numbers and decimals", () => {
  expectParse("1/2 cup sugar", { quantity: 0.5, unit: "cup", ingredient: "sugar" });
  expectParse("1 1/2 cups milk", { quantity: 1.5, unit: "cup", ingredient: "milk" });
  expectParse("2.5 oz chocolate", { quantity: 2.5, unit: "ounce", ingredient: "chocolate" });
  expectParse(".5 cup water", { quantity: 0.5, unit: "cup", ingredient: "water" });
});

test("parses unicode fractions", () => {
  expectParse("½ cup butter", { quantity: 0.5, unit: "cup", ingredient: "butter" });
  expectParse("1½ cups oats", { quantity: 1.5, unit: "cup", ingredient: "oats" });
  expectParse("2 ¼ tsp yeast", { quantity: 2.25, unit: "teaspoon", ingredient: "yeast" });
});

test("parses ranges", () => {
  expectParse("2-3 cloves garlic", {
    quantity: 2,
    quantityMax: 3,
    unit: "clove",
    ingredient: "garlic",
  });
  expectParse("1 to 2 tbsp honey", { quantity: 1, quantityMax: 2, unit: "tablespoon" });
});

test("parses word quantities", () => {
  expectParse("two eggs", { quantity: 2, unit: null, ingredient: "eggs" });
  expectParse("a pinch of saffron", { quantity: 1, unit: "pinch", ingredient: "saffron" });
});

test("folds multipliers into a total", () => {
  expectParse("2 x 400 g chopped tomatoes", {
    quantity: 800,
    unit: "gram",
    ingredient: "chopped tomatoes",
  });
});

test("moves parentheticals into notes", () => {
  expectParse("1 (14.5 oz) can diced tomatoes", {
    quantity: 1,
    unit: "can",
    ingredient: "diced tomatoes",
    note: "14.5 oz",
  });
});

test("separates preparation notes after a comma", () => {
  expectParse("2 cups carrots, peeled and diced", {
    quantity: 2,
    unit: "cup",
    ingredient: "carrots",
    note: "peeled and diced",
  });
});

test("captures trailing usage phrases as notes", () => {
  expectParse("Salt and pepper to taste", {
    quantity: null,
    unit: null,
    ingredient: "Salt and pepper",
    note: "to taste",
    scalable: false,
  });
  expectParse("1 cup pecans, optional", { quantity: 1, unit: "cup", ingredient: "pecans", note: "optional" });
});

test("strips list markers and bullets", () => {
  expectParse("- 2 cups flour", { quantity: 2, unit: "cup", ingredient: "flour" });
  expectParse("• 1 tsp salt", { quantity: 1, unit: "teaspoon", ingredient: "salt" });
  expectParse("3) large eggs", { quantity: 3, unit: null, ingredient: "large eggs" });
});

test("keeps unparseable lines intact and marks them unscalable", () => {
  expectParse("Olive oil for frying", { quantity: null, unit: null, ingredient: "Olive oil", scalable: false });
  const row = parseIngredientLine("Fresh basil");
  assert.equal(row.ingredient, "Fresh basil");
  assert.equal(row.scalable, false);
  assert.equal(row.raw, "Fresh basil");
});

test("does not treat size adjectives as units", () => {
  expectParse("3 large eggs", { quantity: 3, unit: null, ingredient: "large eggs" });
});

test("recognises section headings", () => {
  expectParse("For the sauce:", { type: "section", ingredient: "For the sauce" });
});

test("skips blank lines and parses a whole block", () => {
  const rows = parseIngredients("2 cups flour\n\n  \n1 tsp salt\n");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ingredient, "flour");
  assert.equal(rows[1].ingredient, "salt");
});

test("handles empty input", () => {
  assert.deepEqual(parseIngredients(""), []);
  assert.deepEqual(parseIngredients(null), []);
  assert.equal(parseIngredientLine("   "), null);
});

test("formats quantities as recipe-friendly fractions", () => {
  assert.equal(formatQuantity(2), "2");
  assert.equal(formatQuantity(0.5), "1/2");
  assert.equal(formatQuantity(1.5), "1 1/2");
  assert.equal(formatQuantity(0.333333), "1/3");
  assert.equal(formatQuantity(2.25), "2 1/4");
  assert.equal(formatQuantity(0.07), "0.07");
  assert.equal(formatQuantity(null), "");
});

test("round-trips a parsed row back to text", () => {
  assert.equal(formatIngredient(parseIngredientLine("2 cups flour")), "2 cups flour");
  assert.equal(formatIngredient(parseIngredientLine("1 tsp salt")), "1 tsp salt");
  assert.equal(formatIngredient(parseIngredientLine("1½ cups oats")), "1 1/2 cups oats");
  assert.equal(formatIngredient(parseIngredientLine("For the sauce:")), "For the sauce:");
});
