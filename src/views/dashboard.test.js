import test from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';

const dashboardView = fileURLToPath(new URL('../../views/dashboard.ejs', import.meta.url));

const renderDashboard = () => ejs.renderFile(dashboardView, {
  user: {
    email: 'cook@example.com',
    email_confirmed_at: '2026-01-01T12:00:00Z',
    created_at: '2025-01-01T12:00:00Z',
    user_metadata: { name: 'Test Cook' },
  },
});

const cardPattern = /<a class="quick-action-card[^"]*" href="([^"]+)">([\s\S]*?)<\/a>/g;

test('dashboard renders the four required full-card destinations in source order', async () => {
  const html = await renderDashboard();
  const cards = [...html.matchAll(cardPattern)];
  const expectedCards = [
    ['/recipes', 'My Recipes'],
    ['/cookbooks', 'My Cookbooks'],
    ['/recipes/liked', 'My Favorites'],
    ['/meal-plans', 'My Meal Plans'],
  ];

  assert.equal(cards.length, expectedCards.length);
  assert.deepEqual(cards.map(([, href]) => href), expectedCards.map(([href]) => href));

  for (const [index, [href, label]] of expectedCards.entries()) {
    assert.equal(cards[index][1], href);
    assert.match(cards[index][2], new RegExp(`class="quick-action-card__title">${label}<`));
  }
});

test('each quick action uses one card-level anchor with no nested interactive controls', async () => {
  const html = await renderDashboard();
  const grid = html.match(/<div class="quick-actions-grid">([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/);
  assert.ok(grid, 'quick actions grid should render');

  const cards = [...html.matchAll(cardPattern)];
  assert.equal((grid[1].match(/<a\b/g) || []).length, 4);
  for (const [, , contents] of cards) {
    assert.doesNotMatch(contents, /<(?:a|button|input|select|textarea)\b/);
  }
});

test('card icons are decorative while visible text describes every destination', async () => {
  const html = await renderDashboard();
  const cards = [...html.matchAll(cardPattern)];

  for (const [, , contents] of cards) {
    assert.match(contents, /class="quick-action-card__icon" aria-hidden="true">\s*<svg\b/);
    assert.match(contents, /class="quick-action-card__title">[^<]+<\/span>/);
    assert.match(contents, /class="quick-action-card__description">[^<]+<\/span>/);
  }
});
