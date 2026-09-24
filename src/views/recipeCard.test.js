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

// REW-88: Cookbook is the fourth surface, and as of REW-100 a genuinely mixed
// one -- migration 021 widened the RLS INSERT policy on cookbook_recipes to
// admit your own recipes OR anyone's published recipe, so a card the viewer
// does not own is a normal case here rather than a future possibility.
// Ownership was already computed per card by REW-88, which is why REW-100
// needed no structural view change, only the status-free disabled heart.
const cookbookRecipe = { ...recipe, user_id: OWNER_ID };
const renderCookbook = (overrides = {}, user = null, locals = {}) => ejs.renderFile(`${views}partials/recipe-summary-card.ejs`, {
  recipe: { ...cookbookRecipe, ...overrides }, surface: 'cookbook', cookbookId: 'cookbook-1',
  user, csrfToken: 'csrf-test', ...locals,
});

// REW-89: Meal Plan is the fifth surface, and the first GENUINELY mixed one --
// the RLS INSERT policy on meal_plan_recipes (migration 012) admits your own
// recipes or anyone's published recipe, so a card you do not own is the normal
// case here rather than a future possibility.
const mealPlanRecipe = { ...recipe, user_id: OWNER_ID };
const renderMealPlan = (overrides = {}, user = null, locals = {}) => ejs.renderFile(`${views}partials/recipe-summary-card.ejs`, {
  recipe: { ...mealPlanRecipe, ...overrides }, surface: 'meal-plan', mealPlanId: 'meal-plan-1',
  user, csrfToken: 'csrf-test', ...locals,
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

test('REW-88 a cookbook recipe you own shows every standardized control plus Remove', async () => {
  const html = await renderCookbook({}, { id: OWNER_ID });

  // Title, heart, author, chips and the four Label: value fields -- the same
  // content every other standardized surface shows.
  assert.match(html, /<h3[^>]*>[\s\S]*href="\/recipes\/recipe-1"[\s\S]*Long &lt;title&gt;[\s\S]*<\/h3>/);
  assert.match(html, /class="like-btn" data-recipe-id="recipe-1" data-liked="true"/);
  assert.match(html, /By Chef &lt;script&gt;/);
  assert.match(html, /class="tag-badge"/);
  assert.match(html, /class="category-badge"/);
  for (const label of ['Prep Time: 10 minutes', 'Cook Time: 30 minutes', 'Servings: 4', 'Difficulty: Easy']) {
    assert.ok(html.includes(label), label);
  }

  // Shared actions.
  assert.equal(mealPlanTriggers(html).length, 1);
  assert.doesNotMatch(html, /meal-plan-add-btn-guest/);
  assert.match(html, /class="btn btn-outline recipe-share-btn" disabled aria-disabled="true"/);
  assert.match(html, /title="Sharing is coming soon"/);

  // The page-specific Remove action, carried over intact.
  assert.match(html, /action="\/cookbooks\/cookbook-1\/recipes\/recipe-1\/remove" method="POST"/);
  assert.match(html, /name="returnTo" value="cookbook"/);
  assert.match(html, /return confirm\('Remove this recipe from the cookbook\?/);
  assert.match(html, />Remove<\/button>/);

  // Owner controls, each with its own token and its own distinct confirm.
  assert.ok(html.includes('/recipes/recipe-1/edit'), 'owner sees Edit');
  assert.ok(html.includes('action="/recipes/recipe-1/delete" method="POST"'), 'owner sees the Delete form');
  assert.match(html, /return confirm\('Are you sure you want to delete this recipe\?/);
  assert.equal((html.match(/name="_csrf" value="csrf-test"/g) || []).length, 2);

  // The recipe is already in a cookbook, and owners flip visibility from My
  // Recipes -- neither control belongs on this surface.
  assert.doesNotMatch(html, /cookbook-add-btn|\/visibility|Make Public|Make Private/);

  // Edit physically separates "remove from cookbook" from "delete forever",
  // and Delete is the last control and the only red one.
  assert.ok(html.indexOf('/remove') < html.indexOf('/recipes/recipe-1/edit'), 'Remove comes before Edit');
  assert.ok(html.indexOf('/recipes/recipe-1/edit') < html.indexOf('/recipes/recipe-1/delete'), 'Edit comes before Delete');
  const withoutDelete = html.replace(/<form action="\/recipes\/recipe-1\/delete"[\s\S]*?<\/form>/, '');
  assert.doesNotMatch(withoutDelete, /--error-color/);

  assert.match(html, /class="recipe-card-actions recipe-summary-actions"[^>]*flex-wrap: wrap/);
  assert.doesNotMatch(html, />View<\/a>/);
});

test('REW-88 a cookbook recipe you do not own keeps Remove but loses Edit, Delete and the pill', async () => {
  // The post-REW-100 shape: signed in, but not the author of this recipe.
  const html = await renderCookbook({}, { id: 'someone-else' });

  assert.match(html, /class="like-btn" data-recipe-id="recipe-1" data-liked="true"/);
  assert.equal(mealPlanTriggers(html).length, 1);
  assert.match(html, /recipe-share-btn/);
  // Remove is cookbook membership, not recipe ownership: it stays.
  assert.match(html, /action="\/cookbooks\/cookbook-1\/recipes\/recipe-1\/remove" method="POST"/);
  assert.equal((html.match(/name="_csrf" value="csrf-test"/g) || []).length, 1);

  assert.doesNotMatch(html, /\/edit|\/delete|\/visibility|Make Public|Make Private|cookbook-add-btn/);
  // No status claim about somebody else's recipe.
  assert.doesNotMatch(html, /badge-published|badge-draft/);
});

test('REW-88 the owner-only pill and the heart render together, and Private disables the heart', async () => {
  const draft = await renderCookbook({ status: 'draft' }, { id: OWNER_ID });
  // /api/likes requires status = 'published', so the heart is disabled with
  // an explanation rather than hidden -- same as My Recipes.
  assert.match(draft, /class="like-btn" disabled aria-label="Make this recipe Public to add it to favorites"/);
  assert.match(draft, /class="badge-draft badge-draft-sm">Private<\/span>/);

  const published = await renderCookbook({}, { id: OWNER_ID });
  assert.match(published, /class="like-btn" data-recipe-id="recipe-1" data-liked="true"/);
  assert.match(published, /class="badge-published badge-published-sm">Public<\/span>/);

  // Read-only pill only: this surface never offers the toggle.
  assert.doesNotMatch(draft, /\/visibility|Make Public|Make Private/);
  // A viewer who does not own the recipe is told nothing about its status.
  const stranger = await renderCookbook({ status: 'draft' }, { id: 'someone-else' });
  assert.doesNotMatch(stranger, /badge-draft|badge-published/);
});

test('REW-100 a non-owner viewing a draft cookbook card gets a status-free disabled heart', async () => {
  // The REW-88 documentation pass flagged the old label as a status claim:
  // "Make this recipe Public to add it to favorites" tells a stranger that
  // somebody else's recipe is Private. Not reachable through any UI path today
  // (001's recipes SELECT policy hides another user's draft, getCookbookRecipes
  // drops junction rows whose embedded recipe came back null, and
  // /recipes/liked filters on status = 'published') -- this is defence in
  // depth, pinned so it stays correct by construction.
  const stranger = await renderCookbook({ status: 'draft' }, { id: 'someone-else' });

  // Still rendered, still disabled: hiding it would shift the header row
  // layout between cards, and a live-looking heart could never succeed.
  assert.match(stranger, /class="like-btn" disabled aria-label="Favorites are unavailable for this recipe" title="Favorites are unavailable for this recipe"/);
  assert.doesNotMatch(stranger, /data-recipe-id="recipe-1" data-liked=/);

  // Neither accessible name says anything about visibility.
  const labels = [
    ...stranger.matchAll(/<button[^>]*class="like-btn"[^>]*>/g),
  ].map(([tag]) => tag);
  assert.equal(labels.length, 1, 'exactly one heart is rendered');
  assert.doesNotMatch(labels[0], /Public|Private|draft|published|visibility|unpublished/i);

  // And the pill absence from REW-88 still holds for this viewer.
  assert.doesNotMatch(stranger, /badge-draft|badge-published/);
  // The owner keeps the actionable explanation -- they can go flip it.
  const owner = await renderCookbook({ status: 'draft' }, { id: OWNER_ID });
  assert.match(owner, /class="like-btn" disabled aria-label="Make this recipe Public to add it to favorites"/);
  assert.doesNotMatch(owner, /Favorites are unavailable for this recipe/);
});

test('REW-88 cookbook cards never leak user_id, never link chips, and degrade safely', async () => {
  const owned = await renderCookbook({}, { id: OWNER_ID });
  const notOwned = await renderCookbook({}, { id: 'someone-else' });
  // A recipe row without user_id must be treated as NOT owned, never as owned.
  const missingOwner = await renderCookbook({ user_id: null }, { id: OWNER_ID });

  for (const html of [owned, notOwned, missingOwner]) {
    assert.ok(!html.includes(OWNER_ID), 'recipe user_id must never be rendered');
    // Chips are plain text: /recipes?category= filters YOUR recipes.
    assert.doesNotMatch(html, /href="\/recipes\?/);
    assert.match(html, /class="category-badge"/);
    // Hostile title, author and tag all stay escaped on this branch too.
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
  }
  assert.doesNotMatch(missingOwner, /\/recipes\/recipe-1\/edit|\/recipes\/recipe-1\/delete/);

  // A caller that forgets cookbookId gets no Remove button rather than a
  // form posting to /cookbooks//recipes/...
  const noCookbookId = await ejs.renderFile(`${views}partials/recipe-summary-card.ejs`, {
    recipe: cookbookRecipe, surface: 'cookbook', user: { id: OWNER_ID }, csrfToken: 'csrf-test',
  });
  assert.doesNotMatch(noCookbookId, />Remove<\/button>|\/remove/);
  assert.equal(mealPlanTriggers(noCookbookId).length, 1);

  // Sparse recipe: no stray label, no empty chip row, no undefined/null.
  const sparse = await renderCookbook({
    author: null, thumbnail_url: null, prep_time: null, cook_time: null,
    servings: null, difficulty: null, tags: null, categories: null,
  }, { id: OWNER_ID });
  assert.doesNotMatch(sparse, /<img|By |Prep Time:|Cook Time:|Servings:|Difficulty:|tag-badge|category-badge|undefined|null/);
});

test('REW-88 the cookbook page renders standardized cards and keeps its page furniture', async () => {
  const pageLocals = {
    cookbook: { id: 'cookbook-1', title: 'Weeknight Favorites' },
    user: { id: OWNER_ID },
    csrfToken: 'csrf-test',
  };
  const html = await ejs.renderFile(`${views}cookbooks/view.ejs`, { ...pageLocals, recipes: [cookbookRecipe] });

  assert.match(html, /class="organization-card-grid"/);
  assert.equal((html.match(/feature-card recipe-summary-card/g) || []).length, 1);
  assert.equal(mealPlanTriggers(html).length, 1);
  assert.doesNotMatch(html, /meal-plan-add-btn-guest/);
  assert.match(html, /<h3[^>]*>[\s\S]*href="\/recipes\/recipe-1"[\s\S]*Long &lt;title&gt;[\s\S]*<\/h3>/);
  assert.doesNotMatch(html, />View<\/a>/);
  assert.match(html, /action="\/cookbooks\/cookbook-1\/recipes\/recipe-1\/remove"/);
  assert.match(html, /name="_csrf" value="csrf-test"/);
  assert.match(html, /name="returnTo" value="cookbook"/);
  assert.match(html, /return confirm\('Remove this recipe from the cookbook\?/);
  assert.match(html, />Remove<\/button>/);
  // The action row is the shared one now, so it carries both classes.
  assert.match(html, /class="recipe-card-actions recipe-summary-actions"[^>]*flex-wrap: wrap/);
  // No + Cookbook anywhere on the page: these recipes are already in one.
  assert.doesNotMatch(html, /cookbook-add-btn/);
  // Standardized metadata replaced the old hand-rolled labels.
  assert.match(html, /Prep Time: 10 minutes/);
  assert.match(html, /Difficulty: Easy/);
  assert.doesNotMatch(html, /Prep: |Cook: |4 servings/);
  assert.ok(!html.includes(OWNER_ID));

  // Page furniture the swap must not disturb.
  assert.match(html, /class="cookbook-visibility-control"/);
  assert.match(html, /href="\/cookbooks\/cookbook-1\/add-recipes"/);
  assert.match(html, /<script src="\/js\/cookbook-share\.js"><\/script>/);

  const empty = await ejs.renderFile(`${views}cookbooks/view.ejs`, { ...pageLocals, recipes: [] });
  assert.match(empty, /No recipes in this cookbook yet/);
  assert.match(empty, /href="\/cookbooks\/cookbook-1\/add-recipes" class="btn btn-primary">Add Recipes<\/a>/);
  assert.doesNotMatch(empty, /recipe-summary-card/);
});

test('REW-89 a meal-plan recipe you own shows every standardized control plus Remove', async () => {
  const html = await renderMealPlan({}, { id: OWNER_ID });

  // Title, heart, author, chips and the four Label: value fields -- the same
  // content every other standardized surface shows.
  assert.match(html, /<h3[^>]*>[\s\S]*href="\/recipes\/recipe-1"[\s\S]*Long &lt;title&gt;[\s\S]*<\/h3>/);
  assert.match(html, /class="like-btn" data-recipe-id="recipe-1" data-liked="true"/);
  assert.match(html, /By Chef &lt;script&gt;/);
  assert.match(html, /class="tag-badge"/);
  assert.match(html, /class="category-badge"/);
  for (const label of ['Prep Time: 10 minutes', 'Cook Time: 30 minutes', 'Servings: 4', 'Difficulty: Easy']) {
    assert.ok(html.includes(label), label);
  }

  // Shared actions. Unlike the cookbook surface, + Cookbook IS offered here:
  // a recipe in a meal plan may well not be in a cookbook yet.
  assert.equal((html.match(/class="[^"]*cookbook-add-btn[^"]*"[^>]*data-recipe-id="recipe-1"/g) || []).length, 1);
  assert.doesNotMatch(html, /cookbook-add-btn-guest/);
  assert.match(html, /class="btn btn-outline recipe-share-btn" disabled aria-disabled="true"/);
  assert.match(html, /title="Sharing is coming soon"/);

  // The page-specific Remove action, carried over intact. No returnTo field:
  // POST /meal-plans/:id/recipes/:recipeId/remove always redirects to the plan.
  assert.match(html, /action="\/meal-plans\/meal-plan-1\/recipes\/recipe-1\/remove" method="POST"/);
  assert.match(html, /return confirm\('Remove this recipe from the meal plan\?/);
  assert.match(html, />Remove<\/button>/);
  assert.doesNotMatch(html, /name="returnTo"/);

  // Owner controls, each with its own token and its own distinct confirm.
  assert.ok(html.includes('/recipes/recipe-1/edit'), 'owner sees Edit');
  assert.ok(html.includes('action="/recipes/recipe-1/delete" method="POST"'), 'owner sees the Delete form');
  assert.match(html, /return confirm\('Are you sure you want to delete this recipe\?/);
  assert.equal((html.match(/name="_csrf" value="csrf-test"/g) || []).length, 2);

  // Owners flip visibility from My Recipes, never from here.
  assert.doesNotMatch(html, /\/visibility|Make Public|Make Private/);

  // Edit physically separates "remove from the plan" from "delete forever",
  // and Delete is the last control and the only red one.
  assert.ok(html.indexOf('/remove') < html.indexOf('/recipes/recipe-1/edit'), 'Remove comes before Edit');
  assert.ok(html.indexOf('/recipes/recipe-1/edit') < html.indexOf('/recipes/recipe-1/delete'), 'Edit comes before Delete');
  const withoutDelete = html.replace(/<form action="\/recipes\/recipe-1\/delete"[\s\S]*?<\/form>/, '');
  assert.doesNotMatch(withoutDelete, /--error-color/);

  assert.match(html, /class="recipe-card-actions recipe-summary-actions"[^>]*flex-wrap: wrap/);
  assert.doesNotMatch(html, />View<\/a>/);
});

test('REW-89 the meal-plan surface never offers + Meal Plan, to any viewer', async () => {
  // The ticket's distinguishing requirement: the recipe is already in a meal
  // plan, so the trigger that would add it to one is suppressed entirely --
  // both the signed-in variant and the guest variant.
  for (const user of [{ id: OWNER_ID }, { id: 'someone-else' }, null]) {
    const html = await renderMealPlan({}, user);
    assert.equal(mealPlanTriggers(html).length, 0, '+ Meal Plan must not be drawn on this surface');
    assert.doesNotMatch(html, /meal-plan-add-btn/);
    assert.doesNotMatch(html, /meal-plan-add-btn-guest/);
    // ...while + Cookbook, which the ticket does ask for, is still there once.
    assert.equal((html.match(/class="[^"]*cookbook-add-btn[^"]*"[^>]*data-recipe-id="recipe-1"/g) || []).length, 1);
  }

  // Suppression is scoped to this surface only: the other four still offer it.
  assert.equal(mealPlanTriggers(await render(true, { user_id: OWNER_ID }, { id: OWNER_ID })).length, 1);
  assert.equal(mealPlanTriggers(await render(false, {}, { id: 'owner' })).length, 1);
  assert.equal(mealPlanTriggers(await renderFavorite({}, { id: OWNER_ID })).length, 1);
  assert.equal(mealPlanTriggers(await renderCookbook({}, { id: OWNER_ID })).length, 1);
});

test('REW-89 a meal-plan recipe you do not own keeps Remove but loses Edit, Delete and the pill', async () => {
  // Not hypothetical on this surface: migration 012 lets a plan hold anyone's
  // published recipe, so this is the production-real mixed case.
  const html = await renderMealPlan({}, { id: 'someone-else' });

  assert.match(html, /class="like-btn" data-recipe-id="recipe-1" data-liked="true"/);
  assert.match(html, /cookbook-add-btn/);
  assert.match(html, /recipe-share-btn/);
  // Remove is meal plan membership, not recipe ownership: it stays.
  assert.match(html, /action="\/meal-plans\/meal-plan-1\/recipes\/recipe-1\/remove" method="POST"/);
  assert.equal((html.match(/name="_csrf" value="csrf-test"/g) || []).length, 1);

  assert.doesNotMatch(html, /\/edit|\/delete|\/visibility|Make Public|Make Private/);
  // No status claim about somebody else's recipe.
  assert.doesNotMatch(html, /badge-published|badge-draft/);
});

test('REW-89 the owner-only pill and the heart render together, and Private disables the heart', async () => {
  const draft = await renderMealPlan({ status: 'draft' }, { id: OWNER_ID });
  // /api/likes requires status = 'published', so the heart is disabled with an
  // explanation rather than hidden -- same as My Recipes and Cookbook.
  assert.match(draft, /class="like-btn" disabled aria-label="Make this recipe Public to add it to favorites"/);
  // The pill is how the owner learns this recipe will not appear to the people
  // they share the plan with at /m/:id.
  assert.match(draft, /class="badge-draft badge-draft-sm">Private<\/span>/);

  const published = await renderMealPlan({}, { id: OWNER_ID });
  assert.match(published, /class="like-btn" data-recipe-id="recipe-1" data-liked="true"/);
  assert.match(published, /class="badge-published badge-published-sm">Public<\/span>/);

  // Read-only pill only: this surface never offers the toggle.
  assert.doesNotMatch(draft, /\/visibility|Make Public|Make Private/);
  // A viewer who does not own the recipe is told nothing about its status.
  const stranger = await renderMealPlan({ status: 'draft' }, { id: 'someone-else' });
  assert.doesNotMatch(stranger, /badge-draft|badge-published/);
});

test('REW-89 meal-plan cards never leak user_id, never link chips, and degrade safely', async () => {
  const owned = await renderMealPlan({}, { id: OWNER_ID });
  const notOwned = await renderMealPlan({}, { id: 'someone-else' });
  // A recipe row without user_id must be treated as NOT owned, never as owned.
  const missingOwner = await renderMealPlan({ user_id: null }, { id: OWNER_ID });

  for (const html of [owned, notOwned, missingOwner]) {
    assert.ok(!html.includes(OWNER_ID), 'recipe user_id must never be rendered');
    // Chips are plain text: /recipes?category= filters YOUR recipes.
    assert.doesNotMatch(html, /href="\/recipes\?/);
    assert.match(html, /class="category-badge"/);
    // Hostile title, author and tag all stay escaped on this branch too.
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
  }
  assert.doesNotMatch(missingOwner, /\/recipes\/recipe-1\/edit|\/recipes\/recipe-1\/delete/);

  // A caller that forgets mealPlanId gets no Remove button rather than a form
  // posting to /meal-plans//recipes/...
  const noMealPlanId = await ejs.renderFile(`${views}partials/recipe-summary-card.ejs`, {
    recipe: mealPlanRecipe, surface: 'meal-plan', user: { id: OWNER_ID }, csrfToken: 'csrf-test',
  });
  assert.doesNotMatch(noMealPlanId, />Remove<\/button>|\/remove/);
  assert.equal(mealPlanTriggers(noMealPlanId).length, 0);

  // Sparse recipe: no stray label, no empty chip row, no undefined/null.
  const sparse = await renderMealPlan({
    author: null, thumbnail_url: null, prep_time: null, cook_time: null,
    servings: null, difficulty: null, tags: null, categories: null,
  }, { id: OWNER_ID });
  assert.doesNotMatch(sparse, /<img|By |Prep Time:|Cook Time:|Servings:|Difficulty:|tag-badge|category-badge|undefined|null/);
});

test('REW-89 the meal plan page renders standardized cards and keeps its page furniture', async () => {
  const pageLocals = {
    mealPlan: { id: 'meal-plan-1', title: 'This Week', start_date: '2026-01-01', end_date: '2026-01-07' },
    user: { id: OWNER_ID },
    csrfToken: 'csrf-test',
  };
  const html = await ejs.renderFile(`${views}meal-plans/view.ejs`, { ...pageLocals, recipes: [mealPlanRecipe] });

  assert.match(html, /class="organization-card-grid"/);
  assert.equal((html.match(/feature-card recipe-summary-card/g) || []).length, 1);
  assert.equal(mealPlanTriggers(html).length, 0);
  assert.match(html, /<h3[^>]*>[\s\S]*href="\/recipes\/recipe-1"[\s\S]*Long &lt;title&gt;[\s\S]*<\/h3>/);
  assert.doesNotMatch(html, />View<\/a>/);
  assert.match(html, /action="\/meal-plans\/meal-plan-1\/recipes\/recipe-1\/remove"/);
  assert.match(html, /name="_csrf" value="csrf-test"/);
  assert.match(html, /return confirm\('Remove this recipe from the meal plan\?/);
  assert.match(html, />Remove<\/button>/);
  // The action row is the shared one now, so it carries both classes.
  assert.match(html, /class="recipe-card-actions recipe-summary-actions"[^>]*flex-wrap: wrap/);
  // Standardized metadata replaced the old hand-rolled labels.
  assert.match(html, /Prep Time: 10 minutes/);
  assert.match(html, /Difficulty: Easy/);
  assert.doesNotMatch(html, /Prep: |Cook: |4 servings/);
  assert.ok(!html.includes(OWNER_ID));

  // Page furniture the swap must not disturb.
  assert.match(html, /class="meal-plan-visibility-control"/);
  assert.match(html, /href="\/meal-plans\/meal-plan-1\/add-recipes"/);
  assert.match(html, /href="\/meal-plans\/meal-plan-1\/grocery-list"/);
  assert.match(html, /<script src="\/js\/meal-plan-share\.js"><\/script>/);

  const empty = await ejs.renderFile(`${views}meal-plans/view.ejs`, { ...pageLocals, recipes: [] });
  assert.match(empty, /No recipes in this meal plan yet/);
  assert.match(empty, /href="\/meal-plans\/meal-plan-1\/add-recipes" class="btn btn-primary">Add Recipes<\/a>/);
  assert.doesNotMatch(empty, /recipe-summary-card/);
});
