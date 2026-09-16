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

const mealPlan = {
  id: "meal-plan-1",
  title: "Week of <Sept 20>",
  start_date: "2026-09-20",
  end_date: "2026-09-26",
};

const renderPublicView = (recipes, user = null) =>
  ejs.renderFile(`${views}meal-plans/public-view.ejs`, { mealPlan, recipes, user });

// ---------------------------------------------------------------------------
// views/meal-plans/public-view.ejs -- the shared meal plan page
// ---------------------------------------------------------------------------

test("shared meal plan page is read-only for guests, other users and the owner alike", async () => {
  // There is deliberately no isOwner local, so the same template output must
  // hold for every viewer -- including the owner opening their own link.
  for (const user of [null, { id: "owner" }, { id: "someone-else" }]) {
    const html = await renderPublicView([recipe], user);

    assert.doesNotMatch(html, /\/edit|\/delete|\/add-recipes|\/remove|\/visibility|\/grocery-list/);
    assert.doesNotMatch(html, /<form/);
    assert.doesNotMatch(html, /_csrf/);
    assert.doesNotMatch(html, /Add Recipes|Grocery List|Delete Meal Plan|>Remove</);
    // Cards must point at the public recipe route, never the owner route
    assert.match(html, /href="\/r\/recipe-1"/);
    assert.doesNotMatch(html, /href="\/recipes\/recipe-1"/);
  }
});

test("shared meal plan page renders the title, date range and card metadata escaped", async () => {
  const html = await renderPublicView([recipe]);
  assert.match(html, /Week of &lt;Sept 20&gt;/);
  assert.match(html, /Long &lt;title&gt;/);
  assert.match(html, /@Chef &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert|undefined|null/);
  assert.match(html, /class="recipe-card"/);
  assert.match(html, /1 recipe(?!s)/);

  // The date range must be formatted exactly as the owner view formats it, so
  // owner and visitor see the same thing (and neither drifts a day).
  const expected = [mealPlan.start_date, mealPlan.end_date].map((d) =>
    new Date(`${d}T00:00:00`).toLocaleDateString()
  );
  for (const formatted of expected) {
    assert.ok(html.includes(formatted), `date range should contain ${formatted}`);
  }
  assert.match(html, /meal-plan-visibility-badge meal-plan-visibility-public">Shared meal plan</);
});

test("an all-Private meal plan renders a neutral empty state that hides nothing suspicious", async () => {
  const html = await renderPublicView([]);
  assert.match(html, /doesn&rsquo;t include any Public recipes yet/);
  assert.match(html, /0 recipes/);
  // Must not hint that hidden recipes exist
  assert.doesNotMatch(html, /hidden|private recipe|draft|not shown|[1-9]\d* recipes? hidden/i);
  assert.doesNotMatch(html, /class="recipe-card"/);
});

test("shared meal plan page uses the shared organization grid contract", async () => {
  const template = await readFile(`${views}meal-plans/public-view.ejs`, "utf8");
  assert.match(template, /class="organization-card-grid"/);
  assert.doesNotMatch(template, /class="recipe-grid(?:-fill)?"/);
});

test("the shared meal plan template never constructs an owner-scoped surface", async () => {
  // Strip EJS comments, which legitimately explain why there is no isOwner branch
  const template = (await readFile(`${views}meal-plans/public-view.ejs`, "utf8"))
    .replace(/<%#[\s\S]*?%>/g, "");
  assert.doesNotMatch(template, /isOwner|accessToken|csrfToken/);
});

// ---------------------------------------------------------------------------
// views/meal-plans/view.ejs -- owner visibility control + share link
// ---------------------------------------------------------------------------

const ownerPlan = {
  id: "meal-plan-1",
  title: "Week of Sept 20",
  start_date: "2026-09-20",
  end_date: "2026-09-26",
};

const renderOwnerView = (locals) =>
  ejs.renderFile(`${views}meal-plans/view.ejs`, {
    mealPlan: ownerPlan,
    recipes: [],
    user: { id: "owner" },
    csrfToken: "csrf-test",
    ...locals,
  });

test("visibility control posts private|public with a real CSRF token", async () => {
  const priv = await renderOwnerView({});
  assert.match(priv, /action="\/meal-plans\/meal-plan-1\/visibility" method="POST"/);
  assert.match(priv, /name="_csrf" value="csrf-test"/);
  // A Private meal plan offers the Public switch, and vice versa
  assert.match(priv, /name="visibility" value="public"/);
  assert.doesNotMatch(priv, /name="visibility" value="private"/);
  assert.match(priv, />Make Public</);

  const pub = await renderOwnerView({
    mealPlan: { ...ownerPlan, is_public: true },
    appUrl: "https://recipes.example.com",
  });
  assert.match(pub, /name="visibility" value="private"/);
  assert.doesNotMatch(pub, /name="visibility" value="public"/);
  assert.match(pub, />Make Private</);
});

test("the share link is shown only while Public and is built from appUrl", async () => {
  const priv = await renderOwnerView({ appUrl: "https://recipes.example.com" });
  assert.doesNotMatch(priv, /\/m\/meal-plan-1/);
  assert.doesNotMatch(priv, /meal-plan-share-panel/);

  const pub = await renderOwnerView({
    mealPlan: { ...ownerPlan, is_public: true },
    appUrl: "https://recipes.example.com",
  });
  assert.match(pub, /value="https:\/\/recipes\.example\.com\/m\/meal-plan-1"/);
  assert.match(pub, /readonly/);
  assert.match(pub, />Copy link</);
});

test("the owner view survives callers that omit the new locals", async () => {
  // recipeCard.test.js and groceryList.test.js render this template with only
  // mealPlan/recipes/user/csrfToken; a mandatory new local would break them.
  const html = await renderOwnerView({});
  assert.match(html, /Week of Sept 20/);
  assert.doesNotMatch(html, /undefined/);

  const withoutAppUrl = await renderOwnerView({
    mealPlan: { ...ownerPlan, is_public: true },
  });
  assert.doesNotMatch(withoutAppUrl, /meal-plan-share-panel|undefined/);
});

test("the plan-level control reads as distinct from the per-recipe badges", async () => {
  // REW-89 moved the per-recipe pill out of this template and into the shared
  // recipe-summary-card partial, so the assertion moved from the template
  // SOURCE to rendered OUTPUT. What it proves is unchanged -- and output is
  // the stronger check, because it now covers both templates at once. The
  // recipe has to be one the viewer owns: the pill is owner-only now.
  const html = await renderOwnerView({
    recipes: [{ ...recipe, user_id: "owner", status: "draft" }],
  });

  // Per-recipe pills keep their own classes; the plan control does not reuse
  // them, so "this MEAL PLAN is Public" cannot be confused for
  // "this recipe is Public".
  assert.match(html, /class="badge-draft badge-draft-sm">Private</);
  assert.match(html, /class="meal-plan-visibility-badge meal-plan-visibility-private">Private</);
  const mealPlanControl = html.match(/<form class="meal-plan-visibility-control"[\s\S]*?<\/form>/)[0];
  assert.doesNotMatch(mealPlanControl, /badge-draft|badge-published/);
  assert.doesNotMatch(html, />Draft<\/span>|>Published<\/span>/);
});

test("copy-link behavior ships as an external script, satisfying scriptSrc 'self'", async () => {
  const template = await readFile(`${views}meal-plans/view.ejs`, "utf8");
  assert.match(template, /<script src="\/js\/meal-plan-share\.js"><\/script>/);
  assert.doesNotMatch(template, /onclick=|<script>[^<]/);

  const client = await readFile(`${root}public/js/meal-plan-share.js`, "utf8");
  assert.match(client, /navigator\.clipboard/);
  // Graceful fallback when the Clipboard API is missing or blocked
  assert.match(client, /typeof navigator\.clipboard\.writeText !== 'function'/);
  assert.match(client, /\.select\(\)/);
});

// ---------------------------------------------------------------------------
// views/meal-plans/index.ejs -- Public marker
// ---------------------------------------------------------------------------

test("only shared meal plans are marked Public on the list page", async () => {
  const html = await ejs.renderFile(`${views}meal-plans/index.ejs`, {
    mealPlans: [
      { id: "mp-public", title: "Shared", recipeCount: 1, start_date: "2026-09-20", end_date: "2026-09-26", is_public: true },
      { id: "mp-private", title: "Mine", recipeCount: 2, start_date: "2026-09-20", end_date: "2026-09-26", is_public: false },
      { id: "mp-legacy", title: "Legacy", recipeCount: 0, start_date: "2026-09-20", end_date: "2026-09-26" },
    ],
  });
  assert.equal((html.match(/meal-plan-visibility-public">Public</g) || []).length, 1);
  assert.doesNotMatch(html, /undefined/);
});
