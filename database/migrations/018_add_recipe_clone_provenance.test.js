import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("./018_add_recipe_clone_provenance.sql", import.meta.url), "utf8");

test("migration adds constrained clone provenance and a lineage index", () => {
  assert.match(sql, /cloned_from_recipe_id UUID[\s\S]*REFERENCES public\.recipes\(id\) ON DELETE SET NULL/i);
  assert.match(sql, /ADD COLUMN original_author TEXT/i);
  assert.match(sql, /original_author = btrim\(original_author\)[\s\S]*char_length\(original_author\) BETWEEN 1 AND 255/i);
  assert.match(sql, /CREATE INDEX recipes_cloned_from_recipe_id_idx[\s\S]*ON public\.recipes \(cloned_from_recipe_id\)/i);
});

test("migration requires complete provenance when a recipe is inserted", () => {
  assert.match(sql, /TG_OP = 'INSERT'/i);
  assert.match(sql, /\(NEW\.cloned_from_recipe_id IS NULL\) <> \(NEW\.original_author IS NULL\)/i);
  assert.match(sql, /Recipe clone provenance must include both source and original author/i);
});

test("migration makes provenance immutable while preserving ON DELETE SET NULL", () => {
  assert.match(sql, /LANGUAGE plpgsql[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = ''/i);
  assert.match(sql, /NEW\.cloned_from_recipe_id IS DISTINCT FROM OLD\.cloned_from_recipe_id/i);
  assert.match(sql, /NEW\.original_author IS DISTINCT FROM OLD\.original_author/i);
  assert.match(sql, /NEW\.cloned_from_recipe_id IS NULL[\s\S]*NEW\.original_author IS NOT DISTINCT FROM OLD\.original_author/i);
  assert.match(sql, /NOT EXISTS \([\s\S]*FROM public\.recipes AS source[\s\S]*source\.id = OLD\.cloned_from_recipe_id/i);
  assert.match(sql, /BEFORE UPDATE OF cloned_from_recipe_id, original_author ON public\.recipes/i);
  assert.match(sql, /Recipe clone provenance is immutable/i);
});

test("the delete exception cannot clear attribution or rewrite the source", () => {
  assert.match(sql, /OLD\.cloned_from_recipe_id IS NOT NULL[\s\S]*NEW\.cloned_from_recipe_id IS NULL/i);
  assert.match(sql, /NEW\.original_author IS NOT DISTINCT FROM OLD\.original_author/i);
  assert.doesNotMatch(sql, /NEW\.original_author\s*:=\s*NULL/i);
});

test("migration does not change recipe grants or row-level security policies", () => {
  assert.doesNotMatch(sql, /\b(?:GRANT|REVOKE)\b/i);
  assert.doesNotMatch(sql, /CREATE\s+POLICY|DROP\s+POLICY|ROW\s+LEVEL\s+SECURITY/i);
});
