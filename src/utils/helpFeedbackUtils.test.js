import test from "node:test";
import assert from "node:assert/strict";
import {
  HELP_FEEDBACK_CATEGORIES,
  HELP_FEEDBACK_LIMITS,
  normalizeHelpFeedback,
  validateHelpFeedback,
} from "./helpFeedbackUtils.js";

const validInput = {
  category: "Question",
  subject: "How do I share a recipe?",
  message: "Please explain the sharing options.",
  contactName: "Test Cook",
  contactEmail: "cook@example.com",
};

test("help feedback exposes the product-approved category allowlist", () => {
  assert.deepEqual(HELP_FEEDBACK_CATEGORIES, ["Question", "Issue report", "Feedback", "Help request", "Other"]);
  assert.equal(Object.isFrozen(HELP_FEEDBACK_CATEGORIES), true);
});

test("normalization trims strings and safely rejects wrong field and body types", () => {
  assert.deepEqual(normalizeHelpFeedback({ ...validInput, subject: "  Hello  ", message: ["no"] }), {
    ...validInput,
    subject: "Hello",
    message: "",
  });
  assert.deepEqual(normalizeHelpFeedback(null), { category: "", subject: "", message: "", contactName: "", contactEmail: "" });
});

test("validation accepts trimmed values at every length boundary", () => {
  const result = validateHelpFeedback({
    category: "Other",
    subject: "s".repeat(HELP_FEEDBACK_LIMITS.subject),
    message: "m".repeat(HELP_FEEDBACK_LIMITS.message),
    contactName: "n".repeat(HELP_FEEDBACK_LIMITS.name),
    contactEmail: `${"a".repeat(HELP_FEEDBACK_LIMITS.email - 12)}@example.com`,
  });
  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, {});
});

test("validation rejects blank, invalid-category, malformed-email, and over-limit fields", () => {
  const blank = validateHelpFeedback({ category: "Unknown", subject: "  ", message: null, contactName: {}, contactEmail: "invalid" });
  assert.deepEqual(Object.keys(blank.errors).sort(), ["category", "contactEmail", "contactName", "message", "subject"]);

  for (const [field, limit] of Object.entries(HELP_FEEDBACK_LIMITS)) {
    const inputField = field === "name" ? "contactName" : field === "email" ? "contactEmail" : field;
    const result = validateHelpFeedback({ ...validInput, [inputField]: "x".repeat(limit + 1) });
    assert.ok(result.errors[inputField], `${inputField} should enforce its maximum`);
  }
});
