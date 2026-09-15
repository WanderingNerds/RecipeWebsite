import test from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';

const views = fileURLToPath(new URL('../../views/', import.meta.url));
const recipe = {
  id: 'recipe-1', title: 'Long <title>', author: 'Chef <script>', status: 'published',
  prep_time: '10 minutes', cook_time: '30 minutes', servings: '4', difficulty: 'Easy',
  created_at: '2026-01-01T12:00:00Z', thumbnail_url: '/image.jpg', isLiked: true,
  categories: ['Breakfast', 'Lunch', 'Dinner'].map(name => ({ name, slug: name.toLowerCase(), icon: '*' })),
  tags: [{ name: '<script>alert(1)</script>', slug: 'safe' }, { name: 'Family', slug: 'family' }],
};
const render = (isPublic, overrides = {}, user = null) => ejs.renderFile(`${views}partials/recipe-summary-card.ejs`, {
  recipe: { ...recipe, ...overrides }, isPublic, user, csrfToken: 'csrf-test',
});
const mealPlanTriggers = (html) => html.match(/class="[^"]*meal-plan-add-btn[^"]*"[^>]*data-recipe-id="recipe-1"/g) || [];

// REW-87: My Favorites is the one surface with MIXED ownership, so its cards
// are driven by `surface` + per-card `recipe.user_id` rather than `isPublic`.
// The owner id is deliberately a distinctive string so a test can assert the
// raw value never reaches the HTML.
const OWNER_ID = 'author-account-9f3';
const favoriteRecipe = { ...recipe, user_id: OWNER_ID };
const renderFavorite = (overrides = {}, user = null) => ejs.renderFile(`${views}partials/recipe-summary-card.ejs`, {
  recipe: { ...favoriteRecipe, ...overrides }, surface: 'favorites', user, csrfToken: 'csrf-test',
});

test('Both card surfaces render all core metadata in the same order with escaped text', async () => {
  for (const isPublic of [true, false]) {
    const html = await render(isPublic);
    const fields = ['<h3', 'By Chef &lt;script&gt;', 'Breakfast', 'Lunch', 'Dinner', '&lt;script&gt;alert(1)&lt;/script&gt;', 'Family', 'Prep Time: 10 minutes', 'Cook Time: 30 minutes', 'Servings: 4', 'Difficulty: Easy', 'Created'];
    let previous = -1;
    for (const field of fields) {
      const index = html.indexOf(field);
      assert.ok(index > previous, `${field} must follow previous metadata`);
      previous = index;
    }
    assert.match(html, /Long &lt;title&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /src="\/image.jpg"/);
  }
});

test('Zero, one, and multiple tags render without an empty tag row', async () => {
  for (const count of [0, 1, 2]) {
    const html = await render(true, { tags: recipe.tags.slice(0, count) });
    assert.equal((html.match(/class="tag-badge"/g) || []).length, count);
    assert.equal(html.includes('gap: 0.375rem'), count > 0);
  }
});

test('Missing optional fields omit their metadata cleanly', async () => {
  const html = await render(true, { author: null, thumbnail_url: null, prep_time: null, cook_time: null, servings: null, difficulty: null, tags: null, categories: null });
  assert.doesNotMatch(html, /<img|By |Prep Time:|Cook Time:|Servings:|Difficulty:|tag-badge|category-badge|undefined|null/);
});

test('Owned clone cards show escaped immutable attribution separately from author', async () => {
  const own = await render(false, { original_author: 'Original <Cook>' }, { id: 'owner' });
  assert.match(own, /By Chef &lt;script&gt;/);
  assert.match(own, /Adapted from Original &lt;Cook&gt;/);
  const publicCard = await render(true, { original_author: 'Original Cook' }, { id: 'other' });
  assert.doesNotMatch(publicCard, /Adapted from/);
});

test('Public controls stay public for guests, owners and other authenticated users', async () => {
  for (const user of [null, { id: 'owner' }, { id: 'other' }]) {
    const html = await render(true, { user_id: 'owner' }, user);
    assert.match(html, /href="\/r\/recipe-1"/);
    assert.match(html, /meal-plan-add-btn/);
    assert.doesNotMatch(html, />View<\/a>/);
    assert.equal(html.includes('meal-plan-add-btn-guest'), !user);
    assert.doesNotMatch(html, /\/recipes\?|\/edit|\/delete|like-btn|<form/);
  }
});

test('Private controls retain filters, favorites and protected deletion', async () => {
  const html = await render(false, {}, { id: 'owner' });
  for (const text of ['/recipes/recipe-1/edit', '/recipes/recipe-1/delete', '/recipes?category=dinner', '/recipes?tags=safe', 'data-liked="true"', 'name="_csrf" value="csrf-test"', "return confirm("]) assert.ok(html.includes(text), text);
  assert.match(html, /<h3[^>]*>[\s\S]*href="\/recipes\/recipe-1"[\s\S]*Long &lt;title&gt;[\s\S]*<\/h3>/);
  assert.doesNotMatch(html, />View<\/a>/);
  assert.equal(mealPlanTriggers(html).length, 1);
  assert.doesNotMatch(html, /meal-plan-add-btn-guest/);
  const draft = await render(false, { status: 'draft' }, { id: 'owner' });
  assert.match(draft, /class="like-btn" disabled/);
  assert.match(draft, />Private<\/span>/);
});

test('REW-86 owner cards expose a fail-closed visibility toggle that round-trips the active filter', async () => {
  const published = await ejs.renderFile(`${views}partials/recipe-summary-card.ejs`, {
    recipe, isPublic: false, user: { id: 'owner' }, csrfToken: 'csrf-test',
    selectedCategory: 'dinner', selectedTags: 'safe,family',
  });
  assert.match(published, /action="\/recipes\/recipe-1\/visibility" method="POST"/);
  // The submitted value is always the OPPOSITE of the current state, and the
  // form carries its own CSRF token plus the filters to restore.
  assert.match(published, /name="visibility" value="private"/);
  assert.doesNotMatch(published, /name="visibility" value="public"/);
  assert.match(published, /name="category" value="dinner"/);
  assert.match(published, /name="tags" value="safe,family"/);
  assert.equal((published.match(/name="_csrf" value="csrf-test"/g) || []).length, 2);
  assert.match(published, />Make Private</);

  const draft = await render(false, { status: 'draft' }, { id: 'owner' });
  assert.match(draft, /name="visibility" value="public"/);
  assert.match(draft, />Make Public</);
  assert.match(draft, />Private<\/span>/);
  // No filter active: the hidden fields are present but empty, never absent
  // and never carrying a caller-supplied URL.
  assert.match(draft, /name="category" value=""/);
  assert.match(draft, /name="tags" value=""/);
});

test('REW-86 owner cards add a Cookbook trigger and an inert Share placeholder', async () => {
  const html = await render(false, {}, { id: 'owner' });
  assert.equal((html.match(/class="[^"]*cookbook-add-btn[^"]*"[^>]*data-recipe-id="recipe-1"/g) || []).length, 1);
  assert.doesNotMatch(html, /cookbook-add-btn-guest/);

  // Share is visible but does nothing: disabled, no href, no target URL.
  assert.match(html, /class="btn btn-outline recipe-share-btn" disabled aria-disabled="true"/);
  assert.match(html, /title="Sharing is coming soon"/);
  assert.doesNotMatch(html, /href="\/r\/recipe-1"/);
});

test('REW-86 owner-only controls never leak onto the public Browse card', async () => {
  for (const user of [null, { id: 'owner' }, { id: 'other' }]) {
    const html = await render(true, { user_id: 'owner' }, user);
    assert.doesNotMatch(html, /\/visibility|recipe-share-btn|cookbook-add-btn|Make Public|Make Private/);
  }
});

test('Search keeps its existing card presentation and sparse data contract', async () => {
  const html = await ejs.renderFile(`${views}recipes/search.ejs`, { query: 'rice', recipes: [recipe], user: null, totalCount: 1, page: 1, totalPages: 1 });
  assert.match(html, /class="recipe-card"/);
  assert.equal(mealPlanTriggers(html).length, 1);
  assert.match(html, /meal-plan-add-btn-guest/);
  assert.doesNotMatch(html, />View<\/a>/);
  assert.doesNotMatch(html, /recipe-summary-card|Prep Time:|Cook Time:|Created|tag-badge/);
});

test('Browse and My Recipes pages both use shared cards with one meal-plan trigger per recipe', async () => {
  const common = { recipes: [recipe], user: { id: 'owner' }, csrfToken: 'csrf-test' };
  const browse = await ejs.renderFile(`${views}recipes/browse.ejs`, { ...common, totalCount: 1, page: 1, totalPages: 1 });
  const own = await ejs.renderFile(`${views}recipes/index.ejs`, { ...common, categories: [], userTags: [], selectedCategory: '', selectedTags: '' });
  for (const html of [browse, own]) {
    assert.equal((html.match(/feature-card recipe-summary-card/g) || []).length, 1);
    assert.match(html, /Prep Time: 10 minutes/);
    assert.match(html, /Cook Time: 30 minutes/);
    assert.match(html, /class="tag-badge"/);
    assert.equal(mealPlanTriggers(html).length, 1);
    assert.doesNotMatch(html, /meal-plan-add-btn-guest/);
    assert.doesNotMatch(html, />View<\/a>/);
  }
});

test('REW-87 a favorited recipe you do not own shows every shared control and no owner control', async () => {
  // Signed-in viewer who is NOT the author -- the common case on this page.
  const html = await renderFavorite({}, { id: 'someone-else' });

  // Title links to the richer authenticated view, not the public /r/:id one.
  assert.match(html, /<h3[^>]*>[\s\S]*href="\/recipes\/recipe-1"[\s\S]*Long &lt;title&gt;[\s\S]*<\/h3>/);
  // Heart is live: every recipe reachable from Favorites is published.
  assert.match(html, /class="like-btn" data-recipe-id="recipe-1" data-liked="true"/);
  assert.doesNotMatch(html, /class="like-btn" disabled/);
  assert.match(html, /By Chef &lt;script&gt;/);
  assert.match(html, /class="tag-badge"/);
  for (const label of ['Prep Time: 10 minutes', 'Cook Time: 30 minutes', 'Servings: 4', 'Difficulty: Easy']) {
    assert.ok(html.includes(label), label);
  }
  assert.equal(mealPlanTriggers(html).length, 1);
  assert.equal((html.match(/class="[^"]*cookbook-add-btn[^"]*"[^>]*data-recipe-id="recipe-1"/g) || []).length, 1);
  assert.doesNotMatch(html, /meal-plan-add-btn-guest|cookbook-add-btn-guest/);
  assert.match(html, /class="btn btn-outline recipe-share-btn" disabled aria-disabled="true"/);

  // Owner-only controls must not be drawn for a non-owner, and the surface
  // carries neither the visibility toggle nor Browse's status pill.
  assert.doesNotMatch(html, /\/edit|\/delete|\/visibility|Make Public|Make Private|<form|badge-published|badge-draft/);
  assert.doesNotMatch(html, />View<\/a>/);
  // Escaping still holds on this branch (title, author and tag are hostile).
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('REW-87 a favorited recipe you own adds Edit and Delete but still no visibility toggle', async () => {
  const html = await renderFavorite({}, { id: OWNER_ID });

  assert.ok(html.includes('/recipes/recipe-1/edit'), 'owner sees Edit');
  assert.ok(html.includes('action="/recipes/recipe-1/delete" method="POST"'), 'owner sees the Delete form');
  assert.ok(html.includes("return confirm("), 'Delete stays confirm-guarded');
  assert.equal((html.match(/name="_csrf" value="csrf-test"/g) || []).length, 1);
  // Everything the non-owner card has is still here.
  assert.equal(mealPlanTriggers(html).length, 1);
  assert.match(html, /cookbook-add-btn/);
  assert.match(html, /recipe-share-btn/);
  // Owners flip visibility from My Recipes; Favorites never offers it.
  assert.doesNotMatch(html, /\/visibility|Make Public|Make Private|badge-published|badge-draft/);
});

test('REW-87 favorites cards never leak user_id, never link chips, and fail closed on ownership', async () => {
  const owned = await renderFavorite({}, { id: OWNER_ID });
  const notOwned = await renderFavorite({}, { id: 'someone-else' });
  // A recipe row without user_id (sparse data, or a surface that does not
  // fetch the column) must be treated as NOT owned rather than as owned.
  const missingOwner = await renderFavorite({ user_id: null }, { id: OWNER_ID });
  const guest = await renderFavorite({}, null);

  for (const html of [owned, notOwned, missingOwner, guest]) {
    assert.ok(!html.includes(OWNER_ID), 'recipe user_id must never be rendered');
    // Chips are plain text here: /recipes?category= filters YOUR recipes, so
    // following one from a stranger's recipe would land on an unrelated list.
    assert.doesNotMatch(html, /href="\/recipes\?/);
    assert.match(html, /class="category-badge"/);
  }

  for (const html of [notOwned, missingOwner, guest]) {
    assert.doesNotMatch(html, /\/edit|\/delete|<form/);
  }
  assert.match(guest, /meal-plan-add-btn-guest/);
  assert.match(guest, /cookbook-add-btn-guest/);
});

test('REW-87 My Favorites page renders standardized cards and keeps its page furniture', async () => {
  const html = await ejs.renderFile(`${views}recipes/liked.ejs`, {
    recipes: [favoriteRecipe], user: { id: OWNER_ID }, csrfToken: 'csrf-test',
  });
  assert.match(html, /<h1>My Favorites<\/h1>/);
  assert.match(html, /class="result-count">1 recipe<\/p>/);
  assert.match(html, /class="organization-card-grid"/);
  assert.equal((html.match(/feature-card recipe-summary-card/g) || []).length, 1);
  assert.match(html, /href="\/recipes\/recipe-1"/);
  assert.match(html, /Prep Time: 10 minutes/);
  assert.equal(mealPlanTriggers(html).length, 1);
  assert.doesNotMatch(html, /meal-plan-add-btn-guest/);
  assert.doesNotMatch(html, />View<\/a>/);
  assert.ok(!html.includes(OWNER_ID));
  // The old lightweight card and its bare metadata are intentionally gone.
  assert.doesNotMatch(html, /<article class="recipe-card">|@Chef|4 servings/);

  const empty = await ejs.renderFile(`${views}recipes/liked.ejs`, { recipes: [], user: { id: OWNER_ID }, csrfToken: 'csrf-test' });
  assert.match(empty, /No favorites yet/);
  assert.match(empty, /href="\/browse" class="btn btn-primary">Browse Recipes<\/a>/);
  assert.doesNotMatch(empty, /recipe-summary-card|result-count/);
});

test('Cookbook and meal-plan index cards keep title navigation and editing without View', async () => {
  const cookbookIndex = await ejs.renderFile(`${views}cookbooks/index.ejs`, {
    cookbooks: [{ id: 'cookbook-1', title: 'Weeknight Favorites', recipeCount: 1, created_at: '2026-01-01T12:00:00Z' }],
  });
  assert.match(cookbookIndex, /<h3[^>]*>[\s\S]*href="\/cookbooks\/cookbook-1"[\s\S]*Weeknight Favorites[\s\S]*<\/h3>/);
  assert.match(cookbookIndex, /href="\/cookbooks\/cookbook-1\/edit"[^>]*>Rename<\/a>/);
  assert.doesNotMatch(cookbookIndex, />View<\/a>/);

  const mealPlanIndex = await ejs.renderFile(`${views}meal-plans/index.ejs`, {
    mealPlans: [{ id: 'meal-plan-1', title: 'This Week', recipeCount: 1, start_date: '2026-01-01', end_date: '2026-01-07' }],
  });
  assert.match(mealPlanIndex, /<h3[^>]*>[\s\S]*href="\/meal-plans\/meal-plan-1"[\s\S]*This Week[\s\S]*<\/h3>/);
  assert.match(mealPlanIndex, /href="\/meal-plans\/meal-plan-1\/edit"[^>]*>Edit<\/a>/);
  assert.doesNotMatch(mealPlanIndex, />View<\/a>/);
});

test('Cookbook recipe cards expose the meal-plan trigger and preserve protected controls', async () => {
  const html = await ejs.renderFile(`${views}cookbooks/view.ejs`, {
    cookbook: { id: 'cookbook-1', title: 'Weeknight Favorites' },
    recipes: [recipe],
    user: { id: 'owner' },
    csrfToken: 'csrf-test',
  });
  assert.equal(mealPlanTriggers(html).length, 1);
  assert.doesNotMatch(html, /meal-plan-add-btn-guest/);
  assert.match(html, /<h3[^>]*>[\s\S]*href="\/recipes\/recipe-1"[\s\S]*Long &lt;title&gt;[\s\S]*<\/h3>/);
  assert.doesNotMatch(html, />View<\/a>/);
  assert.match(html, /action="\/cookbooks\/cookbook-1\/recipes\/recipe-1\/remove"/);
  assert.match(html, /name="_csrf" value="csrf-test"/);
  assert.match(html, /name="returnTo" value="cookbook"/);
  assert.match(html, /return confirm\('Remove this recipe from the cookbook\?/);
  assert.match(html, />Remove<\/button>/);
  assert.match(html, /class="recipe-card-actions"[^>]*flex-wrap: wrap/);
});

test('Meal-plan recipe cards link their titles and preserve protected removal without View', async () => {
  const html = await ejs.renderFile(`${views}meal-plans/view.ejs`, {
    mealPlan: { id: 'meal-plan-1', title: 'This Week', start_date: '2026-01-01', end_date: '2026-01-07' },
    recipes: [recipe],
    user: { id: 'owner' },
    csrfToken: 'csrf-test',
  });
  assert.match(html, /<h3[^>]*>[\s\S]*href="\/recipes\/recipe-1"[\s\S]*Long &lt;title&gt;[\s\S]*<\/h3>/);
  assert.doesNotMatch(html, />View<\/a>/);
  assert.match(html, /action="\/meal-plans\/meal-plan-1\/recipes\/recipe-1\/remove"/);
  assert.match(html, /name="_csrf" value="csrf-test"/);
  assert.match(html, /return confirm\('Remove this recipe from the meal plan\?/);
  assert.match(html, />Remove<\/button>/);
});
