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

// ---------------------------------------------------------------------------
// REW-19: cookbook sharing
// ---------------------------------------------------------------------------

test('public cookbook view filters on id and is_public on every request', async () => {
  const detail = router.stack.find(layer => layer.route?.path === '/c/:id').route.stack[0].handle;
  const calls = [];
  const query = {
    select() { return this; },
    eq(...args) { calls.push(args); return this; },
    async maybeSingle() { return { data: null, error: null }; },
  };
  const original = supabase.from;
  const tables = [];
  supabase.from = table => { tables.push(table); return query; };
  const output = {};
  try {
    const res = { status(code) { output.status = code; return this; }, render(view, data) { output.view = view; output.data = data; } };
    await detail({ params: { id: '123e4567-e89b-42d3-a456-426614174000' } }, res, () => {});
  } finally {
    supabase.from = original;
  }
  assert.deepEqual(calls, [
    ['id', '123e4567-e89b-42d3-a456-426614174000'],
    ['is_public', true],
  ]);
  // A private cookbook must never trigger a second, membership-revealing query
  assert.deepEqual(tables, ['cookbooks']);
  assert.equal(output.status, 404);
  assert.equal(output.view, 'error');
});

test('private, missing and malformed cookbook ids render one identical not-found', async () => {
  const detail = router.stack.find(layer => layer.route?.path === '/c/:id').route.stack[0].handle;
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: null, error: null }; },
  };
  const original = supabase.from;
  supabase.from = () => query;
  const rendered = [];
  try {
    for (const id of ['123e4567-e89b-42d3-a456-426614174000', 'not-a-uuid', '../admin']) {
      const res = { status(code) { this.code = code; return this; }, render(view, data) { rendered.push({ code: this.code, view, data }); } };
      await detail({ params: { id } }, res, () => {});
    }
  } finally {
    supabase.from = original;
  }
  assert.equal(rendered.length, 3);
  for (const result of rendered) {
    assert.equal(result.code, 404);
    assert.equal(result.view, 'error');
    assert.deepEqual(result.data, rendered[0].data);
  }
});

test('public cookbook view reads through the anon client and never an owner-scoped one', async () => {
  const source = await readFile(new URL('./publicRoutes.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf("router.get(\"/c/:id\""));
  assert.doesNotMatch(handler, /createSupabaseClient|req\.accessToken|sb-access-token/);
  // The recipe fetch for /c/:id must be anon-only too
  const fetcher = source.slice(
    source.indexOf('async function getPublicCookbookRecipes'),
    source.indexOf("router.get(\"/c/:id\"")
  );
  assert.doesNotMatch(fetcher, /createSupabaseClient|req\.accessToken|sb-access-token/);
  assert.match(fetcher, /recipes!inner/);
  assert.match(fetcher, /\.eq\("recipes\.status", "published"\)/);
});

test('cookbook sharing migration keeps privacy at the database layer', async () => {
  const migration = await readFile(new URL('../../database/migrations/019_add_cookbook_sharing.sql', import.meta.url), 'utf8');
  // Defence in depth inside the RPC, on top of RLS
  assert.match(migration, /is_public\s*=\s*true/i);
  // SECURITY DEFINER here would make the RPC's own filter the only boundary
  assert.match(migration, /SECURITY\s+INVOKER/i);
  assert.doesNotMatch(migration, /SECURITY\s+DEFINER/i);
  assert.match(migration, /STABLE/);
  assert.match(migration, /SET\s+search_path\s*=\s*public,\s*pg_temp/i);
  // Visibility must be evaluated per request, never precomputed
  assert.doesNotMatch(migration, /MATERIALIZED\s+VIEW/i);
  // Private by default, including for every pre-existing row
  assert.match(migration, /is_public\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+false/i);
  // Recipe privacy is owned by migration 001 and must not be relaxed here.
  // Check executable SQL only -- prose comments legitimately discuss the
  // recipes table's policies.
  const sql = migration
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(sql, /CREATE\s+POLICY[\s\S]{0,200}?\sON\s+(public\.)?recipes\b/i);
  assert.doesNotMatch(sql, /ALTER\s+TABLE\s+(public\.)?recipes\b/i);
  assert.doesNotMatch(sql, /GRANT[^;]*\sON\s+(public\.)?recipes\b/i);
  // The published-only count means an owner sees the same number a visitor does
  assert.match(migration, /r\.status\s*=\s*'published'/i);
});

test('public cookbook_recipes policy hides draft membership edges, not just draft recipes', async () => {
  // REW-92: a membership row carries recipe_id and created_at, so gating the
  // public policy on the parent cookbook alone would let an anon PostgREST
  // read of /rest/v1/cookbook_recipes?cookbook_id=eq.<public_id> disclose the
  // count, UUIDs and add-times of the owner's DRAFT recipes -- even though the
  // recipe rows themselves stay hidden. The edge must be gated on the recipe's
  // status too, matching 013_public_recipe_card_metadata.sql.
  const migration = await readFile(new URL('../../database/migrations/019_add_cookbook_sharing.sql', import.meta.url), 'utf8');
  const policy = migration.slice(
    migration.indexOf('CREATE POLICY "Anyone can view recipes in public cookbooks"'),
    migration.indexOf('-- No new UPDATE policy')
  );
  assert.ok(policy, 'the public cookbook_recipes policy should exist');
  assert.match(policy, /is_public\s*=\s*true/i);
  assert.match(policy, /status\s*=\s*'published'/i);
  assert.match(policy, /cookbook_recipes\.recipe_id/i);
  // Both conditions must be required together, never either/or
  assert.match(policy, /\bAND\s+EXISTS\b/i);
  assert.doesNotMatch(policy, /\bOR\s+EXISTS\b/i);
});

test('search_cookbooks counts recipes only for the rows it actually returns', async () => {
  const migration = await readFile(new URL('../../database/migrations/019_add_cookbook_sharing.sql', import.meta.url), 'utf8');
  const body = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.search_cookbooks'));
  // The per-cookbook count subquery must sit after LIMIT/OFFSET has been
  // applied, so it runs once per returned row rather than once per match.
  const limitIndex = body.indexOf('LIMIT least(');
  const countIndex = body.indexOf('FROM cookbook_recipes cr');
  assert.ok(limitIndex > 0 && countIndex > 0);
  assert.ok(countIndex > limitIndex, 'recipe_count must be computed after LIMIT/OFFSET');
  // total_count still has to span the whole match set
  assert.match(body, /count\(\*\)\s+OVER\s*\(\)\s+AS total_count/i);
});

test('cookbook sharing migration only adds policies, leaving 009 and 010 intact', async () => {
  const migration = await readFile(new URL('../../database/migrations/019_add_cookbook_sharing.sql', import.meta.url), 'utf8');
  // The rollback note in the header legitimately mentions DROP statements, so
  // assert against executable SQL only.
  const statements = migration
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(statements, /DROP\s+POLICY/i);
  assert.doesNotMatch(statements, /ALTER\s+POLICY/i);
  assert.doesNotMatch(statements, /DROP\s+TABLE/i);
  assert.doesNotMatch(statements, /DROP\s+COLUMN/i);
  const createdPolicies = statements.match(/CREATE POLICY "([^"]+)"/g) || [];
  assert.deepEqual(createdPolicies, [
    'CREATE POLICY "Anyone can view public cookbooks"',
    'CREATE POLICY "Anyone can view recipes in public cookbooks"',
  ]);
});

test('search passes a cookbooks array on every render path and degrades silently', async () => {
  const search = router.stack.find(layer => layer.route?.path === '/search').route.stack[0].handle;
  const original = supabase.rpc;
  const rpcCalls = [];
  const outputs = [];

  async function runSearch(q, cookbookResult, page) {
    supabase.rpc = (name, args) => {
      rpcCalls.push([name, args]);
      return Promise.resolve(name === 'search_cookbooks' ? cookbookResult : { data: [], error: null });
    };
    const output = {};
    await search({ query: { q, page }, flash() {} }, {
      render: (view, data) => { output.view = view; output.data = data; },
      redirect: path => { output.redirect = path; },
    }, () => {});
    outputs.push(output);
    return output;
  }

  try {
    const empty = await runSearch('', { data: [], error: null });
    assert.deepEqual(empty.data.cookbooks, []);

    const ok = await runSearch('week', { data: [{ id: 'cb-1', title: 'Weeknight', recipe_count: 2 }], error: null });
    assert.deepEqual(ok.data.cookbooks, [{ id: 'cb-1', title: 'Weeknight', recipe_count: 2 }]);

    // A cookbook-search failure must not take recipe search down with it
    const degraded = await runSearch('week', { data: null, error: { message: 'boom' } });
    assert.equal(degraded.view, 'recipes/search');
    assert.equal(degraded.redirect, undefined);
    assert.deepEqual(degraded.data.cookbooks, []);
  } finally {
    supabase.rpc = original;
  }

  // Empty query short-circuits before any RPC; non-empty reuses the same
  // trimmed/capped query string for both RPCs
  const cookbookCall = rpcCalls.find(([name]) => name === 'search_cookbooks');
  assert.equal(cookbookCall[1].search_query, 'week');
  assert.equal(cookbookCall[1].result_offset, 0);
  assert.ok(cookbookCall[1].result_limit > 0 && cookbookCall[1].result_limit <= 12);
});

test('the capped cookbook section is shown once, not repeated on every recipe page', async () => {
  const search = router.stack.find(layer => layer.route?.path === '/search').route.stack[0].handle;
  const original = supabase.rpc;
  const cookbookRow = [{ id: 'cb-1', title: 'Weeknight', recipe_count: 1 }];

  async function runPage(page) {
    const names = [];
    supabase.rpc = (name) => {
      names.push(name);
      return Promise.resolve({ data: name === 'search_cookbooks' ? cookbookRow : [], error: null });
    };
    const output = {};
    await search({ query: { q: 'week', page }, flash() {} }, {
      render: (view, data) => { output.data = data; },
      redirect: () => {},
    }, () => {});
    return { names, cookbooks: output.data.cookbooks };
  }

  try {
    const first = await runPage('1');
    assert.ok(first.names.includes('search_cookbooks'));
    assert.deepEqual(first.cookbooks, cookbookRow);

    // Paging deeper into recipe results must not re-run the same offset-0
    // cookbook query and re-render the identical five cookbooks.
    for (const page of ['2', '3']) {
      const later = await runPage(page);
      assert.ok(!later.names.includes('search_cookbooks'), `page ${page} should skip the cookbook RPC`);
      assert.deepEqual(later.cookbooks, []);
    }
  } finally {
    supabase.rpc = original;
  }
});

// ---------------------------------------------------------------------------
// REW-69: meal plan sharing
// ---------------------------------------------------------------------------

test('public meal plan view filters on id and is_public on every request', async () => {
  const detail = router.stack.find(layer => layer.route?.path === '/m/:id').route.stack[0].handle;
  const calls = [];
  const query = {
    select() { return this; },
    eq(...args) { calls.push(args); return this; },
    async maybeSingle() { return { data: null, error: null }; },
  };
  const original = supabase.from;
  const tables = [];
  supabase.from = table => { tables.push(table); return query; };
  const output = {};
  try {
    const res = { status(code) { output.status = code; return this; }, render(view, data) { output.view = view; output.data = data; } };
    await detail({ params: { id: '123e4567-e89b-42d3-a456-426614174000' } }, res, () => {});
  } finally {
    supabase.from = original;
  }
  assert.deepEqual(calls, [
    ['id', '123e4567-e89b-42d3-a456-426614174000'],
    ['is_public', true],
  ]);
  // A private meal plan must never trigger a second, membership-revealing query
  assert.deepEqual(tables, ['meal_plans']);
  assert.equal(output.status, 404);
  assert.equal(output.view, 'error');
});

test('private, missing and malformed meal plan ids render one identical not-found', async () => {
  const detail = router.stack.find(layer => layer.route?.path === '/m/:id').route.stack[0].handle;
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: null, error: null }; },
  };
  const original = supabase.from;
  supabase.from = () => query;
  const rendered = [];
  try {
    for (const id of ['123e4567-e89b-42d3-a456-426614174000', 'not-a-uuid', '../admin']) {
      const res = { status(code) { this.code = code; return this; }, render(view, data) { rendered.push({ code: this.code, view, data }); } };
      await detail({ params: { id } }, res, () => {});
    }
  } finally {
    supabase.from = original;
  }
  assert.equal(rendered.length, 3);
  for (const result of rendered) {
    assert.equal(result.code, 404);
    assert.equal(result.view, 'error');
    assert.deepEqual(result.data, rendered[0].data);
  }
});

test('public meal plan view reads through the anon client and never an owner-scoped one', async () => {
  const source = await readFile(new URL('./publicRoutes.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf("router.get(\"/m/:id\""));
  assert.doesNotMatch(handler, /createSupabaseClient|req\.accessToken|sb-access-token/);
  // The recipe fetch for /m/:id must be anon-only too
  const fetcher = source.slice(
    source.indexOf('async function getPublicMealPlanRecipes'),
    source.indexOf("router.get(\"/m/:id\"")
  );
  assert.doesNotMatch(fetcher, /createSupabaseClient|req\.accessToken|sb-access-token/);
  assert.match(fetcher, /recipes!inner/);
  assert.match(fetcher, /\.eq\("recipes\.status", "published"\)/);
  // The shared page has no use for user_id, so it is never selected
  assert.match(handler, /\.select\("id, title, start_date, end_date"\)/);
});

test('meal plan sharing migration keeps privacy at the database layer', async () => {
  const migration = await readFile(new URL('../../database/migrations/020_add_meal_plan_sharing.sql', import.meta.url), 'utf8');
  // Private by default, including for every pre-existing row
  assert.match(migration, /is_public\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+false/i);
  // Visibility must be evaluated per request, never precomputed
  assert.doesNotMatch(migration, /MATERIALIZED\s+VIEW/i);
  // Recipe privacy is owned by migration 001 and must not be relaxed here.
  // Check executable SQL only -- prose comments legitimately discuss the
  // recipes table's policies.
  const sql = migration
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(sql, /CREATE\s+POLICY[\s\S]{0,200}?\sON\s+(public\.)?recipes\b/i);
  assert.doesNotMatch(sql, /ALTER\s+TABLE\s+(public\.)?recipes\b/i);
  assert.doesNotMatch(sql, /GRANT[^;]*\sON\s+(public\.)?recipes\b/i);
});

test('public meal_plan_recipes policy hides private membership edges, not just private recipes', async () => {
  // REW-92, applied to meal plans: a membership row carries recipe_id,
  // planned_servings and created_at, so gating the public policy on the parent
  // plan alone would let an anon PostgREST read of
  // /rest/v1/meal_plan_recipes?meal_plan_id=eq.<public_id> disclose the count,
  // UUIDs and add-times of the owner's PRIVATE recipes -- even though the
  // recipe rows themselves stay hidden. The edge must be gated on the recipe's
  // status too, matching 013_public_recipe_card_metadata.sql and 019.
  const migration = await readFile(new URL('../../database/migrations/020_add_meal_plan_sharing.sql', import.meta.url), 'utf8');
  const policy = migration.slice(
    migration.indexOf('CREATE POLICY "Anyone can view recipes in public meal plans"'),
    migration.indexOf('-- No new UPDATE policy')
  );
  assert.ok(policy, 'the public meal_plan_recipes policy should exist');
  assert.match(policy, /is_public\s*=\s*true/i);
  assert.match(policy, /status\s*=\s*'published'/i);
  assert.match(policy, /meal_plan_recipes\.recipe_id/i);
  // Both conditions must be required together, never either/or
  assert.match(policy, /\bAND\s+EXISTS\b/i);
  assert.doesNotMatch(policy, /\bOR\s+EXISTS\b/i);
});

test('meal plan sharing migration only adds policies, leaving 011 and 012 intact', async () => {
  const migration = await readFile(new URL('../../database/migrations/020_add_meal_plan_sharing.sql', import.meta.url), 'utf8');
  // The rollback note in the header legitimately mentions DROP statements, so
  // assert against executable SQL only.
  const statements = migration
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(statements, /DROP\s+POLICY/i);
  assert.doesNotMatch(statements, /ALTER\s+POLICY/i);
  assert.doesNotMatch(statements, /DROP\s+TABLE/i);
  assert.doesNotMatch(statements, /DROP\s+COLUMN/i);
  const createdPolicies = statements.match(/CREATE POLICY "([^"]+)"/g) || [];
  assert.deepEqual(createdPolicies, [
    'CREATE POLICY "Anyone can view public meal plans"',
    'CREATE POLICY "Anyone can view recipes in public meal plans"',
  ]);
  // Both new policies are reachable by signed-out visitors and signed-in
  // non-owners alike
  assert.equal((statements.match(/FOR SELECT TO anon, authenticated/g) || []).length, 2);
  assert.match(statements, /GRANT SELECT ON public\.meal_plans, public\.meal_plan_recipes TO anon, authenticated;/);
});
