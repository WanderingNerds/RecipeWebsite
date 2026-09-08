import test from "node:test";
import assert from "node:assert/strict";
import { validateMealPlanTitle, validateDateRange } from "./mealPlanUtils.js";

test("validateMealPlanTitle: accepts and trims a normal title", () => {
  const result = validateMealPlanTitle("  Week of Sept 8  ");
  assert.equal(result.valid, true);
  assert.equal(result.title, "Week of Sept 8");
  assert.equal(result.error, null);
});

test("validateMealPlanTitle: rejects a blank title", () => {
  const result = validateMealPlanTitle("");
  assert.equal(result.valid, false);
  assert.equal(result.title, "");
  assert.match(result.error, /required/i);
});

test("validateMealPlanTitle: rejects a whitespace-only title", () => {
  const result = validateMealPlanTitle("     ");
  assert.equal(result.valid, false);
  assert.equal(result.title, "");
  assert.match(result.error, /required/i);
});

test("validateMealPlanTitle: rejects null/undefined/non-string input", () => {
  assert.equal(validateMealPlanTitle(null).valid, false);
  assert.equal(validateMealPlanTitle(undefined).valid, false);
  assert.equal(validateMealPlanTitle(42).valid, false);
});

test("validateMealPlanTitle: rejects a title over the max length", () => {
  const longTitle = "a".repeat(201);
  const result = validateMealPlanTitle(longTitle);
  assert.equal(result.valid, false);
  assert.equal(result.title, longTitle);
  assert.match(result.error, /200 characters or fewer/i);
});

test("validateMealPlanTitle: accepts a title at exactly the max length", () => {
  const maxTitle = "a".repeat(200);
  const result = validateMealPlanTitle(maxTitle);
  assert.equal(result.valid, true);
  assert.equal(result.title, maxTitle);
});

test("validateDateRange: accepts a valid range", () => {
  const result = validateDateRange("2026-09-08", "2026-09-14");
  assert.equal(result.valid, true);
  assert.equal(result.startDate, "2026-09-08");
  assert.equal(result.endDate, "2026-09-14");
  assert.equal(result.error, null);
});

test("validateDateRange: accepts a single-day range (end == start)", () => {
  const result = validateDateRange("2026-09-08", "2026-09-08");
  assert.equal(result.valid, true);
});

test("validateDateRange: rejects a missing start date", () => {
  const result = validateDateRange("", "2026-09-14");
  assert.equal(result.valid, false);
  assert.match(result.error, /start date is required/i);
});

test("validateDateRange: rejects a missing end date", () => {
  const result = validateDateRange("2026-09-08", "");
  assert.equal(result.valid, false);
  assert.match(result.error, /end date is required/i);
});

test("validateDateRange: rejects null/undefined dates", () => {
  assert.equal(validateDateRange(null, undefined).valid, false);
  assert.equal(validateDateRange(undefined, null).valid, false);
});

test("validateDateRange: rejects an unparseable date string", () => {
  const result = validateDateRange("not-a-date", "2026-09-14");
  assert.equal(result.valid, false);
  assert.match(result.error, /valid calendar dates/i);
});

test("validateDateRange: rejects an impossible calendar date", () => {
  const result = validateDateRange("2026-02-30", "2026-03-05");
  assert.equal(result.valid, false);
  assert.match(result.error, /valid calendar dates/i);
});

test("validateDateRange: rejects an end date before the start date", () => {
  const result = validateDateRange("2026-09-14", "2026-09-08");
  assert.equal(result.valid, false);
  assert.match(result.error, /on or after the start date/i);
});

test("validateDateRange: trims whitespace around valid dates", () => {
  const result = validateDateRange("  2026-09-08 ", " 2026-09-14  ");
  assert.equal(result.valid, true);
  assert.equal(result.startDate, "2026-09-08");
  assert.equal(result.endDate, "2026-09-14");
});
