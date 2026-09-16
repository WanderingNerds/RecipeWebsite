import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const views = fileURLToPath(new URL("../../views/", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));

const recipe = {
  id: "recipe-1",
  title: "Long <title>",
  author: "Chef <script>",
  prep_time: "10 minutes",
  cook_time: "30 minutes",
  servings: "4",
  difficulty: "Easy",
  thumbnail_url: "/image.jpg",
  created_at: "2026-01-01T12:00:00Z",
};

const cookbook = { id: "cookbook-1", title: "Weeknight <Favorites>", created_at: "2026-01-01T12:00:00Z" };

const renderPublicView = (recipes, user = null) =>
  ejs.renderFile(`${views}cookbooks/public-view.ejs`, { cookbook, recipes, user });

// ---------------------------------------------------------------------------
// views/cookbooks/public-view.ejs -- the shared cookbook page
// ---------------------------------------------------------------------------

test("shared cookbook page is read-only for guests, other users and the owner alike", async () => {
  // There is deliberately no isOwner local, so the same template output must
  // hold for every viewer -- including the owner opening their own link.
  for (const user of [null, { id: "owner" }, { id: "someone-else" }]) {
    const html = await renderPublicView([recipe], user);

    assert.doesNotMatch(html, /\/edit|\/delete|\/add-recipes|\/remove|\/visibility/);
    assert.doesNotMatch(html, /<form/);
    assert.doesNotMatch(html, /_csrf/);
    assert.doesNotMatch(html, /Rename|Delete Cookbook|Add Recipes|>Remove</);
    // Cards must point at the public recipe route, never the owner route
    assert.match(html, /href="\/r\/recipe-1"/);
    assert.doesNotMatch(html, /href="\/recipes\/recipe-1"/);
  }
});

test("shared cookbook page renders the title and card metadata escaped", async () => {
  const html = await renderPublicView([recipe]);
  assert.match(html, /Weeknight &lt;Favorites&gt;/);
  assert.match(html, /Long &lt;title&gt;/);
  assert.match(html, /@Chef &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert|undefined|null/);
  assert.match(html, /class="recipe-card"/);
  assert.match(html, /1 recipe(?!s)/);
});

test("an all-Private cookbook renders a neutral empty state that hides nothing suspicious", async () => {
  const html = await renderPublicView([]);
  assert.match(html, /doesn&rsquo;t have any Public recipes yet/);
  assert.match(html, /0 recipes/);
  // Must not hint that hidden recipes exist
  assert.doesNotMatch(html, /hidden|private recipe|draft|not shown|[1-9]\d* recipes? hidden/i);
  assert.doesNotMatch(html, /class="recipe-card"/);
});

test("shared cookbook page uses the shared organization grid contract", async () => {
  const template = await readFile(`${views}cookbooks/public-view.ejs`, "utf8");
  assert.match(template, /class="organization-card-grid"/);
  assert.doesNotMatch(template, /class="recipe-grid(?:-fill)?"/);
});

test("the shared cookbook template never constructs an owner-scoped surface", async () => {
  // Strip EJS comments, which legitimately explain why there is no isOwner branch
  const template = (await readFile(`${views}cookbooks/public-view.ejs`, "utf8"))
    .replace(/<%#[\s\S]*?%>/g, "");
  assert.doesNotMatch(template, /isOwner|accessToken|csrfToken/);
});

// ---------------------------------------------------------------------------
// views/cookbooks/view.ejs -- owner visibility control + share link
// ---------------------------------------------------------------------------

const renderOwnerView = (locals) =>
  ejs.renderFile(`${views}cookbooks/view.ejs`, {
    cookbook: { id: "cookbook-1", title: "Weeknight Favorites" },
    recipes: [],
    user: { id: "owner" },
    csrfToken: "csrf-test",
    ...locals,
  });

test("visibility control posts private|public with a real CSRF token", async () => {
  const priv = await renderOwnerView({});
  assert.match(priv, /action="\/cookbooks\/cookbook-1\/visibility" method="POST"/);
  assert.match(priv, /name="_csrf" value="csrf-test"/);
  // A Private cookbook offers the Public switch, and vice versa
  assert.match(priv, /name="visibility" value="public"/);
  assert.doesNotMatch(priv, /name="visibility" value="private"/);
  assert.match(priv, />Make Public</);

  const pub = await renderOwnerView({
    cookbook: { id: "cookbook-1", title: "Weeknight Favorites", is_public: true },
    appUrl: "https://recipes.example.com",
  });
  assert.match(pub, /name="visibility" value="private"/);
  assert.doesNotMatch(pub, /name="visibility" value="public"/);
  assert.match(pub, />Make Private</);
});

test("the share link is shown only while Public and is built from appUrl", async () => {
  const priv = await renderOwnerView({ appUrl: "https://recipes.example.com" });
  assert.doesNotMatch(priv, /\/c\/cookbook-1/);
  assert.doesNotMatch(priv, /cookbook-share-panel/);

  const pub = await renderOwnerView({
    cookbook: { id: "cookbook-1", title: "Weeknight Favorites", is_public: true },
    appUrl: "https://recipes.example.com",
  });
  assert.match(pub, /value="https:\/\/recipes\.example\.com\/c\/cookbook-1"/);
  assert.match(pub, /readonly/);
  assert.match(pub, />Copy link</);
});

test("the owner view survives callers that omit the new locals", async () => {
  // recipeCard.test.js renders this template with only cookbook/recipes/user/
  // csrfToken; a mandatory new local would break it.
  const html = await renderOwnerView({});
  assert.match(html, /Weeknight Favorites/);
  const withoutAppUrl = await renderOwnerView({
    cookbook: { id: "cookbook-1", title: "Weeknight Favorites", is_public: true },
  });
  assert.doesNotMatch(withoutAppUrl, /cookbook-share-panel|undefined/);
});

test("the cookbook-level control reads as distinct from the per-recipe badges", async () => {
  // REW-88 moved the per-recipe pill out of this template and into the shared
  // recipe-summary-card partial, so the assertion moved from the template
  // SOURCE to rendered OUTPUT. What it proves is unchanged -- and output is
  // the stronger check, because it now covers both templates at once.
  const html = await renderOwnerView({
    recipes: [{ ...recipe, user_id: "owner", status: "draft" }],
  });

  // Per-recipe pills keep their own classes; the cookbook control does not
  // reuse them, so "this cookbook is Public" cannot be confused for
  // "this recipe is Public".
  assert.match(html, /class="badge-draft badge-draft-sm">Private</);
  assert.match(html, /class="cookbook-visibility-badge cookbook-visibility-private">Private</);
  const cookbookControl = html.match(/<form class="cookbook-visibility-control"[\s\S]*?<\/form>/)[0];
  assert.doesNotMatch(cookbookControl, /badge-draft|badge-published/);
  assert.doesNotMatch(html, />Draft<\/span>|>Published<\/span>/);
});

test("copy-link behavior ships as an external script, satisfying scriptSrc 'self'", async () => {
  const template = await readFile(`${views}cookbooks/view.ejs`, "utf8");
  assert.match(template, /<script src="\/js\/cookbook-share\.js"><\/script>/);
  assert.doesNotMatch(template, /onclick=|<script>[^<]/);

  const client = await readFile(`${root}public/js/cookbook-share.js`, "utf8");
  assert.match(client, /navigator\.clipboard/);
  // Graceful fallback when the Clipboard API is missing or blocked
  assert.match(client, /typeof navigator\.clipboard\.writeText !== 'function'/);
  assert.match(client, /\.select\(\)/);
});

// ---------------------------------------------------------------------------
// views/cookbooks/index.ejs -- Public marker
// ---------------------------------------------------------------------------

test("only shared cookbooks are marked Public on the list page", async () => {
  const html = await ejs.renderFile(`${views}cookbooks/index.ejs`, {
    cookbooks: [
      { id: "cb-public", title: "Shared", recipeCount: 1, created_at: "2026-01-01T12:00:00Z", is_public: true },
      { id: "cb-private", title: "Mine", recipeCount: 2, created_at: "2026-01-01T12:00:00Z", is_public: false },
      { id: "cb-legacy", title: "Legacy", recipeCount: 0, created_at: "2026-01-01T12:00:00Z" },
    ],
  });
  assert.equal((html.match(/cookbook-visibility-public">Public</g) || []).length, 1);
  assert.doesNotMatch(html, /undefined/);
});

// ---------------------------------------------------------------------------
// views/recipes/search.ejs -- Cookbooks results section
// ---------------------------------------------------------------------------

const searchLocals = (overrides = {}) => ({
  query: "week",
  recipes: [recipe],
  user: null,
  totalCount: 1,
  page: 1,
  totalPages: 1,
  ...overrides,
});

test("cookbook results render as a secondary section linking to /c/:id", async () => {
  const html = await ejs.renderFile(`${views}recipes/search.ejs`, searchLocals({
    cookbooks: [{ id: "cb-1", title: "Weeknight <Favorites>", recipe_count: 3 }],
  }));
  assert.match(html, /class="cookbook-result-section"/);
  assert.match(html, /href="\/c\/cb-1"/);
  assert.match(html, /Weeknight &lt;Favorites&gt;/);
  assert.match(html, /3 recipes/);
  // Recipe results stay primary and unchanged
  assert.match(html, /class="recipe-grid"/);
  assert.ok(html.indexOf('class="recipe-grid"') < html.indexOf("cookbook-result-section"));
  // Contract pinned by recipeCard.test.js
  assert.doesNotMatch(html, /recipe-summary-card|Prep:|Cook:|Created|tag-badge/);
});

test("matching cookbooks with zero matching recipes avoid a dead-end no-results page", async () => {
  const html = await ejs.renderFile(`${views}recipes/search.ejs`, searchLocals({
    recipes: [],
    totalCount: 0,
    totalPages: 0,
    cookbooks: [{ id: "cb-1", title: "Weeknight", recipe_count: 1 }],
  }));
  assert.match(html, /href="\/c\/cb-1"/);
  assert.doesNotMatch(html, /<h3>No recipes match/);
});

test("search degrades to its existing behavior with no cookbooks local at all", async () => {
  const withoutLocal = await ejs.renderFile(`${views}recipes/search.ejs`, searchLocals());
  assert.doesNotMatch(withoutLocal, /cookbook-result-section|undefined/);

  const emptyResults = await ejs.renderFile(`${views}recipes/search.ejs`, searchLocals({
    recipes: [], totalCount: 0, totalPages: 0, cookbooks: [],
  }));
  assert.match(emptyResults, /<h3>No recipes match/);
  assert.doesNotMatch(emptyResults, /cookbook-result-section/);

  const emptyQuery = await ejs.renderFile(`${views}recipes/search.ejs`, searchLocals({
    query: "", recipes: [], totalCount: 0, totalPages: 0, cookbooks: [{ id: "cb-1", title: "Weeknight", recipe_count: 1 }],
  }));
  assert.match(emptyQuery, /What are you in the mood for\?/);
  assert.doesNotMatch(emptyQuery, /cookbook-result-section/);
});
