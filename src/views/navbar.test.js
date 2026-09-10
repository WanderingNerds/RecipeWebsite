import test from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';

const navbarView = fileURLToPath(new URL('../../views/partials/navbar.ejs', import.meta.url));

const renderNavbar = (overrides = {}) => ejs.renderFile(navbarView, {
  currentPath: '/',
  query: '',
  user: null,
  ...overrides,
});

const personalOrganizationPaths = [
  '/recipes',
  '/recipes/liked',
  '/cookbooks',
  '/meal-plans',
];

test('authenticated navbar omits dashboard Quick Action destinations', async () => {
  const html = await renderNavbar({
    currentPath: '/dashboard',
    user: {
      email: 'cook@example.com',
      user_metadata: { name: 'Test Cook' },
    },
  });

  for (const path of personalOrganizationPaths) {
    assert.doesNotMatch(html, new RegExp(`href="${path}"`));
  }

  assert.match(html, /href="\/"[^>]*>Home<\/a>/);
  assert.match(html, /href="\/browse"[^>]*>Browse<\/a>/);
  assert.match(html, /href="\/dashboard"[^>]*>Dashboard<\/a>/);
  assert.match(html, /action="\/search" method="GET" role="search"/);
  assert.match(html, /Hello, Test Cook/);
  assert.match(html, /href="\/auth\/logout"[^>]*>Logout<\/a>/);
  assert.doesNotMatch(html, /href="\/auth\/(?:login|register)"/);
});

test('guest navbar retains public, search, and authentication controls', async () => {
  const html = await renderNavbar({ currentPath: '/auth/login' });

  assert.match(html, /href="\/"[^>]*>Home<\/a>/);
  assert.match(html, /href="\/browse"[^>]*>Browse<\/a>/);
  assert.match(html, /action="\/search" method="GET" role="search"/);
  assert.match(html, /href="\/auth\/login"[^>]*>Login<\/a>/);
  assert.match(html, /href="\/auth\/register"[^>]*>Sign Up<\/a>/);
  assert.doesNotMatch(html, /href="\/dashboard"/);
  assert.doesNotMatch(html, /href="\/auth\/logout"/);

  for (const path of personalOrganizationPaths) {
    assert.doesNotMatch(html, new RegExp(`href="${path}"`));
  }
});
