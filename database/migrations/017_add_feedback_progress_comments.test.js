import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("./017_add_feedback_progress_comments.sql", import.meta.url), "utf8");

test("migration creates durable append-only comment records", () => {
  assert.match(sql, /feedback_submission_id UUID NOT NULL REFERENCES public\.help_feedback_submissions\(id\) ON DELETE CASCADE/i);
  assert.match(sql, /author_id UUID NOT NULL REFERENCES public\.admin_profiles\(id\)/i);
  assert.match(sql, /comment_text = btrim\(comment_text\)[\s\S]*char_length\(comment_text\) BETWEEN 1 AND 5000/i);
  assert.match(sql, /created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/i);
  assert.match(sql, /\(feedback_submission_id, created_at, id\)/i);
});

test("migration grants only admin-bound select and insert", () => {
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL[\s\S]*FROM anon, authenticated/i);
  assert.match(sql, /GRANT SELECT, INSERT[\s\S]*TO authenticated/i);
  assert.match(sql, /author_id = auth\.uid\(\)/i);
  assert.match(sql, /profile\.active = TRUE/i);
  assert.match(sql, /profile\.display_name = author_display_name/i);
  assert.doesNotMatch(sql, /GRANT\s+(?:[^;]*\bUPDATE\b|[^;]*\bDELETE\b)/i);
  assert.doesNotMatch(sql, /FOR\s+(UPDATE|DELETE)/i);
});
