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

test('Both card surfaces render all core metadata in the same order with escaped text', async () => {
  for (const isPublic of [true, false]) {
    const html = await render(isPublic);
    const fields = ['<h3', 'By Chef &lt;script&gt;', 'Breakfast', 'Lunch', 'Dinner', '&lt;script&gt;alert(1)&lt;/script&gt;', 'Family', 'Prep: 10 minutes', 'Cook: 30 minutes', '4 servings', 'Easy', 'Created'];
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
  assert.doesNotMatch(html, /<img|By |Prep:|Cook:| servings|tag-badge|category-badge|undefined|null/);
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

test('Search keeps its existing card presentation and sparse data contract', async () => {
  const html = await ejs.renderFile(`${views}recipes/search.ejs`, { query: 'rice', recipes: [recipe], user: null, totalCount: 1, page: 1, totalPages: 1 });
  assert.match(html, /class="recipe-card"/);
  assert.equal(mealPlanTriggers(html).length, 1);
  assert.match(html, /meal-plan-add-btn-guest/);
  assert.doesNotMatch(html, />View<\/a>/);
  assert.doesNotMatch(html, /recipe-summary-card|Prep:|Cook:|Created|tag-badge/);
});

test('Browse and My Recipes pages both use shared cards with one meal-plan trigger per recipe', async () => {
  const common = { recipes: [recipe], user: { id: 'owner' }, csrfToken: 'csrf-test' };
  const browse = await ejs.renderFile(`${views}recipes/browse.ejs`, { ...common, totalCount: 1, page: 1, totalPages: 1 });
  const own = await ejs.renderFile(`${views}recipes/index.ejs`, { ...common, categories: [], userTags: [], selectedCategory: '', selectedTags: '' });
  for (const html of [browse, own]) {
    assert.equal((html.match(/feature-card recipe-summary-card/g) || []).length, 1);
    assert.match(html, /Prep: 10 minutes/);
    assert.match(html, /Cook: 30 minutes/);
    assert.match(html, /class="tag-badge"/);
    assert.equal(mealPlanTriggers(html).length, 1);
    assert.doesNotMatch(html, /meal-plan-add-btn-guest/);
    assert.doesNotMatch(html, />View<\/a>/);
  }
});

test('Liked Recipes uses the shared public card without losing page content', async () => {
  const html = await ejs.renderFile(`${views}recipes/liked.ejs`, { recipes: [recipe], user: { id: 'owner' } });
  assert.match(html, /<h1>Liked Recipes<\/h1>/);
  assert.match(html, /class="result-count">1 recipe<\/p>/);
  assert.equal((html.match(/<article class="recipe-card">/g) || []).length, 1);
  assert.match(html, /href="\/r\/recipe-1"/);
  assert.match(html, /@Chef &lt;script&gt;/);
  assert.match(html, /10 minutes/);
  assert.match(html, /4 servings/);
  assert.equal(mealPlanTriggers(html).length, 1);
  assert.doesNotMatch(html, /meal-plan-add-btn-guest/);
  assert.doesNotMatch(html, />View<\/a>/);
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
