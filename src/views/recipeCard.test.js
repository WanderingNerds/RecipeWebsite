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
    assert.equal(html.includes('meal-plan-add-btn-guest'), !user);
    assert.doesNotMatch(html, /\/recipes\?|\/edit|\/delete|like-btn|<form/);
  }
});

test('Private controls retain filters, favorites and protected deletion', async () => {
  const html = await render(false);
  for (const text of ['/recipes/recipe-1/edit', '/recipes/recipe-1/delete', '/recipes?category=dinner', '/recipes?tags=safe', 'data-liked="true"', 'name="_csrf" value="csrf-test"', "return confirm("]) assert.ok(html.includes(text), text);
  assert.match(html, /href="\/recipes\/recipe-1"/);
  assert.match(html, /aria-label="Remove from favorites"/);
  const notFavorited = await render(false, { isLiked: false });
  assert.match(notFavorited, /aria-label="Favorite this recipe"/);
  const draft = await render(false, { status: 'draft' });
  assert.match(draft, /class="like-btn" disabled/);
  assert.match(draft, />Draft<\/span>/);
});

test('Search keeps its existing card presentation and sparse data contract', async () => {
  const html = await ejs.renderFile(`${views}recipes/search.ejs`, { query: 'rice', recipes: [recipe], user: null, totalCount: 1, page: 1, totalPages: 1 });
  assert.match(html, /class="recipe-card"/);
  assert.doesNotMatch(html, /recipe-summary-card|Prep:|Cook:|Created|tag-badge/);
});

test('Browse and My Recipes pages both use shared cards', async () => {
  const common = { recipes: [recipe], user: null, csrfToken: 'csrf-test' };
  const browse = await ejs.renderFile(`${views}recipes/browse.ejs`, { ...common, totalCount: 1, page: 1, totalPages: 1 });
  const own = await ejs.renderFile(`${views}recipes/index.ejs`, { ...common, categories: [], userTags: [], selectedCategory: '', selectedTags: '' });
  for (const html of [browse, own]) {
    assert.equal((html.match(/feature-card recipe-summary-card/g) || []).length, 1);
    assert.match(html, /Prep: 10 minutes/);
    assert.match(html, /Cook: 30 minutes/);
    assert.match(html, /class="tag-badge"/);
  }
});
