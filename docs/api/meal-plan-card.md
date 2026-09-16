# Meal Plan Recipe Card (REW-89)

**Feature:** REW-89 — Standardize Meal Plan Recipe Card Content & Actions
**Component:** `views/partials/recipe-summary-card.ejs`, `views/meal-plans/view.ejs`, `src/routes/mealPlanRoutes.js`
**Last Updated:** 2026-09-15
**Status:** implemented and reviewer-approved (round 1, no blocking issues) on branch `REW-89-standardize-meal-plan-recipe-card`. **The QA stage was deliberately excluded from this run**, and the change is uncommitted in the working tree.

---

## Overview

`views/meal-plans/view.ejs` was the last of the five recipe-card surfaces still hand-rolling its own
card markup: abbreviated `Prep:` / `Cook:` / `4 servings` labels, an unconditional Private/Public
pill, no categories, no tags, no favorite heart, no `+ Cookbook`, no Share, no Edit or Delete — its
only action was Remove.

REW-89 does not add a new card. It teaches the shared card partial a **fifth** surface,
`'meal-plan'`, points the meal plan detail page at it, and widens the route query so the card
actually receives the columns it needs. The partial change is small; the substantive work was in the
data layer.

Two things make this surface different from the four that already existed:

- **`+ Meal Plan` is suppressed** (the recipe is already in a meal plan), while `+ Cookbook` is
  present — the mirror image of the cookbook surface.
- **This is the first genuinely mixed-ownership card surface.** The `meal_plan_recipes` RLS INSERT
  policy (migration `012`) admits your own recipes *or* anyone's published recipe, so a card you do
  not own is a normal production case here, not a hypothetical. Owner-gating of Edit/Delete and the
  owner-only status pill are live protections today rather than future-proofing for REW-100.

---

## The shared partial's local-variable contract

`views/partials/recipe-summary-card.ejs` is now the single card template for five surfaces. This is
the part most likely to bite a future caller, so it is documented in full here. It supersedes the
four-surface table in [Cookbook Recipe Card](cookbook-card.md).

### Locals a caller passes

| Local | Required | Notes |
|-------|----------|-------|
| `recipe` | yes | The recipe row. See "Columns the card reads" below |
| `surface` | no | `'browse'` \| `'my-recipes'` \| `'favorites'` \| `'cookbook'` \| `'meal-plan'`. Read through `typeof`; when omitted it falls back to the legacy boolean `isPublic` (`true` → `'browse'`, otherwise `'my-recipes'`), so the two original callers still work untouched |
| `cookbookId` | no | REW-88. The id of the cookbook being viewed; resolved internally to `cardCookbookId`. Absent → no Remove button |
| `mealPlanId` | no | **New in REW-89.** The id of the meal plan being viewed; resolved internally to `cardMealPlanId`. Absent → no Remove button, rather than a form posting to `/meal-plans//recipes/...` |
| `selectedCategory` / `selectedTags` | no | My Recipes only — round-tripped through the visibility toggle so the post-toggle redirect restores the active filter |
| `user`, `csrfToken` | — | Reach the partial through `res.locals`, not through the include |

EJS throws on an undefined local, so every optional local above is read through `typeof`.

### Flags the partial derives

| Flag | Rule | Effect |
|------|------|--------|
| `isOwner` | `user.id === recipe.user_id` | Presentational only — see Security below |
| `recipeHref` | `/r/:id` on browse, `/recipes/:id` everywhere else | Browse is the only anonymous-safe surface |
| `showFavoriteHeart` | `!isBrowse` | Unchanged by REW-89 — the heart came free on this surface |
| `showStatusPill` | `isBrowse \|\| (isCookbook && isOwner) \|\| (isMealPlan && isOwner)` | **Extended in REW-89** |
| `showOwnerControls` | `isOwner && !isBrowse` | Edit + Delete. Unchanged |
| `showCookbookAdd` | `!isBrowse && !isCookbook` | Unchanged — `+ Cookbook` came free on this surface |
| `showMealPlanAdd` | `!isMealPlan` | **New in REW-89** — this is the ticket's "do not display + Meal Plan" rule |
| `chipsAreLinks` | `isMyRecipes` | Category/tag chips are filter links on My Recipes, plain text elsewhere |
| `showAdaptedFrom` | `!isBrowse` | `Adapted from …` clone attribution (REW-84) |

Only two of these changed, which is the point of the pattern: five of the eight rules already
produced the correct meal-plan behavior with no edit at all.

`showMealPlanAdd` is the only flag that touches the four pre-existing surfaces, and it is
`true` on every one of them, so the `+ Meal Plan` button renders exactly as before on Browse, My
Recipes, My Favorites and Cookbook. `src/views/recipeCard.test.js` asserts exactly one meal-plan
trigger per card on each of those four and exactly zero on this one.

### Per-surface action rows

| Surface | Action row |
|---------|-----------|
| `browse` | `+ Meal Plan` only |
| `my-recipes` | Private/Public toggle, then `+ Meal Plan`, `+ Cookbook`, Share, Edit, Delete |
| `favorites` | `+ Meal Plan`, `+ Cookbook`, Share, and Edit/Delete when owned |
| `cookbook` | `+ Meal Plan`, Share, Remove, Edit, Delete — **no `+ Cookbook`** |
| `meal-plan` | `+ Cookbook`, Share, Remove, Edit, Delete — **no `+ Meal Plan`** |

The meal-plan branch is a fifth `else if` rather than a parameterized merge with the cookbook
branch. The two rows now look structurally similar, but they differ in which add-button is
suppressed, the Remove URL, the confirm copy, and the absence of a `returnTo` field — merging them
would risk regressing REW-88 for no user-visible gain. Any later unification belongs to REW-82.

---

## Card contents on the meal-plan surface (`/meal-plans/:id`)

| Element | Notes |
|---------|-------|
| Thumbnail | Links to `/recipes/:id` when present |
| Title | Clickable link to `/recipes/:id`, escaped |
| Favorite heart | `.like-btn` (REW-21/REW-55), `data-liked` from real batched server state. Disabled with an explanatory title when `status !== 'published'`, because `POST /api/likes/:recipeId` only accepts published recipes |
| Status pill | Read-only `Private` / `Public`, **owner-only**. See "Decisions" below |
| Author | `By {author}`; `Adapted from {original_author}` on clones |
| Categories / tags | Plain badges, not filter links |
| Metadata | `Prep Time:`, `Cook Time:`, `Servings:`, `Difficulty:` — each omitted entirely when empty. Replaces the old `Prep: ` / `Cook: ` / `4 servings` labels |
| `+ Cookbook` | Existing shared modal (REW-86). Rendered for every card, owned or not |
| Share | **Inert placeholder.** `disabled`, `aria-disabled="true"`, `title="Sharing is coming soon"`. No `href`, no handler, no endpoint, no target URL. Real behavior is [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18) |
| Remove | Confirm-guarded form post to `POST /meal-plans/:mealPlanId/recipes/:recipeId/remove`, carrying its hidden `_csrf`. **No `returnTo` field** — that route always redirects to `/meal-plans/:id`, unlike the cookbook equivalent. Rendered only when `mealPlanId` was passed |
| Edit | Owner-only link to `/recipes/:id/edit` |
| Delete | Owner-only confirm-guarded form post to `/recipes/:id/delete` |
| `+ Meal Plan` | **Never rendered on this surface** |

**Control order is deliberate:** `+ Cookbook`, `Share`, `Remove`, `Edit`, `Delete`. Edit physically
separates "take this out of the plan" from "destroy this recipe forever", Delete stays last and
stays the only red control, and the two confirm dialogs read differently ("Remove this recipe from
the meal plan? The recipe itself will not be deleted." vs. "Are you sure you want to delete this
recipe? This action cannot be undone.").

Page furniture on `/meal-plans/:id` is untouched: back link, title, date range, recipe count, the
plan-level `meal-plan-visibility-control`, Add Recipes, Grocery List, Edit, Delete Meal Plan, the
share panel, the empty state, the `organization-card-grid` wrapper, and the
`/js/meal-plan-share.js` tag.

---

## `GET /meal-plans/:id` — widened read (no contract change)

The route's **URL, middleware, auth, response type, and redirect behavior are unchanged.** What
changed is the shape of the data handed to the template.

`GET /:id` was extracted into an exported
`handleMealPlanView(req, res, { createClient } = {})` with an injectable Supabase client factory,
following the `handleMealPlanVisibilityUpdate` precedent in the same file and `handleCookbookView`
in `cookbookRoutes.js`, so the data contract can be unit-tested without a live Supabase. The mounted
route still runs behind `requireAuth`, still validates `:id` against `UUID_PATTERN` before any
query, still scopes the plan read through `getOwnedMealPlan()`, and still passes
`appUrl: getAppUrl()`. A malformed id and a plan the caller does not own produce the same
"Meal plan not found" flash and the same redirect, so existence is never leaked.

### Columns the card reads

`MEAL_PLAN_CARD_COLUMNS` in `src/routes/mealPlanRoutes.js` mirrors `COOKBOOK_CARD_COLUMNS` in
`src/routes/cookbookRoutes.js` and `FAVORITE_CARD_COLUMNS` in `src/routes/index.js` — all three
surfaces render the same partial, so all three must feed it the same shape:

```
id, user_id, title, author, original_author, prep_time, cook_time, servings,
difficulty, thumbnail_url, status, created_at,
recipe_categories(categories(id, name, slug, icon)),
recipe_tags(tags(id, name, slug))
```

Four of these are new to this page: `user_id` (decides whether Edit/Delete are drawn, never
rendered), `original_author` (clone attribution), and the two junction embeds (category and tag
chips). Body fields — instructions, notes — stay off a listing query.

`getMealPlanRecipes(supabaseClient, mealPlanId)` is now exported. It issues **one** query, keeps the
existing defensive drop of a null `recipes` embed (a recipe deleted mid-query, or another owner's
recipe since unpublished), keeps the junction row's `created_at DESC` ordering (added-to-plan order,
newest first), and flattens the embedded junction rows into flat `categories` / `tags` arrays using
the same `?.` + `.filter(Boolean)` mapping as Browse, Favorites and Cookbook. A failed read returns
`[]`.

`getMealPlanRecipeIngredients()` — the grocery-list query (REW-26) — was deliberately **not**
touched. It stays narrow (`id, title, ingredients`), and its skipped-row counting behavior is
unchanged.

### Batched favorite state

The heart needs to know which recipes the caller has already favorited. The handler collects the
recipe ids and issues **one** `recipe_likes` query filtered by `.eq("user_id", req.user.id)` and
`.in("recipe_id", ids)` on the request-scoped client, builds a `Set`, and stamps `isLiked` per
recipe. An empty plan issues no likes query at all. A failure is logged and the page still renders,
with every heart unfavorited — the same degradation the My Recipes and cookbook handlers use.

Net result: one plan read, one recipe read, one likes read, regardless of how many recipes the plan
holds. No N+1.

---

## Security

- **`isOwner` is presentational only.** It decides whether Edit and Delete are *drawn*. Real
  enforcement is unchanged: `POST /recipes/:id/delete` filters `.eq("user_id", req.user.id)` on top
  of owner-only RLS, and `GET /recipes/:id/edit` + `POST /:id/update` enforce ownership
  independently. The card's flag must never become the only check. This matters more here than on
  any previous surface, because non-owned cards are genuinely reachable.
- **Fail closed on missing ownership data.** A recipe row with no `user_id` (a sparse fixture, or a
  surface that does not select the column) is treated as NOT owned.
- **`recipe.user_id` is never rendered.** It is fetched solely to compute the flag; the view tests
  assert a distinctive owner-id string is absent from the HTML for owned, non-owned, and
  missing-owner cards.
- **Remove stays plan-owner-scoped.** `POST /meal-plans/:id/recipes/:recipeId/remove` keeps its
  `requireAuth`, `mealPlanLimiter`, two UUID guards, and plan-ownership check. Moving the form's
  markup into a shared partial changed nothing server-side, and the interpolated `mealPlanId` stays
  on escaped `<%= %>` output.
- **`+ Meal Plan` suppression is a display rule, not a security boundary.**
  `POST /api/meal-plans/:id/recipes/:recipeId` keeps `requireApiAuth`, `mealPlanApiLimiter`, its
  UUID guards, and its own-or-published recipe check whether or not a button is drawn.
- **CSRF.** An owner's card now carries two POST forms (Remove and Delete), each with its own
  `_csrf` hidden field. The tests assert exactly two tokens for an owner and exactly one for a
  non-owner.
- **No middleware was touched.** helmet, CORS, `csrf-csrf`, `express-rate-limit`, and the auth
  middleware are untouched. No new endpoint and no new rate limiter were added; the only route
  change is widening one read and extracting its handler.
- **Share leaks nothing.** It is inert and exposes no URL. It must never link to `/r/:id`, which
  would be wrong and misleading for a Private recipe sitting in a meal plan.
- **The owner-only status pill is not a leak.** It renders only when `isOwner`, so a viewer is never
  shown a status claim about another user's recipe — and since a non-owned recipe can only be in a
  plan if it is published, nothing is withheld that the viewer could not already infer.
- **Output escaping.** All card fields render through `<%= %>`; the tests use hostile title, author
  and tag fixtures to prove no raw `<script>` survives on the new branch.
- **`appUrl` still comes from `getAppUrl()`**, never from the request Host header (REW-57).
- **Pre-existing gap, deliberately not fixed here:** `POST /recipes/:id/delete` has no route-level
  `csrfProtection`, so the global `csrfProtectionExceptMultipart` wrapper's `multipart/form-data`
  skip leaves a forged cross-site multipart POST unchecked. REW-89 adds a Delete button to a fourth
  page. Tracked as [REW-102](https://wanderingnerds.atlassian.net/browse/REW-102).

---

## Database

**No migration.** Every read this card adds is already permitted by applied policies, and the
highest applied migration remains `020`:

| Card needs | Source | Already exists via |
|------------|--------|--------------------|
| `user_id` (owner gating, never rendered) | `recipes` | `001_create_recipes_table.sql` |
| `original_author` ("Adapted from") | `recipes` | `018_add_recipe_clone_provenance.sql` |
| categories | `recipe_categories` → `categories` | `003` / `005`, plus `013` for published rows |
| tags | `recipe_tags` → `tags` | `004` / `006`, plus `013` for published rows |
| favorite state | `recipe_likes` | `008_create_recipe_likes_table.sql` |

This is a **query-widening change only**. The `recipes` RLS SELECT policy already exposes
own-plus-published rows, so selecting `user_id` and `original_author` on a row the caller can
already see grants nothing new. `recipe_likes` is read on the request-scoped (RLS-scoped) client
with an explicit `user_id` filter on top. Remove, Edit, Delete and `+ Cookbook` reuse existing
policies unchanged. No write path was touched.

---

## Decisions and tradeoffs

- **Remove was carried into the shared card, not left beside it.** The ticket never mentions
  Remove, but its last acceptance criterion asks for consistent formatting "while preserving these
  page-specific actions," and REW-88 set the precedent. Dropping it would strand recipes in a plan
  with no way out.
- **The read-only Private/Public pill was kept, gated on `isOwner`.** The ticket is silent on a
  status pill, and the old page showed one on *every* card, including other people's recipes. The
  new rule is owner-only, adopted from REW-88: REW-69 sharing hides Private recipes from the shared
  `/m/:id` view, so the pill is how the owner learns a Private recipe will not appear to the people
  they share the plan with. Showing it for someone else's recipe would be a status claim about a
  row the viewer does not own. **This is a deliberate deviation from the ticket's requirement list
  and is the same item REW-88 flagged for product sign-off.**
- **No Private/Public *toggle* on this surface.** The ticket omits it, and REW-86/87/88 established
  that owners flip visibility from My Recipes.
- **`+ Cookbook` is rendered for every card, owned or not.** Adding a recipe you do not own is still
  rejected server-side until [REW-100](https://wanderingnerds.atlassian.net/browse/REW-100), and the
  failure surfaces as an error toast from `toggleCookbookMembership` in `public/js/cookbooks.js`.
  REW-87 already shipped the same accepted behavior on My Favorites. On this surface the case is far
  more likely to be hit, since non-owned recipes are normal here — worth a product decision about a
  disabled-with-tooltip state if it proves annoying.
- **Chips are static text, not links.** `/recipes?category=` filters *your own* recipes, so
  following one from a non-owned meal-plan entry would land on an unrelated, often empty list.
- **The cookbook and meal-plan action rows were not merged.** See "Per-surface action rows" above.
- **The public shared meal plan `/m/:id` was left alone — a known, intentional scope boundary.**
  It renders the lightweight `views/partials/recipe-card.ejs`, is anonymous and read-only, and
  **still shows a `+ Meal Plan` button**, which is now inconsistent with `/meal-plans/:id`. REW-88
  drew the same line at `views/cookbooks/public-view.ejs`. Standardizing the shared view needs its
  own ticket and its own anonymous-safe surface, not a reuse of `'meal-plan'`. See "Known gaps".
- **No CSS was added.** `recipe-summary-card`, `recipe-summary-actions`, `like-btn`,
  `badge-draft`/`badge-published`, `category-badge`, `tag-badge` and `organization-card-grid` all
  already existed.

---

## Testing notes

Added with this change:

- `src/routes/mealPlanRoutes.test.js` (new, 11 cases) — the select string requests every column the
  card needs and no body fields; categories and tags are flattened and the junction keys are not
  handed to the view; missing links flatten to `[]` rather than `undefined`; a membership row whose
  recipe vanished mid-query is dropped; a failed recipe read yields an empty plan rather than
  throwing; `isLiked` is stamped from one batched, caller-scoped query; an empty plan issues no
  likes query at all; a failed likes query still renders with every heart unfavorited; the page is
  still plan-owner scoped and still passes its share-link locals; and a non-UUID id and a
  non-owned plan are indistinguishable, flashing the same message.
- `src/views/recipeCard.test.js` (updated) — the thin old meal-plan test was replaced by six REW-89
  cases: the owner card with every standardized control plus Remove in the right order; **zero
  `+ Meal Plan` triggers on this surface for any viewer, paired with exactly one `cookbook-add-btn`**;
  the non-owner card keeping Remove but losing Edit, Delete and the pill; the owner-only pill and
  the heart rendering together with Private disabling the heart; no `user_id` leak, unlinked chips,
  a missing `mealPlanId` yielding no Remove, and a sparse recipe degrading cleanly; and a page-level
  render of `views/meal-plans/view.ejs` asserting the standardized metadata replaced
  `Prep:`/`Cook:`/`4 servings` while every piece of page furniture survives, plus the empty state.
- `src/views/mealPlanSharing.test.js` (updated) — the "plan-level control reads as distinct from the
  per-recipe badges" assertion moved from a template-source check to a rendered-output check,
  mirroring exactly what REW-88 did to `src/views/cookbookSharing.test.js`. Strictly stronger, not
  loosened: the per-recipe `Private` pill literal now lives in the partial, so the source-text
  assertion against `views/meal-plans/view.ejs` could no longer prove anything.

Suite result at hand-off: **526 tests, 524 passing, 2 failing.** Both failures are in
`src/csrf.integration.test.js` (`listen EACCES` on `/tmp/*.sock`) — a file untouched by this change,
failing because Windows cannot bind unix-domain sockets. Pre-existing on `main` before this change
and environmental, not a regression; tracked as
[REW-98](https://wanderingnerds.atlassian.net/browse/REW-98). No new failures.

**The QA stage was deliberately excluded from this run.** The pipeline ran
Planner → Developer → Reviewer → Documentation. The reviewer executed the full suite and approved
with no blocking issues, but no dedicated QA pass against the acceptance criteria was performed and
no browser or live-Supabase verification was done. The plan's manual acceptance criteria are
therefore **unverified**: a plan containing your own Public recipe, your own Private recipe and
another user's Public recipe; desktop and mobile widths with the five-control row wrapping rather
than overflowing; the heart toggling and persisting across a reload; `+ Cookbook` opening the modal
and adding; Remove taking the recipe out of the plan without deleting it; and Delete confirming
first. **Do not describe this change as QA-verified.**

---

## Known gaps and follow-ups

- **`/m/:id` vs `/meal-plans/:id` `+ Meal Plan` inconsistency needs a Product decision.** The public
  shared plan view still renders `views/partials/recipe-card.ejs` and still shows a `+ Meal Plan`
  button, which the owner view no longer does. That is arguably correct — a visitor reading someone
  else's shared plan may well want the recipe in *their* plan — but it is an inconsistency that was
  never explicitly decided. Reviewer-flagged, non-blocking.
- **Triplicated card-query code.** `MEAL_PLAN_CARD_COLUMNS`, the categories/tags flatten, and the
  batched-likes block now exist in three near-identical copies across `src/routes/mealPlanRoutes.js`,
  `src/routes/cookbookRoutes.js` and `src/routes/index.js`. The reviewer's suggested extraction is a
  new `src/utils/recipeCardQuery.js` exporting `RECIPE_CARD_COLUMNS`, `flattenRecipeCardRows()` and
  `stampLikeStatus()`. Non-blocking, deliberately not done inside a card-layout ticket.
- **Two vacuous loop entries in `src/views/recipeVisibility.test.js`.** The meal-plans entry (and,
  since REW-88, the cookbooks entry) assert against template *source* for pills that have since
  moved into the shared partial. They still pass — via the plan-level
  `meal-plan-visibility-private` and cookbook-level badges — but no longer prove what their name
  claims. Terminology is still covered by the new `recipeCard.test.js` cases. Reviewer-flagged nit;
  the suggested fix is to add `views/partials/recipe-summary-card.ejs` to that test's file loop.
- **Product sign-off on the owner-only status pill**, carried over from REW-88 — it is not in
  either ticket's acceptance-criteria list.
- **The disabled heart's label is a status claim.** A non-owner viewing a `draft` recipe would get a
  heart labelled "Make this recipe Public to add it to favorites". On cookbooks this was
  unreachable; here it is *nearly* reachable — a plan can hold another user's recipe, though only a
  published one, so the draft branch still cannot be hit by a non-owner today. Folding the
  `isOwner` gate into [REW-100](https://wanderingnerds.atlassian.net/browse/REW-100) remains the
  recommendation.
- **No pagination on the meal plan page.** `getMealPlanRecipes` fetches every row unbounded.
  Pre-existing; a richer card makes a large plan heavier but not broken. Not ticketed.
- [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18) — real Share behavior.
- [REW-82](https://wanderingnerds.atlassian.net/browse/REW-82) — cross-surface card sizing.
- [REW-100](https://wanderingnerds.atlassian.net/browse/REW-100) — adding another user's recipe to a
  cookbook, which is what makes `+ Cookbook` on a non-owned meal-plan card actually work.
- [REW-102](https://wanderingnerds.atlassian.net/browse/REW-102) — route-level `csrfProtection` on
  `POST /recipes/:id/delete`.

---

## Related documentation

- [API Overview](README.md)
- [Meal Plans API](meal-plans.md) — the `/meal-plans*` routes, the own-or-published membership rule,
  and the public `/m/:id` surface
- [Cookbook Recipe Card](cookbook-card.md) — the REW-88 surface this one extends
- [My Recipes Recipe Card](my-recipes-card.md) — the REW-86 owner surface of the same partial
- [Browse Recipes](browse-recipes.md) — the public surface of the same partial
- [Recipe Likes API](recipe-likes.md) — the favorite heart and its published-only restriction
- Plan: `docs/plans/rew-89-standardize-meal-plan-recipe-card.md`
- Release notes: `docs/RELEASE_NOTES_REW-89.md`
