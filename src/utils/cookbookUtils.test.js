import test from "node:test";
import assert from "node:assert/strict";
import { validateCookbookTitle, normalizeRecipeIdSelection } from "./cookbookUtils.js";

test("validateCookbookTitle: accepts and trims a normal title", () => {
  const result = validateCookbookTitle("  Weeknight Dinners  ");
  assert.equal(result.valid, true);
  assert.equal(result.title, "Weeknight Dinners");
  assert.equal(result.error, null);
});

test("validateCookbookTitle: rejects a blank title", () => {
  const result = validateCookbookTitle("");
  assert.equal(result.valid, false);
  assert.equal(result.title, "");
  assert.match(result.error, /required/i);
});

test("validateCookbookTitle: rejects a whitespace-only title", () => {
  const result = validateCookbookTitle("     ");
  assert.equal(result.valid, false);
  assert.equal(result.title, "");
  assert.match(result.error, /required/i);
});

test("validateCookbookTitle: rejects null/undefined/non-string input", () => {
  assert.equal(validateCookbookTitle(null).valid, false);
  assert.equal(validateCookbookTitle(undefined).valid, false);
  assert.equal(validateCookbookTitle(42).valid, false);
});

test("validateCookbookTitle: rejects a title over the max length", () => {
  const longTitle = "a".repeat(201);
  const result = validateCookbookTitle(longTitle);
  assert.equal(result.valid, false);
  assert.equal(result.title, longTitle);
  assert.match(result.error, /200 characters or fewer/i);
});

test("validateCookbookTitle: accepts a title at exactly the max length", () => {
  const maxTitle = "a".repeat(200);
  const result = validateCookbookTitle(maxTitle);
  assert.equal(result.valid, true);
  assert.equal(result.title, maxTitle);
});

test("normalizeRecipeIdSelection: returns [] for undefined/null", () => {
  assert.deepEqual(normalizeRecipeIdSelection(undefined), []);
  assert.deepEqual(normalizeRecipeIdSelection(null), []);
});

test("normalizeRecipeIdSelection: wraps a single valid UUID string into an array", () => {
  const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
  assert.deepEqual(normalizeRecipeIdSelection(id), [id]);
});

test("normalizeRecipeIdSelection: passes through an array of valid UUIDs", () => {
  const id1 = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
  const id2 = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
  assert.deepEqual(normalizeRecipeIdSelection([id1, id2]), [id1, id2]);
});

test("normalizeRecipeIdSelection: deduplicates repeated ids while preserving first-seen order", () => {
  const id1 = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
  const id2 = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
  assert.deepEqual(normalizeRecipeIdSelection([id1, id2, id1]), [id1, id2]);
});

test("normalizeRecipeIdSelection: drops malformed, blank, and non-string entries", () => {
  const id1 = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
  assert.deepEqual(
    normalizeRecipeIdSelection([id1, "not-a-uuid", "", "   ", null, undefined, 123, {}]),
    [id1]
  );
});

test("normalizeRecipeIdSelection: is case-insensitive for UUID hex digits", () => {
  const upper = "3FA85F64-5717-4562-B3FC-2C963F66AFA6";
  assert.deepEqual(normalizeRecipeIdSelection(upper), [upper]);
});
