import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  recipeSearchStatus,
  recipeTitleMatches,
} from '../../public/js/meal-plan-recipe-search.js';

const repositoryFile = relativePath => fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

test('meal plan recipe picker exposes an accessible title search', async () => {
  const template = await readFile(repositoryFile('views/meal-plans/add-recipes.ejs'), 'utf8');

  assert.match(template, /type="search"/);
  assert.match(template, /id="meal-plan-recipe-search"/);
  assert.match(template, /aria-controls="meal-plan-recipe-list"/);
  assert.match(template, /data-recipe-title="<%= recipe\.title %>"/);
  assert.match(template, /role="status" aria-live="polite"/);
  assert.match(template, /id="meal-plan-recipe-search-clear"[^>]*hidden/);
  assert.match(template, /id="meal-plan-recipe-search-empty"[^>]*hidden/);
  assert.match(template, /src="\/js\/meal-plan-recipe-search\.js"/);
});

test('meal plan recipe search is wired for live filtering and explicit clearing', async () => {
  const client = await readFile(repositoryFile('public/js/meal-plan-recipe-search.js'), 'utf8');

  assert.match(client, /addEventListener\('input', filterRecipes\)/);
  assert.match(client, /searchInput\.value\.trim\(\)\.toLocaleLowerCase\(\)/);
  assert.match(client, /recipeTitleMatches\(item\.dataset\.recipeTitle, searchTerm\)/);
  assert.match(client, /item\.hidden = !matches/);
  assert.match(client, /item\.style\.display = matches \? 'flex' : 'none'/);
  assert.match(client, /emptyState\.hidden = visibleCount !== 0/);
  assert.match(client, /clearButton\.addEventListener\('click'/);
  assert.match(client, /searchInput\.value = ''/);
  assert.match(client, /filterRecipes\(\);/);
});

test('title matching trims the query and ignores case', () => {
  assert.equal(recipeTitleMatches('Chicken Pot Pie', '  POT  '), true);
  assert.equal(recipeTitleMatches('Chicken Pot Pie', 'pasta'), false);
  assert.equal(recipeTitleMatches('Crème Brûlée', ''), true);
});

test('search status distinguishes filtered results from the restored full list', () => {
  assert.equal(recipeSearchStatus(1, 40, 'pie'), '1 recipe found');
  assert.equal(recipeSearchStatus(0, 40, 'pasta'), '0 recipes found');
  assert.equal(recipeSearchStatus(40, 40, ''), '40 recipes available');
});
