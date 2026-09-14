import test from "node:test";
import assert from "node:assert/strict";
import { formatCentralTimestamp, isMissingFeedbackCommentsTableError, MAX_FEEDBACK_COMMENT_LENGTH, normalizeFeedbackComment } from "./adminFeedbackComments.js";

test("only PostgREST missing-table schema-cache errors enable compatibility mode", () => {
  assert.equal(isMissingFeedbackCommentsTableError({ code: "PGRST205" }), true);
  assert.equal(isMissingFeedbackCommentsTableError({ code: "42P01" }), false);
  assert.equal(isMissingFeedbackCommentsTableError({ code: "PGRST204" }), false);
  assert.equal(isMissingFeedbackCommentsTableError(null), false);
});

test("progress comments are required, trimmed, and capped", () => {
  assert.deepEqual(normalizeFeedbackComment("  Ready for review.\n"), { valid: true, value: "Ready for review." });
  assert.equal(normalizeFeedbackComment(" \n\t ").valid, false);
  assert.equal(normalizeFeedbackComment(null).valid, false);
  assert.equal(normalizeFeedbackComment("x".repeat(MAX_FEEDBACK_COMMENT_LENGTH)).valid, true);
  assert.equal(normalizeFeedbackComment("x".repeat(MAX_FEEDBACK_COMMENT_LENGTH + 1)).valid, false);
});

test("progress comment length counts Unicode code points like PostgreSQL char_length", () => {
  assert.equal(normalizeFeedbackComment("😀".repeat(MAX_FEEDBACK_COMMENT_LENGTH)).valid, true);
  assert.equal(normalizeFeedbackComment("😀".repeat(MAX_FEEDBACK_COMMENT_LENGTH + 1)).valid, false);
});

test("Central timestamps use CST and CDT for the represented instant", () => {
  assert.equal(formatCentralTimestamp("2026-01-15T18:00:00.000Z"), "Jan 15, 2026, 12:00 PM CST");
  assert.equal(formatCentralTimestamp("2026-07-15T17:00:00.000Z"), "Jul 15, 2026, 12:00 PM CDT");
});

test("Central timestamp formatting handles both sides of the spring DST boundary", () => {
  assert.equal(formatCentralTimestamp("2026-03-08T07:59:00.000Z"), "Mar 8, 2026, 1:59 AM CST");
  assert.equal(formatCentralTimestamp("2026-03-08T08:01:00.000Z"), "Mar 8, 2026, 3:01 AM CDT");
  assert.equal(formatCentralTimestamp("not-a-date"), "Invalid date");
});
