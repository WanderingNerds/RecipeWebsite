import test from "node:test";
import assert from "node:assert/strict";
import { getAccountDisplayName } from "./userUtils.js";

test("returns the trimmed user_metadata.name when set", () => {
  const user = { user_metadata: { name: "  Jane Doe  " }, email: "jane@example.com" };
  assert.equal(getAccountDisplayName(user), "Jane Doe");
});

test("falls back to email when user_metadata has no name", () => {
  const user = { user_metadata: {}, email: "jane@example.com" };
  assert.equal(getAccountDisplayName(user), "jane@example.com");
});

test("falls back to email when user_metadata is missing entirely", () => {
  const user = { email: "jane@example.com" };
  assert.equal(getAccountDisplayName(user), "jane@example.com");
});

test("falls back to email when name is whitespace-only", () => {
  const user = { user_metadata: { name: "   " }, email: "jane@example.com" };
  assert.equal(getAccountDisplayName(user), "jane@example.com");
});

test("returns null for null or undefined user", () => {
  assert.equal(getAccountDisplayName(null), null);
  assert.equal(getAccountDisplayName(undefined), null);
});

test("returns null when user has neither name nor email", () => {
  assert.equal(getAccountDisplayName({}), null);
  assert.equal(getAccountDisplayName({ user_metadata: { name: "" } }), null);
});
