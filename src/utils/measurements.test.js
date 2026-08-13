import test from "node:test";
import assert from "node:assert/strict";
import { parseIngredientLine } from "./ingredientParser.js";
import {
  measureRow,
  lookupDensity,
  lookupItemWeight,
  formatGrams,
  formatVolume,
  formatImperialWeight,
  roundCount,
  ML_PER_UNIT,
} from "./measurements.js";

/** Weight of a free-text line, rounded so the assertions stay readable. */
function gramsOf(line) {
  const { grams } = measureRow(parseIngredientLine(line));
  return grams === null ? null : Math.round(grams * 10) / 10;
}

test("the volume ladder is internally consistent", () => {
  assert.equal(ML_PER_UNIT.tablespoon, ML_PER_UNIT.teaspoon * 3);
  assert.equal(ML_PER_UNIT.cup, ML_PER_UNIT.tablespoon * 16);
  assert.equal(ML_PER_UNIT["fluid ounce"], ML_PER_UNIT.tablespoon * 2);
  assert.equal(ML_PER_UNIT.quart, ML_PER_UNIT.cup * 4);
});

test("matches ingredients to densities, most specific first", () => {
  assert.equal(lookupDensity("bread flour"), lookupDensity("bread flour"));
  assert.ok(lookupDensity("bread flour") > lookupDensity("all-purpose flour"));
  assert.ok(lookupDensity("extra virgin olive oil") !== null);
  assert.ok(lookupDensity("warm water") !== null);
  assert.equal(lookupDensity("chopped kale"), null);
});

test("does not confuse ingredients that share a word", () => {
  /** Density read back as the grams-per-cup figure it was written as. */
  const perCup = (name) => Math.round(lookupDensity(name) * ML_PER_UNIT.cup);

  // "buttermilk" must not match "butter", nor "cream cheese" match "cream".
  assert.equal(perCup("buttermilk"), 245);
  assert.equal(perCup("butter"), 227);
  assert.equal(perCup("cream cheese"), 232);
  assert.equal(perCup("heavy cream"), 238);
  assert.equal(perCup("cornflour"), 128);
  assert.equal(perCup("all-purpose flour"), 120);
});

test("finds item weights for counted ingredients", () => {
  assert.equal(lookupItemWeight("garlic", "clove"), 3);
  assert.equal(lookupItemWeight("unsalted butter", "stick"), 113);
  assert.equal(lookupItemWeight("large eggs", null), 50);
  assert.equal(lookupItemWeight("dragonfruit", null), null);
});

test("weighs weight units exactly", () => {
  assert.equal(gramsOf("500 g bread flour"), 500);
  assert.equal(gramsOf("1 kg potatoes"), 1000);
  assert.equal(gramsOf("1 lb ground beef"), 453.6);
  assert.equal(gramsOf("8 oz cream cheese"), 226.8);
});

test("weighs volumes using ingredient density", () => {
  assert.equal(gramsOf("1 cup all-purpose flour"), 120);
  assert.equal(gramsOf("1 cup granulated sugar"), 200);
  assert.equal(gramsOf("1 cup water"), 236);
  assert.equal(gramsOf("1 tsp kosher salt"), 2.8);
  assert.equal(gramsOf("2 cups chopped kale"), null);
});

test("reads a can size out of the note", () => {
  assert.equal(gramsOf("1 (28 oz) can San Marzano tomatoes"), 793.8);
  assert.equal(gramsOf("2 (400 g) cans chickpeas"), 800);
});

test("keeps the volume of a row alongside its weight", () => {
  const measure = measureRow(parseIngredientLine("2 cups all-purpose flour"));
  assert.equal(Math.round(measure.ml), 473);
  assert.equal(measure.basis, "volume");
});

test("weighs both ends of a range", () => {
  const measure = measureRow(parseIngredientLine("2-3 cloves garlic"));
  assert.equal(measure.grams, 6);
  assert.equal(measure.gramsMax, 9);
});

test("formats weights the way a scale reads", () => {
  assert.equal(formatGrams(240), "240 g");
  assert.equal(formatGrams(2.8125), "2.8 g");
  assert.equal(formatGrams(13.25), "13.5 g");
  assert.equal(formatGrams(1500), "1.5 kg");
  assert.equal(formatGrams(6, 9), "6-9 g");
  assert.equal(formatGrams(null), "");
});

test("formats volumes in units a cook would use", () => {
  const cups = (n) => formatVolume(ML_PER_UNIT.cup * n);
  const tsp = (n) => formatVolume(ML_PER_UNIT.teaspoon * n);

  assert.equal(cups(1), "1 cup");
  assert.equal(cups(0.5), "1/2 cup");
  assert.equal(cups(1 / 3), "1/3 cup");
  assert.equal(cups(2.25), "2 1/4 cups");
  assert.equal(cups(1.125), "1 cup + 2 tbsp");
  assert.equal(cups(0.375), "6 tbsp");
  // Take as much as possible in cup measures before spilling into spoons.
  assert.equal(cups(5.625), "5 1/2 cups + 2 tbsp");
  assert.equal(cups(2.8), "2 3/4 cups + 1 tbsp");
  assert.equal(tsp(3), "1 tbsp");
  assert.equal(tsp(4.5), "1 1/2 tbsp");
  assert.equal(tsp(5), "1 tbsp + 2 tsp");
  assert.equal(tsp(0.25), "1/4 tsp");
  assert.equal(formatVolume(0), "");
});

test("formats imperial weights in pounds and ounces", () => {
  assert.equal(formatImperialWeight(453.592), "1 lb");
  assert.equal(formatImperialWeight(680), "1 lb 8 oz");
  assert.equal(formatImperialWeight(227), "8 oz");
  assert.equal(formatImperialWeight(0), "");
});

test("rounds counts to something you can put in a pot", () => {
  // Bare counts (eggs) and indivisible units (cloves) go to whole numbers.
  assert.equal(roundCount(1.5), 2);
  assert.equal(roundCount(2.4), 2);
  assert.equal(roundCount(1.5, "clove"), 2);
  assert.equal(roundCount(6), 6);

  // Things you can cut keep their halves.
  assert.equal(roundCount(1.5, "stick"), 1.5);
  assert.equal(roundCount(1.75, "can"), 2);

  // Below one, quarters survive; a pinch never drops below one.
  assert.equal(roundCount(0.5), 0.5);
  assert.equal(roundCount(0.1), 0.25);
  assert.equal(roundCount(0.5, "pinch", "approximate"), 1);
});
