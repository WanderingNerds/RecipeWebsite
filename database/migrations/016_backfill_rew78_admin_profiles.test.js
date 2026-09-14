import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("./016_backfill_rew78_admin_profiles.sql", import.meta.url), "utf8");

test("REW-78 backfill provisions only the two exact case-insensitive Auth emails", () => {
  assert.match(sql, /FROM\s+auth\.users/i);
  assert.match(sql, /lower\(users\.email\)\s+IN\s*\(\s*'carroll\.andrew@gmail\.com',\s*'vhobbs1895@gmail\.com'\s*\)/i);
  assert.doesNotMatch(sql, /\bLIKE\b|\bILIKE\b|strpos|substring/i);
});

test("REW-78 backfill pins canonical names and requires the trusted admin role", () => {
  assert.match(sql, /WHEN\s+'carroll\.andrew@gmail\.com'\s+THEN\s+'Andrew'/i);
  assert.match(sql, /WHEN\s+'vhobbs1895@gmail\.com'\s+THEN\s+'Victoria'/i);
  assert.match(sql, /raw_app_meta_data\s*->>\s*'role'\s*=\s*'admin'/i);
});

test("REW-78 backfill is idempotent and only repairs canonical profile fields", () => {
  assert.match(sql, /ON\s+CONFLICT\s*\(id\)\s+DO\s+UPDATE/i);
  assert.match(sql, /display_name\s*=\s*EXCLUDED\.display_name/i);
  assert.match(sql, /active\s*=\s*TRUE/i);
  assert.doesNotMatch(sql, /GRANT|CREATE\s+POLICY|ALTER\s+TABLE|UPDATE\s+auth\.users/i);
});
