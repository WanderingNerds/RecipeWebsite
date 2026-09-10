import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryFile = relativePath => fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

const organizationViews = [
  'views/recipes/index.ejs',
  'views/recipes/liked.ejs',
  'views/cookbooks/index.ejs',
  'views/cookbooks/view.ejs',
  'views/meal-plans/index.ejs',
  'views/meal-plans/view.ejs',
];

test('all personal-organization card collections use the shared grid contract', async () => {
  for (const view of organizationViews) {
    const template = await readFile(repositoryFile(view), 'utf8');

    assert.match(template, /class="organization-card-grid"/, `${view} should use the shared grid`);
    assert.doesNotMatch(template, /class="recipe-grid(?:-fill)?"/, `${view} should not use a count-sensitive legacy grid`);
  }
});

test('organization grid caps non-mobile tracks and uses a fluid mobile column', async () => {
  const css = await readFile(repositoryFile('public/css/styles.css'), 'utf8');
  const desktopRule = css.match(/\.organization-card-grid\s*\{([^}]*)\}/);

  assert.ok(desktopRule, 'shared organization grid CSS should exist');
  assert.match(desktopRule[1], /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(300px,\s*22rem\)\)/);
  assert.match(desktopRule[1], /justify-content:\s*start/);

  const mobileMedia = css.match(/@media\s*\(max-width:\s*480px\)\s*\{\s*\.organization-card-grid\s*\{([^}]*)\}/);
  assert.ok(mobileMedia, 'organization grid should define its 480px mobile override');
  assert.match(mobileMedia[1], /grid-template-columns:\s*1fr/);
});
