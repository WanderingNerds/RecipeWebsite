/**
 * Recipe scaling engine.
 *
 * Works on the structured rows produced by ingredientParser.js. Wherever the
 * ingredient can be weighed, the row is converted to grams and the grams are
 * scaled - that is what a professional kitchen would work from. Each row also
 * gets the closest measurement a cook would actually use, so scaling produces
 * "1 cup + 2 tbsp" rather than "1 1/8 cups".
 *
 * Rows the parser could not read a quantity from (e.g. "Salt and pepper to
 * taste") pass through untouched, as do section headings.
 */

import { formatAmount, formatQuantity, numberFromString } from "./ingredientParser.js";
import {
  measureRow,
  formatGrams,
  formatVolume,
  formatImperialWeight,
  roundCount,
  METRIC_WEIGHT_UNITS,
} from "./measurements.js";

/** Guard rails so a hand-edited URL can't produce absurd amounts. */
export const MIN_SCALE_FACTOR = 0.05;
export const MAX_SCALE_FACTOR = 50;

/** Quick multipliers offered when a recipe has no usable servings count. */
export const QUICK_SCALE_FACTORS = [0.5, 1, 2, 3];

/**
 * Pulls a servings count out of the free-text servings field, which may be
 * anything from "4" to "Serves 4-6 people".
 * @param {string|number|null|undefined} text
 * @returns {number|null} The first positive number found, or null.
 */
export function parseServings(text) {
  if (typeof text === "number") {
    return Number.isFinite(text) && text > 0 ? text : null;
  }
  if (!text || typeof text !== "string") return null;

  const match = text.match(/\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+/);
  if (!match) return null;

  const value = numberFromString(match[0]);
  return value !== null && value > 0 ? value : null;
}

/**
 * Strictly parses a number that came from the query string. Unlike
 * `parseServings` this does not go hunting for a number inside other text, so
 * "-2", "abc" and duplicated params are all rejected outright.
 * @param {unknown} value
 * @returns {number|null}
 */
function parseRequestedNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;

  const parsed = numberFromString(String(value));
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * Keeps a scale factor inside a sensible range.
 * @param {number} value
 * @returns {number}
 */
export function clampFactor(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(Math.max(value, MIN_SCALE_FACTOR), MAX_SCALE_FACTOR);
}

/**
 * Renders the closest measurement a cook would use for an already-scaled row.
 *
 * Volumes come back as practical combinations ("1 cup + 2 tbsp"), counts are
 * rounded to whole items, and metric weights return nothing because the gram
 * figure already says it.
 *
 * @param {object} scaledRow - A row whose quantities are already scaled.
 * @param {object} measure - The scaled measurement from `measureRow`.
 * @returns {string}
 */
function describeMeasurement(scaledRow, measure) {
  const { unit, unitType, quantity, quantityMax } = scaledRow;

  if (unitType === "volume" && measure.ml !== null) {
    const min = formatVolume(measure.ml);
    if (measure.mlMax === null) return min;
    return `${min} to ${formatVolume(measure.mlMax)}`;
  }

  if (unitType === "weight") {
    if (METRIC_WEIGHT_UNITS.has(unit)) return "";
    const min = formatImperialWeight(measure.grams);
    if (measure.gramsMax === null) return min;
    return `${min} to ${formatImperialWeight(measure.gramsMax)}`;
  }

  // Counts, approximate amounts and bare numbers: round to whole items and let
  // the parser's own formatter handle pluralisation.
  return formatAmount({
    ...scaledRow,
    quantity: roundCount(quantity, unit, unitType),
    quantityMax: quantityMax === null ? null : roundCount(quantityMax, unit, unitType),
  });
}

/**
 * Scales a single parsed ingredient row.
 *
 * @param {object} row - A row from `parseIngredients`.
 * @param {number} factor
 * @returns {object} A new row with scaled quantities, a scaled weight in grams
 *   where one could be worked out, and display strings for both.
 */
export function scaleIngredientRow(row, factor) {
  const safeFactor = clampFactor(factor);

  const unscalable = {
    ...row,
    grams: null,
    gramsText: "",
    measureText: row.type === "section" ? "" : formatAmount(row),
    scaled: false,
  };
  if (row.type === "section" || !row.scalable || row.quantity === null) {
    return withDisplayAmounts(unscalable);
  }

  const scaled = {
    ...row,
    quantity: row.quantity * safeFactor,
    quantityMax: row.quantityMax === null ? null : row.quantityMax * safeFactor,
  };

  // Weigh the original row, then scale the weight - the recipe is scaled in
  // grams even though the measurement is what most people will read.
  const base = measureRow(row);
  const measure = {
    grams: base.grams === null ? null : base.grams * safeFactor,
    gramsMax: base.gramsMax === null ? null : base.gramsMax * safeFactor,
    ml: base.ml === null ? null : base.ml * safeFactor,
    mlMax: base.mlMax === null ? null : base.mlMax * safeFactor,
  };

  return withDisplayAmounts({
    ...scaled,
    grams: measure.grams,
    gramsText: formatGrams(measure.grams, measure.gramsMax),
    measureText: describeMeasurement(scaled, measure),
    scaled: safeFactor !== 1,
  });
}

/**
 * Picks which of the two amounts leads: grams when the ingredient could be
 * weighed, otherwise the measurement.
 * @param {object} row
 * @returns {object}
 */
function withDisplayAmounts(row) {
  const primaryAmount = row.gramsText || row.measureText;
  const secondaryAmount = row.gramsText ? row.measureText : "";
  return { ...row, primaryAmount, secondaryAmount };
}

/**
 * Scales every row in a parsed ingredient list.
 * @param {object[]} rows
 * @param {number} factor
 * @returns {object[]}
 */
export function scaleIngredients(rows, factor) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => scaleIngredientRow(row, factor));
}

/**
 * @typedef {Object} ScalingState
 * @property {number} factor              The multiplier to apply.
 * @property {string} factorText          Display form of the factor, e.g. "1 1/2".
 * @property {boolean} isScaled           True when the factor is not 1.
 * @property {number|null} baseServings   Servings the recipe was written for.
 * @property {number|null} targetServings Servings after scaling.
 * @property {string} targetServingsText  Display form, e.g. "2 1/2".
 * @property {boolean} canScaleByServings Whether a servings count was readable.
 * @property {number|null} stepDownServings Servings value for the "−" control.
 * @property {number|null} stepUpServings   Servings value for the "+" control.
 */

/**
 * Works out the scale factor from the request.
 *
 * `servings` is preferred (it produces the nicest URLs and lets the page show
 * "serves 8"); `scale` is the fallback for recipes with no usable servings
 * count. Both come straight from the query string, so both are untrusted.
 *
 * @param {Object} options
 * @param {string|number|null} options.servingsText   The recipe's servings field.
 * @param {string|number|null} [options.requestedServings] `?servings=` value.
 * @param {string|number|null} [options.requestedScale]    `?scale=` value.
 * @returns {ScalingState}
 */
export function resolveScaling({ servingsText, requestedServings, requestedScale } = {}) {
  const baseServings = parseServings(servingsText);
  let factor = 1;

  const desiredServings = parseRequestedNumber(requestedServings);
  const desiredScale = parseRequestedNumber(requestedScale);

  if (baseServings !== null && desiredServings !== null) {
    factor = desiredServings / baseServings;
  } else if (desiredScale !== null) {
    factor = desiredScale;
  }

  factor = clampFactor(factor);

  const targetServings = baseServings === null ? null : baseServings * factor;
  const roundedTarget = targetServings === null ? null : Math.max(1, Math.round(targetServings));

  return {
    factor,
    factorText: formatQuantity(factor),
    isScaled: factor !== 1,
    baseServings,
    targetServings,
    targetServingsText: formatQuantity(targetServings),
    canScaleByServings: baseServings !== null,
    stepDownServings: roundedTarget === null ? null : Math.max(1, roundedTarget - 1),
    stepUpServings: roundedTarget === null ? null : roundedTarget + 1,
  };
}
