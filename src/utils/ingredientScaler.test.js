import test from "node:test";
import assert from "node:assert/strict";
import { parseIngredients, parseIngredientLine } from "./ingredientParser.js";
import {
  parseServings,
  clampFactor,
  scaleIngredientRow,
  scaleIngredients,
  resolveScaling,
  MIN_SCALE_FACTOR,
  MAX_SCALE_FACTOR,
} from "./ingredientScaler.js";

/** Scale one free-text line and return its closest kitchen measurement. */
function scaledMeasure(line, factor) {
  return scaleIngredientRow(parseIngredientLine(line), factor).measureText;
}

/** Scale one free-text line and return its weight. */
function scaledGrams(line, factor) {
  return scaleIngredientRow(parseIngredientLine(line), factor).gramsText;
}

test("reads a servings count out of free text", () => {
  assert.equal(parseServings("4"), 4);
  assert.equal(parseServings("4 servings"), 4);
  assert.equal(parseServings("Serves 4-6"), 4);
  assert.equal(parseServings("Makes 12 cookies"), 12);
  assert.equal(parseServings(6), 6);
  assert.equal(parseServings("a few"), null);
  assert.equal(parseServings(""), null);
  assert.equal(parseServings(null), null);
  assert.equal(parseServings("0"), null);
});

test("clamps nonsensical factors", () => {
  assert.equal(clampFactor(2), 2);
  assert.equal(clampFactor(0), 1);
  assert.equal(clampFactor(-3), 1);
  assert.equal(clampFactor(NaN), 1);
  assert.equal(clampFactor(1000), MAX_SCALE_FACTOR);
  assert.equal(clampFactor(0.0001), MIN_SCALE_FACTOR);
});

test("scales the weight of recognised ingredients", () => {
  assert.equal(scaledGrams("2 cups all-purpose flour", 1), "240 g");
  assert.equal(scaledGrams("2 cups all-purpose flour", 2), "480 g");
  assert.equal(scaledGrams("1 cup granulated sugar", 1), "200 g");
  assert.equal(scaledGrams("500 g bread flour", 1.5), "750 g");
  assert.equal(scaledGrams("1 lb ground beef", 1), "454 g");
  assert.equal(scaledGrams("1 tbsp olive oil", 1), "13.5 g");
});

test("switches to kilograms once amounts get large", () => {
  assert.equal(scaledGrams("2 cups all-purpose flour", 10), "2.4 kg");
  assert.equal(scaledGrams("1 lb ground beef", 4), "1.81 kg");
});

test("scales measurements into practical kitchen units", () => {
  // The awkward fractions a naive multiply produces are rolled up instead.
  assert.equal(scaledMeasure("1 tsp kosher salt", 3), "1 tbsp");
  assert.equal(scaledMeasure("1 1/2 tsp vanilla extract", 3), "1 1/2 tbsp");
  assert.equal(scaledMeasure("1 tsp vanilla extract", 5), "1 tbsp + 2 tsp");
  assert.equal(scaledMeasure("2 1/4 cups all-purpose flour", 0.5), "1 cup + 2 tbsp");
  assert.equal(scaledMeasure("2 cups all-purpose flour", 2), "4 cups");
  assert.equal(scaledMeasure("1/2 cup granulated sugar", 3), "1 1/2 cups");
  assert.equal(scaledMeasure("1 cup warm water", 0.5), "1/2 cup");
});

test("shows imperial weights alongside grams, but not metric ones", () => {
  const metric = scaleIngredientRow(parseIngredientLine("500 g bread flour"), 2);
  assert.equal(metric.gramsText, "1 kg");
  assert.equal(metric.measureText, ""); // grams already say it
  assert.equal(metric.primaryAmount, "1 kg");
  assert.equal(metric.secondaryAmount, "");

  const imperial = scaleIngredientRow(parseIngredientLine("1/2 lb fresh mozzarella"), 2);
  assert.equal(imperial.gramsText, "454 g");
  assert.equal(imperial.measureText, "1 lb");
});

test("rounds counted ingredients to whole items", () => {
  assert.equal(scaledMeasure("2-3 cloves garlic", 2), "4-6 cloves");
  // Rather than "1 to 1 1/2 cloves" - you cannot use half a clove.
  assert.equal(scaledMeasure("2-3 cloves garlic", 0.5), "1-2 cloves");
  // The amount column holds the count only; the name lives in its own column.
  assert.equal(scaledMeasure("3 large eggs", 0.5), "2");
  assert.equal(scaledMeasure("1 pinch salt", 2), "2 pinches");
  // A pinch does not get halved.
  assert.equal(scaledMeasure("1 pinch salt", 0.5), "1 pinch");
});

test("keeps halves for things that can be halved", () => {
  // Butter comes in sticks you can cut; this must survive an unscaled view.
  assert.equal(scaledMeasure("1 1/2 sticks unsalted butter", 1), "1 1/2 sticks");
  assert.equal(scaledMeasure("1 can tomatoes", 0.5), "1/2 can");
  assert.equal(scaledMeasure("1 onion", 0.5), "1/2");
});

test("weighs counted ingredients when the item weight is known", () => {
  assert.equal(scaledGrams("3 large eggs", 1), "150 g");
  assert.equal(scaledGrams("2 cloves garlic", 1), "6 g");
  assert.equal(scaledGrams("1 stick unsalted butter", 1), "113 g");
  // A can's size printed in the recipe is used when it is there.
  assert.equal(scaledGrams("1 (28 oz) can San Marzano tomatoes", 2), "1.59 kg");
});

test("leaves unrecognised ingredients unweighed rather than guessing", () => {
  const row = scaleIngredientRow(parseIngredientLine("2 cups chopped kale"), 2);
  assert.equal(row.grams, null);
  assert.equal(row.gramsText, "");
  assert.equal(row.measureText, "4 cups");
  assert.equal(row.primaryAmount, "4 cups");
});

test("leaves rows without a quantity untouched", () => {
  const row = scaleIngredientRow(parseIngredientLine("Salt and pepper to taste"), 4);
  assert.equal(row.quantity, null);
  assert.equal(row.grams, null);
  assert.equal(row.primaryAmount, "");
  assert.equal(row.scaled, false);
  assert.equal(row.ingredient, "Salt and pepper");
});

test("leaves section headings untouched", () => {
  const row = scaleIngredientRow(parseIngredientLine("For the sauce:"), 3);
  assert.equal(row.type, "section");
  assert.equal(row.ingredient, "For the sauce");
  assert.equal(row.scaled, false);
});

test("does not mutate the rows it is given", () => {
  const rows = parseIngredients("2 cups all-purpose flour");
  const scaled = scaleIngredients(rows, 3);
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].grams, undefined);
  assert.equal(scaled[0].quantity, 6);
  assert.equal(scaled[0].gramsText, "720 g");
});

test("scales a whole list", () => {
  const rows = parseIngredients("For the dough:\n2 cups all-purpose flour\n1 tsp kosher salt\nWater as needed");
  const scaled = scaleIngredients(rows, 2);
  assert.deepEqual(
    scaled.map((row) => row.primaryAmount),
    ["", "480 g", "5.6 g", ""],
  );
  assert.deepEqual(
    scaled.map((row) => row.secondaryAmount),
    ["", "4 cups", "2 tsp", ""],
  );
  assert.deepEqual(scaleIngredients(null, 2), []);
});

test("derives the factor from requested servings", () => {
  const state = resolveScaling({ servingsText: "4", requestedServings: "8" });
  assert.equal(state.factor, 2);
  assert.equal(state.isScaled, true);
  assert.equal(state.baseServings, 4);
  assert.equal(state.targetServings, 8);
  assert.equal(state.targetServingsText, "8");
  assert.equal(state.canScaleByServings, true);
});

test("falls back to an explicit scale when servings are unreadable", () => {
  const state = resolveScaling({ servingsText: "a crowd", requestedScale: "3" });
  assert.equal(state.factor, 3);
  assert.equal(state.baseServings, null);
  assert.equal(state.targetServings, null);
  assert.equal(state.canScaleByServings, false);
});

test("defaults to an unscaled recipe", () => {
  const state = resolveScaling({ servingsText: "4" });
  assert.equal(state.factor, 1);
  assert.equal(state.isScaled, false);
  assert.equal(state.targetServings, 4);
});

test("ignores junk query values", () => {
  assert.equal(resolveScaling({ servingsText: "4", requestedServings: "abc" }).factor, 1);
  assert.equal(resolveScaling({ servingsText: "4", requestedServings: "-2" }).factor, 1);
  assert.equal(resolveScaling({ servingsText: "4", requestedScale: "drop table" }).factor, 1);
  assert.equal(resolveScaling({ servingsText: "4", requestedServings: "999999" }).factor, MAX_SCALE_FACTOR);
});

test("provides stepper targets for the servings control", () => {
  const state = resolveScaling({ servingsText: "4", requestedServings: "6" });
  assert.equal(state.stepDownServings, 5);
  assert.equal(state.stepUpServings, 7);

  const single = resolveScaling({ servingsText: "1" });
  assert.equal(single.stepDownServings, 1); // never below one serving
});

test("handles fractional servings targets", () => {
  const state = resolveScaling({ servingsText: "5", requestedScale: "0.5" });
  assert.equal(state.targetServings, 2.5);
  assert.equal(state.targetServingsText, "2 1/2");
});
