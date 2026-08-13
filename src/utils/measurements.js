/**
 * Kitchen measurement conversions.
 *
 * Professional kitchens work in grams, so this module converts a parsed
 * ingredient row to a weight and back to the closest measurement a cook would
 * actually use ("1 cup + 2 tbsp", not "1 1/8 cups").
 *
 * Volume-to-weight depends on the ingredient, so conversions are only made
 * when the ingredient is recognised. Anything unknown keeps its original
 * measurement rather than getting a made-up weight.
 */

import { formatQuantity } from "./ingredientParser.js";

// --- Unit conversions -------------------------------------------------------

// Derived from a single constant so the ladder stays exact: 3 tsp is a
// tablespoon and 48 tsp is a cup, with no floating point drift at the joins.
const ML_PER_TEASPOON = 4.92892159375;

const ML_PER_UNIT = {
  teaspoon: ML_PER_TEASPOON,
  tablespoon: ML_PER_TEASPOON * 3,
  "fluid ounce": ML_PER_TEASPOON * 6,
  cup: ML_PER_TEASPOON * 48,
  pint: ML_PER_TEASPOON * 96,
  quart: ML_PER_TEASPOON * 192,
  gallon: ML_PER_TEASPOON * 768,
  milliliter: 1,
  centiliter: 10,
  deciliter: 100,
  liter: 1000,
};

const GRAMS_PER_UNIT = {
  milligram: 0.001,
  gram: 1,
  kilogram: 1000,
  ounce: 28.3495,
  pound: 453.592,
};

/** Units that are already a weight in metric, so grams need no second line. */
const METRIC_WEIGHT_UNITS = new Set(["milligram", "gram", "kilogram"]);

const TSP_ML = ML_PER_UNIT.teaspoon;
const TBSP_ML = ML_PER_UNIT.tablespoon;
const CUP_ML = ML_PER_UNIT.cup;
const GRAMS_PER_OUNCE = GRAMS_PER_UNIT.ounce;
const GRAMS_PER_POUND = GRAMS_PER_UNIT.pound;

// --- Ingredient densities ---------------------------------------------------

/**
 * Densities written the way cooks think about them: grams per US cup.
 * Longer keys win over shorter ones, so "bread flour" beats "flour".
 */
const GRAMS_PER_CUP = {
  // Flours and dry baking staples
  "all-purpose flour": 120,
  "plain flour": 120,
  "bread flour": 127,
  "cake flour": 114,
  "whole wheat flour": 113,
  "almond flour": 96,
  "self-raising flour": 120,
  flour: 120,
  cornstarch: 128,
  cornflour: 128,
  cornmeal: 160,
  semolina: 167,
  "rolled oats": 90,
  oats: 90,
  breadcrumbs: 108,
  panko: 60,
  "cocoa powder": 85,
  "baking powder": 192,
  "baking soda": 221,
  "bicarbonate of soda": 221,
  "active dry yeast": 149,
  "instant yeast": 149,
  yeast: 149,

  // Sugars and syrups
  "granulated sugar": 200,
  "caster sugar": 200,
  "brown sugar": 213,
  "powdered sugar": 120,
  "confectioners sugar": 120,
  "icing sugar": 120,
  sugar: 200,
  honey: 340,
  "maple syrup": 322,
  molasses: 337,
  "corn syrup": 328,

  // Fats
  butter: 227,
  "olive oil": 216,
  "coconut oil": 218,
  "sesame oil": 218,
  "vegetable oil": 218,
  "canola oil": 218,
  oil: 218,
  shortening: 205,

  // Dairy and liquids
  water: 236,
  milk: 245,
  buttermilk: 245,
  "heavy cream": 238,
  "double cream": 238,
  cream: 238,
  "sour cream": 240,
  yogurt: 245,
  "cream cheese": 232,
  "condensed milk": 306,
  "coconut milk": 240,
  stock: 240,
  broth: 240,
  wine: 236,
  beer: 236,
  vinegar: 239,
  "lemon juice": 244,
  "lime juice": 244,
  "orange juice": 248,
  "soy sauce": 255,
  "fish sauce": 250,
  "tomato sauce": 245,
  "tomato paste": 262,
  passata: 245,
  ketchup: 240,
  mayonnaise: 220,
  mustard: 249,
  "peanut butter": 258,
  "vanilla extract": 202,

  // Grains, pulses, nuts, extras
  rice: 185,
  quinoa: 170,
  couscous: 173,
  lentils: 192,
  "dried beans": 200,
  "chocolate chips": 170,
  chocolate: 170,
  raisins: 165,
  "shredded coconut": 93,
  almonds: 143,
  walnuts: 117,
  pecans: 110,
  "chopped nuts": 120,
  "parmesan cheese": 100,
  parmesan: 100,
  "grated cheese": 100,
  "shredded cheese": 113,
  cheddar: 113,
  mozzarella: 113,

  // Seasonings (salt varies a lot by crystal size)
  "kosher salt": 135,
  "table salt": 288,
  "sea salt": 288,
  salt: 288,
  "black pepper": 110,
  cinnamon: 125,
  paprika: 110,
  "ground spice": 120,
};

/**
 * Typical weight of a single item, for ingredients that get counted rather
 * than measured. Keys are matched against "<ingredient>", "<unit> <ingredient>"
 * and "<ingredient> <unit>".
 */
const GRAMS_PER_ITEM = {
  "butter stick": 113,
  "garlic clove": 3,
  "garlic head": 45,
  egg: 50,
  "egg white": 33,
  "egg yolk": 17,
  onion: 150,
  "red onion": 150,
  shallot: 40,
  lemon: 100,
  lime: 65,
  orange: 180,
  carrot: 60,
  "celery stalk": 40,
  potato: 170,
  tomato: 120,
  "bell pepper": 120,
  banana: 118,
  apple: 180,
  "bacon slice": 25,
  "bread slice": 30,
  "bay leaf": 0.2,
  "basil leaf": 0.5,
};

// Keys sorted longest-first so the most specific match wins.
const DENSITY_KEYS = Object.keys(GRAMS_PER_CUP).sort((a, b) => b.length - a.length);
const ITEM_KEYS = Object.keys(GRAMS_PER_ITEM).sort((a, b) => b.length - a.length);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Finds the most specific key that appears as a whole word (or its plural) in
 * the given name.
 * @param {string[]} keys - Keys pre-sorted longest-first.
 * @param {string} name
 * @returns {string|null}
 */
function findKey(keys, name) {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  for (const key of keys) {
    const pattern = new RegExp(`\\b${escapeRegExp(key)}(?:e?s)?\\b`);
    if (pattern.test(normalized)) return key;
  }
  return null;
}

/**
 * Grams per millilitre for a recognised ingredient.
 * @param {string} ingredient
 * @returns {number|null}
 */
export function lookupDensity(ingredient) {
  const key = findKey(DENSITY_KEYS, ingredient);
  return key === null ? null : GRAMS_PER_CUP[key] / CUP_ML;
}

/**
 * Weight of a single item for a counted ingredient, e.g. one egg or one clove
 * of garlic.
 * @param {string} ingredient
 * @param {string|null} unit
 * @returns {number|null}
 */
export function lookupItemWeight(ingredient, unit) {
  const candidates = unit
    ? [`${ingredient} ${unit}`, `${unit} ${ingredient}`, ingredient]
    : [ingredient];

  for (const candidate of candidates) {
    const key = findKey(ITEM_KEYS, candidate);
    if (key !== null) return GRAMS_PER_ITEM[key];
  }
  return null;
}

/**
 * Reads a weight or volume out of a parser note, so "1 (28 oz) can tomatoes"
 * can still be weighed.
 * @param {string|null} note
 * @returns {{grams: number|null, ml: number|null}|null}
 */
function parseSizeFromNote(note) {
  if (!note) return null;

  const match = String(note).match(
    /(\d+(?:\.\d+)?)\s*(kg|g|gram|grams|mg|oz|ounce|ounces|lb|lbs|pound|pounds|ml|millilitre|milliliter|l|litre|liter|fl oz|fluid ounce|fluid ounces)\b/i,
  );
  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  const weightUnits = { kg: 1000, g: 1, gram: 1, grams: 1, mg: 0.001, oz: GRAMS_PER_OUNCE, ounce: GRAMS_PER_OUNCE, ounces: GRAMS_PER_OUNCE, lb: GRAMS_PER_POUND, lbs: GRAMS_PER_POUND, pound: GRAMS_PER_POUND, pounds: GRAMS_PER_POUND };
  if (weightUnits[unit] !== undefined) return { grams: value * weightUnits[unit], ml: null };

  const volumeUnits = { ml: 1, millilitre: 1, milliliter: 1, l: 1000, litre: 1000, liter: 1000, "fl oz": ML_PER_UNIT["fluid ounce"], "fluid ounce": ML_PER_UNIT["fluid ounce"], "fluid ounces": ML_PER_UNIT["fluid ounce"] };
  if (volumeUnits[unit] !== undefined) return { grams: null, ml: value * volumeUnits[unit] };

  return null;
}

// --- Row measurement --------------------------------------------------------

/**
 * @typedef {Object} RowMeasure
 * @property {number|null} grams   Weight of the lower bound, if convertible.
 * @property {number|null} gramsMax Weight of the upper bound of a range.
 * @property {number|null} ml      Volume of the lower bound, if it is a volume.
 * @property {number|null} mlMax   Volume of the upper bound of a range.
 * @property {'weight'|'volume'|'count'|null} basis How the weight was derived.
 */

/**
 * Works out what a parsed row weighs.
 * @param {object} row - A row from the ingredient parser.
 * @returns {RowMeasure}
 */
export function measureRow(row) {
  const empty = { grams: null, gramsMax: null, ml: null, mlMax: null, basis: null };
  if (!row || row.type === "section" || row.quantity === null) return empty;

  const { quantity, quantityMax, unit, unitType, ingredient, note } = row;
  const scaleBoth = (perUnit) => ({
    grams: quantity * perUnit,
    gramsMax: quantityMax === null ? null : quantityMax * perUnit,
  });

  // Weights convert exactly.
  if (unitType === "weight" && GRAMS_PER_UNIT[unit] !== undefined) {
    return { ...empty, ...scaleBoth(GRAMS_PER_UNIT[unit]), basis: "weight" };
  }

  // Volumes need the ingredient's density.
  if (unitType === "volume" && ML_PER_UNIT[unit] !== undefined) {
    const mlPerUnit = ML_PER_UNIT[unit];
    const density = lookupDensity(ingredient);
    const weights = density === null ? { grams: null, gramsMax: null } : scaleBoth(mlPerUnit * density);

    return {
      ...weights,
      ml: quantity * mlPerUnit,
      mlMax: quantityMax === null ? null : quantityMax * mlPerUnit,
      basis: density === null ? null : "volume",
    };
  }

  // Counted things: a known item weight, or a size printed in the note
  // such as "1 (28 oz) can tomatoes".
  const noteSize = parseSizeFromNote(note);
  if (noteSize && noteSize.grams !== null) {
    return { ...empty, ...scaleBoth(noteSize.grams), basis: "count" };
  }
  if (noteSize && noteSize.ml !== null) {
    const density = lookupDensity(ingredient);
    if (density !== null) {
      return { ...empty, ...scaleBoth(noteSize.ml * density), basis: "count" };
    }
  }

  const itemWeight = lookupItemWeight(ingredient, unit);
  if (itemWeight !== null) {
    // "1 dozen eggs" is twelve of them.
    const perUnit = unit === "dozen" ? itemWeight * 12 : itemWeight;
    return { ...empty, ...scaleBoth(perUnit), basis: "count" };
  }

  return empty;
}

// --- Formatting -------------------------------------------------------------

/**
 * Rounds a weight the way a kitchen scale would show it.
 * @param {number} grams
 * @returns {number}
 */
function roundGrams(grams) {
  if (grams >= 100) return Math.round(grams);
  if (grams >= 10) return Math.round(grams * 2) / 2;
  if (grams >= 1) return Math.round(grams * 10) / 10;
  return Math.round(grams * 100) / 100;
}

/**
 * Formats a weight, switching to kilograms once it gets large.
 * @param {number|null} grams
 * @param {number|null} [gramsMax] - Upper bound of a range.
 * @returns {string}
 */
export function formatGrams(grams, gramsMax = null) {
  if (grams === null || !Number.isFinite(grams)) return "";

  const largest = gramsMax === null ? grams : gramsMax;
  const useKilograms = largest >= 1000;

  const render = (value) => {
    if (!useKilograms) return String(roundGrams(value));
    return String(Math.round((value / 1000) * 100) / 100);
  };

  const suffix = useKilograms ? "kg" : "g";
  if (gramsMax === null) return `${render(grams)} ${suffix}`;
  return `${render(grams)}-${render(gramsMax)} ${suffix}`;
}

/**
 * Renders a volume using the units a cook would reach for, spilling the
 * remainder into the next unit down ("1 cup + 2 tbsp") instead of producing
 * awkward fractions like "1 1/8 cups".
 * @param {number} ml
 * @returns {string}
 */
export function formatVolume(ml) {
  if (!Number.isFinite(ml) || ml <= 0) return "";

  const label = (value, singular, plural) => `${formatQuantity(value)} ${value > 1 ? plural : singular}`;

  // Anything that rounds to less than half a teaspoon is a pinch in practice.
  if (ml < TSP_ML * 0.5) {
    const eighths = Math.max(1, Math.round(ml / (TSP_ML / 8)));
    return label(eighths / 8, "tsp", "tsp");
  }

  // A quarter cup is the smallest amount a cook would reach for a cup measure.
  if (ml >= CUP_ML * 0.25) {
    const cups = ml / CUP_ML;

    // Prefer a clean fraction of a cup when there is one: "1/2 cup" beats
    // "8 tbsp", and "1 1/2 cups" beats "1 cup + 8 tbsp".
    for (const denominator of [2, 3, 4]) {
      const rounded = Math.round(cups * denominator) / denominator;
      if (Math.abs(cups - rounded) < 0.01) return label(rounded, "cup", "cups");
    }

    // Otherwise take as much as possible in cup measures and spill what is left
    // into tablespoons: 5.625 cups is "5 1/2 cups + 2 tbsp", not "5 cups + 10 tbsp".
    if (cups >= 0.75) {
      const wholeCups = Math.floor(cups);
      const remainder = cups - wholeCups;

      const fraction = [0.75, 2 / 3, 0.5, 1 / 3, 0.25].find((value) => value <= remainder + 0.02) ?? 0;
      const remainderTbsp = Math.round((remainder - fraction) * 16 * 2) / 2;

      if (remainderTbsp >= 16) return label(wholeCups + fraction + 1, "cup", "cups");
      const cupPart = label(wholeCups + fraction, "cup", "cups");
      if (remainderTbsp <= 0) return cupPart;
      return `${cupPart} + ${label(remainderTbsp, "tbsp", "tbsp")}`;
    }
  }

  if (ml >= TBSP_ML) {
    const tablespoons = ml / TBSP_ML;

    const halves = Math.round(tablespoons * 2) / 2;
    if (Math.abs(tablespoons - halves) < 0.02) return label(halves, "tbsp", "tbsp");

    const wholeTbsp = Math.floor(tablespoons);
    const remainderTsp = Math.round(((ml - wholeTbsp * TBSP_ML) / TSP_ML) * 4) / 4;

    if (remainderTsp <= 0) return label(wholeTbsp, "tbsp", "tbsp");
    if (remainderTsp >= 3) return label(wholeTbsp + 1, "tbsp", "tbsp");
    return `${label(wholeTbsp, "tbsp", "tbsp")} + ${label(remainderTsp, "tsp", "tsp")}`;
  }

  const teaspoons = Math.round((ml / TSP_ML) * 8) / 8;
  return label(teaspoons, "tsp", "tsp");
}

/**
 * Renders a weight in pounds and ounces, for recipes written that way.
 * @param {number} grams
 * @returns {string}
 */
export function formatImperialWeight(grams) {
  if (!Number.isFinite(grams) || grams <= 0) return "";

  if (grams >= GRAMS_PER_POUND) {
    const pounds = Math.floor(grams / GRAMS_PER_POUND);
    const remainderOz = Math.round(((grams - pounds * GRAMS_PER_POUND) / GRAMS_PER_OUNCE) * 2) / 2;

    if (remainderOz <= 0) return `${pounds} lb`;
    if (remainderOz >= 16) return `${pounds + 1} lb`;
    return `${pounds} lb ${formatQuantity(remainderOz)} oz`;
  }

  const ounces = Math.round((grams / GRAMS_PER_OUNCE) * 4) / 4;
  return `${formatQuantity(ounces)} oz`;
}

/**
 * Units for things you cannot sensibly halve: nobody measures out one and a
 * half cloves of garlic, but half a stick of butter is normal.
 */
const INDIVISIBLE_COUNT_UNITS = new Set([
  "clove", "leaf", "sprig", "ear", "rib", "sheet", "slice", "strip", "cube", "piece", "dozen",
]);

/**
 * Rounds a count to something you can actually put in a pot.
 *
 * Whole items for things that cannot be halved (and for bare counts like
 * eggs), halves for things that can, and quarters below one so "1/2 onion"
 * survives. Approximate amounts stay at least a whole pinch.
 *
 * @param {number} value
 * @param {string|null} [unit]
 * @param {string|null} [unitType]
 * @returns {number}
 */
export function roundCount(value, unit = null, unitType = null) {
  if (!Number.isFinite(value) || value <= 0) return 0;

  if (unitType === "approximate") return Math.max(1, Math.round(value));

  if (value >= 1) {
    const canBeHalved = unit !== null && !INDIVISIBLE_COUNT_UNITS.has(unit);
    if (canBeHalved) return Math.round(value * 2) / 2;
    return Math.max(1, Math.round(value));
  }

  return Math.max(0.25, Math.round(value * 4) / 4);
}

export { METRIC_WEIGHT_UNITS, ML_PER_UNIT, GRAMS_PER_UNIT };
