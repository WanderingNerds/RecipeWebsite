import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
const { supabase } = await import('../config/supabase.js');
const { default: router } = await import('./publicRoutes.js');
const browse = router.stack.find(layer => layer.route?.path === '/browse').route.stack[0].handle;

async function runBrowse(result, page) {
  const calls = [];
  const query = {};
  for (const method of ['select', 'eq', 'order', 'range']) {
    query[method] = (...args) => {
      calls.push([method, ...args]);
      return method === 'range' ? Promise.resolve(result) : query;
    };
  }
  const original = supabase.from;
  supabase.from = table => { calls.push(['from', table]); return query; };
  const output = { calls };
  try {
    await browse({ query: { page }, flash: (...args) => { output.flash = args; } }, {
      render: (view, data) => { output.view = view; output.data = data; },
      redirect: path => { output.redirect = path; },
    }, error => { output.error = error; });
  } finally {
    supabase.from = original;
  }
  return output;
}

test('Browse loads published metadata in one paginated query and removes inaccessible nested records', async () => {
  const result = await runBrowse({ data: [
    { id: 'one', recipe_categories: [{ categories: { name: 'Dinner' } }, { categories: null }], recipe_tags: [{ tags: { name: 'Quick' } }, null] },
    { id: 'two', recipe_categories: null },
  ], count: 25 }, '2');
  assert.equal(result.view, 'recipes/browse');
  assert.deepEqual(result.data.recipes, [
    { id: 'one', categories: [{ name: 'Dinner' }], tags: [{ name: 'Quick' }] },
    { id: 'two', categories: [], tags: [] },
  ]);
  assert.equal(result.data.totalCount, 25);
  assert.equal(result.data.totalPages, 3);
  assert.deepEqual(result.calls.filter(call => call[0] !== 'select'), [
    ['from', 'recipes'], ['eq', 'status', 'published'], ['order', 'created_at', { ascending: false }], ['range', 12, 23],
  ]);
  assert.match(result.calls[1][1], /recipe_categories\(categories/);
  assert.match(result.calls[1][1], /recipe_tags\(tags/);
  assert.deepEqual(result.calls[1][2], { count: 'exact' });
});

test('Browse keeps empty state and defaults invalid page to first page', async () => {
  const result = await runBrowse({ data: null, count: null }, '-1');
  assert.deepEqual(result.data.recipes, []);
  assert.equal(result.data.page, 1);
  assert.equal(result.data.totalPages, 0);
  assert.deepEqual(result.calls.at(-1), ['range', 0, 11]);
});

test('Browse preserves database-error flash and redirect', async () => {
  const result = await runBrowse({ error: { message: 'test database failure' } });
  assert.equal(result.redirect, '/');
  assert.equal(result.flash[0], 'error');
  assert.equal(result.view, undefined);
});

test('public detail applies the published predicate on every request', async () => {
  const detail = router.stack.find(layer => layer.route?.path === '/r/:id').route.stack[0].handle;
  const calls = [];
  const query = {
    select() { return this; },
    eq(...args) { calls.push(args); return this; },
    async maybeSingle() { return { data: null, error: null }; },
  };
  const original = supabase.from;
  supabase.from = () => query;
  try {
    const res = { status() { return this; }, render() {} };
    await detail({ params: { id: '123e4567-e89b-42d3-a456-426614174000' } }, res, () => {});
  } finally {
    supabase.from = original;
  }
  assert.deepEqual(calls, [
    ['id', '123e4567-e89b-42d3-a456-426614174000'],
    ['status', 'published'],
  ]);
});

test('search function evaluates published status at query time', async () => {
  const migration = await readFile(new URL('../../database/migrations/003_add_recipe_search.sql', import.meta.url), 'utf8');
  assert.match(migration, /WHERE\s+r\.status\s*=\s*'published'/i);
  assert.doesNotMatch(migration, /MATERIALIZED\s+VIEW/i);
});
