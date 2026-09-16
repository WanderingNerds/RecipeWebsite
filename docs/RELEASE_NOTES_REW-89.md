# Release Notes: REW-89 - Standardize Meal Plan Recipe Card Content & Actions

**Date:** 2026-09-15
**Jira:** [REW-89](https://wanderingnerds.atlassian.net/browse/REW-89) (parent epic [REW-2](https://wanderingnerds.atlassian.net/browse/REW-2))
**Branch:** `REW-89-standardize-meal-plan-recipe-card`
**Status:** implemented and reviewer-approved (round 1, no blocking issues). **The QA stage was deliberately excluded from this run** — see "Validation" below. The change is uncommitted in the working tree.

## Summary

Recipe cards inside a meal plan (`/meal-plans/:id`) now look and behave like every other
standardized card on the site. The page used to hand-roll its own card with `Prep:` / `Cook:` /
`4 servings` labels, no difficulty, no categories, no tags, no favorite heart, no `+ Cookbook`, no
Share, and no Edit or Delete — its only action was Remove.

This is not a new card. REW-86, REW-87 and REW-88 already built every control the ticket asks for
inside `views/partials/recipe-summary-card.ejs`, so REW-89 teaches that shared partial a fifth
surface (`'meal-plan'`), points the meal plan page at it, and widens the route query so the card
receives the columns it needs. This completes the card-standardization series across all five
authenticated recipe-card surfaces.

Two things make this surface different. `+ Meal Plan` is suppressed — the recipe is already in a
meal plan — while `+ Cookbook` is present, the mirror image of the cookbook surface. And this is the
**first genuinely mixed-ownership card surface**: the `meal_plan_recipes` RLS INSERT policy
(migration `012`) admits your own recipes *or* anyone's published recipe, so a card you do not own
is a normal production case here rather than a hypothetical.

## User impact

- A meal plan card now shows: thumbnail, clickable title, favorite heart, author, `Adapted from`
  attribution on clones, category and tag chips, and `Prep Time:` / `Cook Time:` / `Servings:` /
  `Difficulty:` metadata in the same format as Browse, My Recipes, My Favorites and Cookbook. Empty
  fields render no stray label — no `undefined`, no `null`.
- Actions on the card: `+ Cookbook`, Share, Remove, and — only for a recipe the viewer owns — Edit
  and Delete.
- **`+ Meal Plan` is deliberately absent.** The recipe is already in a meal plan.
- **Remove is unchanged in behavior.** It still removes only the plan membership, never the recipe,
  still returns to the plan page, and still has its own distinct confirm wording ("Remove this
  recipe from the meal plan? The recipe itself will not be deleted."). Edit sits between Remove and
  Delete so "take this out of the plan" and "delete this recipe forever" are never adjacent taps,
  and Delete stays last and stays the only red control.
- **Edit and Delete are owner-gated, and that now matters in production.** A plan can genuinely
  contain another user's published recipe; those cards show the title, heart, chips, metadata,
  `+ Cookbook`, Share and Remove, but no Edit, no Delete and no status pill.
- **The Private/Public pill is now owner-only.** It used to render on every card, including other
  people's recipes. For the owner it is unchanged in purpose: it is the only place the owner is told
  that a Private recipe will not appear to the people they share the plan with (REW-69).
- **The favorite heart is disabled on a Private recipe**, with its explanatory title, because
  favoriting requires a published recipe.
- **Share is visible but inert.** No navigation, no request, no URL exposed. Real sharing is
  [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18).
- Every piece of page furniture is unchanged: back link, title, date range, recipe count, plan-level
  Public/Private control, Add Recipes, Grocery List, Edit, Delete Meal Plan, share panel, empty
  state, and the card grid.
- Browse, My Recipes, My Favorites and Cookbook cards are unchanged, and the grocery-list flow is
  untouched.
- **The public shared meal plan `/m/:id` is unchanged**, by design — see "Decisions" below.

## Technical impact

- **`views/partials/recipe-summary-card.ejs`** — added the fifth `surface` value, `'meal-plan'`.
  Only two flags changed:
  - `showMealPlanAdd = !isMealPlan` (**new**) — the ticket's "do not display + Meal Plan" rule. It
    is `true` on all four pre-existing surfaces, so their `+ Meal Plan` buttons render exactly as
    before.
  - `showStatusPill = isBrowse || (isCookbook && isOwner) || (isMealPlan && isOwner)` (**extended**).

  Everything else — the favorite heart, `+ Cookbook`, owner-gated Edit/Delete, `Adapted from`,
  plain-text chips, and the `/recipes/:id` title link — fell out of flags that already existed with
  no edit at all. That is the point of the pattern. Also added: a new optional `mealPlanId` local
  (read through `typeof`, resolved internally to `cardMealPlanId`) and a fifth
  `else if (isMealPlan)` action-row branch.
- **The cookbook and meal-plan action rows were deliberately not merged** into one parameterized
  branch. They differ in which add-button is suppressed, the Remove URL, the confirm copy, and the
  absence of a `returnTo` field; merging them would risk regressing REW-88 for no user-visible gain.
  Unification belongs to REW-82.
- **`views/meal-plans/view.ejs`** — the inline card block is gone, replaced by an include passing
  `recipe`, `surface: 'meal-plan'`, and `mealPlanId: mealPlan.id`. `user` and `csrfToken` continue
  to reach the partial through `res.locals`.
- **`src/routes/mealPlanRoutes.js`** — a new `MEAL_PLAN_CARD_COLUMNS` widens the nested
  `recipes(...)` select with `user_id`, `original_author`, and the embedded
  `recipe_categories(categories(...))` / `recipe_tags(tags(...))` relations, mirroring
  `COOKBOOK_CARD_COLUMNS`. `getMealPlanRecipes` is now exported and flattens the junction rows into
  flat `categories` / `tags`, keeping its defensive drop of a null `recipes` embed and its
  added-to-plan ordering. `GET /:id` was extracted into an exported
  `handleMealPlanView(req, res, { createClient } = {})` with an injectable client so the data
  contract is testable without a live Supabase; it stamps `isLiked` from a single batched
  `recipe_likes` query scoped to `req.user.id`, and issues no likes query at all for an empty plan.
  A likes error is logged and the page still renders with hearts unfavorited.
- **The grocery-list query was not touched.** `getMealPlanRecipeIngredients()` stays narrow
  (`id, title, ingredients`) and keeps its REW-26 skipped-row counting behavior.
- **No N+1.** One plan read, one recipe read, one likes read, regardless of plan size.
- **No new endpoint, no new rate limiter, no middleware change.** helmet, CORS, `csrf-csrf`,
  `express-rate-limit`, and the auth middleware are untouched. `GET /meal-plans/:id` still runs
  behind `requireAuth` after the handler extraction, and every mutation handler, limiter and UUID
  guard is unchanged.
- **No CSS and no client-side JavaScript were added.** `likes.js`, `cookbooks.js` and
  `meal-plans.js` are already loaded globally from `views/layouts/main.ejs`, and every class the new
  branch uses already existed.

## Database changes

**None.** No migration, no backfill, no policy change, no new index, no grant change. The highest
applied migration remains `020`.

Every column the widened select adds is already readable under applied policies: migration `001`
(own rows plus any published row, all columns), `018` (`original_author`), `005`/`006` (owner SELECT
on the junction tables, which is what makes chips readable on the owner's Private recipes), and
`013` (published-recipe SELECT for `anon`/`authenticated` plus the matching `categories`/`tags`
lookups). Both halves of the junction access are needed on this page and both already exist.
`recipe_likes` (migration `008`) is read on the request-scoped, RLS-scoped client with an explicit
`user_id` filter on top. No write path was touched.

## API changes

**None that break a client.** No route was added, removed or renamed, and no JSON response shape
changed.

- `GET /meal-plans/:id` — same URL, same middleware, same auth, same redirects, same
  "Meal plan not found" behavior for a malformed id and for a plan the caller does not own. Only the
  shape of the data handed to the template changed: more recipe columns, flattened
  `categories`/`tags`, and a new `isLiked` flag per recipe.
- The **shared card partial's local-variable contract** did change and is the most
  documentation-worthy surface here: `surface` now takes five values, and there is a new optional
  `mealPlanId` local. Documented in full in `docs/api/meal-plan-card.md`, which supersedes the
  four-surface table in `docs/api/cookbook-card.md`.

## Decisions and tradeoffs

- **Remove was carried into the shared card, not left beside it.** The ticket never mentions Remove,
  but its last acceptance criterion asks for consistent formatting "while preserving these
  page-specific actions," and REW-88 set the precedent. Dropping it would strand recipes in a plan.
  It renders only when `mealPlanId` is supplied, so a caller that forgets it degrades to a missing
  button rather than a form posting to `/meal-plans//recipes/...`.
- **The Private/Public pill became owner-only** — a behavior change from the old page, which showed
  it on every card. The ticket is silent on a status pill at all, so this is a deliberate deviation
  from its requirement list, adopted from REW-88: REW-69 sharing hides Private recipes from `/m/:id`,
  so the pill is how the owner learns that, and a viewer should never be shown a status claim about
  somebody else's recipe. Same product sign-off REW-88 asked for still applies.
- **No Private/Public toggle on this surface.** The ticket omits it, and REW-86/87/88 established
  that owners flip visibility from My Recipes.
- **`+ Cookbook` is rendered for every card, owned or not.** Adding a recipe you do not own is still
  rejected server-side until [REW-100](https://wanderingnerds.atlassian.net/browse/REW-100), and the
  failure already surfaces as an error toast. REW-87 shipped the same accepted behavior on My
  Favorites — but this is the surface where a user is most likely to hit it, since non-owned recipes
  are normal here. Worth a product decision about a disabled-with-tooltip state.
- **Chips are static text, not links**, because `/recipes?category=` filters *your own* recipes.
- **The public `/m/:id` view was left alone — a known, intentional scope boundary.** It renders the
  lightweight `recipe-card.ejs` partial, is anonymous and read-only, and **still shows a
  `+ Meal Plan` button**, which is now inconsistent with the owner view. REW-88 drew the same line
  at `views/cookbooks/public-view.ejs`. Standardizing the shared view needs its own ticket and its
  own anonymous-safe surface. Flagged for Product below.

## Validation

- `npm test`: **526 tests, 524 passing, 2 failing.** Both failures are in
  `src/csrf.integration.test.js` (`listen EACCES` on `/tmp/*.sock`) — a file untouched by this
  change, failing because Windows cannot bind unix-domain sockets. Pre-existing on `main` before
  this change and environmental, not a regression; tracked as
  [REW-98](https://wanderingnerds.atlassian.net/browse/REW-98). **No new failures.**
- Code review: **approved on round 1, no blocking issues**, so no bug tickets were filed. Three
  non-blocking follow-ups were recorded rather than implemented — see "Follow-ups".
- New coverage: `src/routes/mealPlanRoutes.test.js` (11 cases). Updated:
  `src/views/recipeCard.test.js` (six REW-89 cases, including zero `+ Meal Plan` on this surface and
  exactly one on each of the other four) and `src/views/mealPlanSharing.test.js` (one assertion
  migrated from template source to rendered output, mirroring what REW-88 did to
  `cookbookSharing.test.js` — strengthened, not loosened).

**The QA stage was deliberately excluded from this run.** The pipeline ran
Planner → Developer → Reviewer → Documentation, with no QA stage. The reviewer executed the full
`npm test` suite and confirmed no new failures, but **no dedicated QA pass against the acceptance
criteria was performed**, and the browser/manual verification described in the plan has **not** been
done. Specifically unverified: a plan containing your own Public recipe, your own Private recipe and
another user's Public recipe; desktop and mobile widths with the five-control action row wrapping
rather than overflowing; the heart toggling and persisting across a reload; `+ Cookbook` opening the
modal and adding; Remove leaving the recipe intact; Delete confirming first; and keyboard
reachability and focus visibility. **Do not describe this change as QA-verified.**

## Deployment

Standard application deployment. **No migration to run, no new environment variable, no new package,
and no Vercel configuration change.** Nothing about the deploy differs from an ordinary code change.

**Before merge:** load a real meal plan against a live Supabase — ideally one containing another
user's published recipe, which is the case no previous card surface could produce. `getMealPlanRecipes`
uses the same three-level PostgREST embed REW-88 introduced (`meal_plan_recipes` → `recipes` →
`recipe_categories` → `categories`) and returns `[]` on error, which renders as "No recipes in this
meal plan yet" with no flash — a silent failure mode. That smoke test is still outstanding for
REW-88 as well.

## Follow-ups

Recorded, deliberately not implemented in this ticket:

1. **Triplicated card-query code.** `MEAL_PLAN_CARD_COLUMNS`, the categories/tags flatten, and the
   batched-likes block now exist in three near-identical copies across
   `src/routes/mealPlanRoutes.js`, `src/routes/cookbookRoutes.js` and `src/routes/index.js`. The
   reviewer's suggested extraction is a new `src/utils/recipeCardQuery.js` exporting
   `RECIPE_CARD_COLUMNS`, `flattenRecipeCardRows()` and `stampLikeStatus()`. Needs its own ticket.
2. **Two vacuous loop entries in `src/views/recipeVisibility.test.js`.** The meal-plans entry — and,
   since REW-88, the cookbooks entry — assert against template *source* for pills that have moved
   into the shared partial. They still pass via the page-level visibility badges, but no longer
   prove what their names claim. Suggested fix: add `views/partials/recipe-summary-card.ejs` to that
   test's file loop.
3. **`/m/:id` vs `/meal-plans/:id` `+ Meal Plan` inconsistency needs a Product decision.** The public
   shared plan still offers `+ Meal Plan`; the owner view no longer does. Arguably correct, but never
   explicitly decided.

Carried forward from earlier tickets in the series:

- **Product sign-off on the owner-only status pill**, which is in neither REW-88's nor REW-89's
  acceptance criteria.
- [REW-100](https://wanderingnerds.atlassian.net/browse/REW-100) — adding another user's recipe to a
  cookbook, which is what makes `+ Cookbook` on a non-owned meal-plan card actually work. The
  disabled heart's "Make this recipe Public to add it to favorites" label is a status claim and
  should be gated on `isOwner` as part of that ticket.
- [REW-102](https://wanderingnerds.atlassian.net/browse/REW-102) — route-level `csrfProtection` on
  `POST /recipes/:id/delete`, now reachable from a fourth page.
- [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18) — real Share behavior.
- [REW-82](https://wanderingnerds.atlassian.net/browse/REW-82) — cross-surface card sizing; the
  action row now carries five `flex: 1` controls on two surfaces and is worth an eyeball at 375px.
- [REW-98](https://wanderingnerds.atlassian.net/browse/REW-98) — the two Windows unix-socket test
  failures.

## Related documentation

- [Meal Plan Recipe Card](api/meal-plan-card.md)
- [Meal Plans API](api/meal-plans.md)
- [Cookbook Recipe Card](api/cookbook-card.md)
- [My Recipes Recipe Card](api/my-recipes-card.md)
- [API Overview](api/README.md)
- [Database notes](../database/README.md)
- Implementation plan: `docs/plans/rew-89-standardize-meal-plan-recipe-card.md`
