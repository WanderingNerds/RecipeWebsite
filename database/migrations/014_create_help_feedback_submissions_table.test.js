import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("./014_create_help_feedback_submissions_table.sql", import.meta.url);

test("help feedback submissions survive attempted auth-account deletion", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const userForeignKey = migration.match(/user_id\s+UUID\s+NOT NULL\s+REFERENCES\s+auth\.users\s*\(id\)[^,]*/i)?.[0];

  assert.ok(userForeignKey, "migration must retain a required auth.users foreign key");
  assert.doesNotMatch(userForeignKey, /ON\s+DELETE\s+(?:CASCADE|SET\s+NULL)/i);
  assert.doesNotMatch(migration, /user_id[^,]*ON\s+DELETE\s+CASCADE/i);
});
