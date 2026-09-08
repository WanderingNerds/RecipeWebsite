# Release Notes: REW-63 - Create and Manage Meal Plans

**Date:** 2026-09-08
**Jira Issue:** [REW-63](https://wanderingnerds.atlassian.net/browse/REW-63) (Story, Priority: High)
**Branch:** `REW-63-create-and-manage-meal-plans`
**Pipeline:** Planner → Developer → Reviewer (Approved, no blocking issues). **QA was explicitly skipped for this pipeline run per orchestrator instruction** — not a QA rejection or omission. This release note treats the Reviewer's Approved verdict as the completion gate; the Jira ticket remains "In Progress" pending a QA pass.

---

## Summary

Users can now organize recipes into private, dated collections called **meal plans**, distinct from Cookbooks (REW-62). A meal plan belongs to exactly one user, requires a title and a start/end date range (`end_date >= start_date`), and can hold any number of recipes; a single recipe can belong to any number of meal plans (and independently, any number of cookbooks — the two features don't interact). Users can create, rename/re-date, and delete meal plans, and add/remove recipes from a plan independently of the recipe's own draft/published lifecycle — deleting a meal plan never deletes the recipes in it, and deleting a recipe simply removes it from any meal plans it belonged to.

Meal plans are private by default: there is no database policy under which another user can read a meal plan they don't own, enforced at the Row Level Security layer, not just by hiding links in the UI.

**The key structural difference from Cookbooks:** "Add to Meal Plan" is available on recipe cards (`/browse`, `/search`, `/recipes/liked`) and on both the owner's and public recipe pages — surfaces that show other users' published recipes, not just the owner's own. So a meal plan can contain the owner's own recipe (any status) **or** any other user's *published* recipe, mirroring the visibility rule already used by Recipe Likes rather than Cookbooks' owner-only rule. A user cannot add another user's draft recipe to a plan; this is enforced at the database layer (RLS), not just the UI.

The schema also adds a nullable `planned_servings` column to `meal_plan_recipes`, unused by any UI in this ticket, so REW-26 (grocery list generation) can later scale a recipe's ingredients per plan without an additional migration.

---

## User-Facing Changes

- A new **"Meal Plans"** link appears in the navbar for authenticated users, leading to "My Meal Plans" (`/meal-plans`) — a list of the user's plans with title, date range, and recipe count.
- Users can create a new meal plan by submitting a title and a start/end date (`/meal-plans/new`); a blank/whitespace-only title, a missing date, or an end date before the start date is rejected with an inline validation error and no row is created.
- An **"Add to Meal Plan"** button appears on recipe cards (on `/browse`, `/search`, and `/recipes/liked`) and on both the owner's recipe page and the public recipe page. Clicking it opens a shared modal — no full page reload — listing the user's existing meal plans with per-plan Add/Remove toggles, plus an inline "+ New meal plan" quick-create option that creates the plan and adds the current recipe to it in one step.
- Unauthenticated visitors who click "Add to Meal Plan" see a login prompt rather than a silent failure.
- From a meal plan's detail page (`/meal-plans/:id`), users can rename/re-date or delete the plan, and open a bulk recipe picker (`/meal-plans/:id/add-recipes`) to add any of their own recipes — draft or published — into it.
- A user can add one of their own recipes (draft or published) to a meal plan, and can also add another user's *published* recipe. A user cannot add another user's draft/unpublished recipe.
- Deleting a meal plan shows a confirmation flash that the recipes in it were not affected; removing a recipe from a plan never deletes or modifies the recipe itself.
- A second user's session cannot view another user's meal plan, whether by browsing the UI or by directly requesting its URL/ID.

---

## Technical Changes

### Database — two new migrations
- `database/migrations/011_create_meal_plans_table.sql` — new `meal_plans` table (`id`, `user_id`, `title` with a non-empty `CHECK` constraint, `start_date`/`end_date` with `CHECK (end_date >= start_date)`, timestamps), indexed on `user_id` and `(user_id, start_date)`, RLS enabled with owner-only SELECT/INSERT/UPDATE/DELETE policies and **no public/shared SELECT policy**. Reuses the existing `update_updated_at_column()` trigger function from migration `001`.
- `database/migrations/012_create_meal_plan_recipes_table.sql` — new `meal_plan_recipes` junction table (composite PK `(meal_plan_id, recipe_id)`, both `ON DELETE CASCADE`, plus a nullable forward-compat `planned_servings INTEGER` column for REW-26), indexed on both foreign keys, RLS enabled with SELECT/DELETE scoped to plan ownership and **INSERT requiring plan ownership plus a recipe-visibility check** (`recipes.user_id = auth.uid() OR recipes.status = 'published'`) — the database-layer enforcement of "own or published," the key structural divergence from `cookbook_recipes`.

### `src/utils/mealPlanUtils.js` (new) + `mealPlanUtils.test.js` (new)
Pure, unit-tested helper functions: `validateMealPlanTitle()` (required, trimmed, 200-char max, mirrors `validateCookbookTitle`) and `validateDateRange()` (both dates required, must be real calendar dates in `YYYY-MM-DD` form, `end >= start`). Recipe-ID selection normalization for the bulk picker is **reused directly from `cookbookUtils.js`'s `normalizeRecipeIdSelection()`** rather than duplicated, since it's generic UUID-array normalization.

### `src/routes/mealPlanRoutes.js` (new)
Page-based CRUD + membership route set mounted at `/meal-plans`: list, create, view, rename/re-date, delete, bulk-add-recipes (owner's own recipes only), single remove-from-plan. Every route uses `requireAuth` plus an explicit `.eq("user_id", ...)` ownership filter alongside RLS. Mutation routes share a per-user rate limiter (`mealPlanLimiter`, 30 requests/minute, keyed on `req.user.id`).

### `src/routes/mealPlanApiRoutes.js` (new)
JSON API mounted at `/api/meal-plans`, backing the shared "Add to Meal Plan" modal: list plans + per-plan membership for a given recipe, quick-create, and add/remove toggle for a single recipe. Every route requires auth via a local `requireApiAuth` returning JSON `401`s (there is no anonymous-GET case here, unlike `likeRoutes.js`). Mutation routes share `mealPlanApiLimiter` (30/min/user).

### Views and client-side JS (new)
`views/meal-plans/index.ejs`, `new.ejs`, `view.ejs`, `edit.ejs`, `add-recipes.ejs`; `views/partials/meal-plan-modal.ejs` (shared modal, included once in `views/layouts/main.ejs`); `public/js/meal-plans.js` (click delegation, modal open/populate/close, fetch-based add/remove/create, guest login prompt, error toast).

### Modified files
`src/routes/index.js` (mounts `/meal-plans` and `/api/meal-plans`); `views/partials/recipe-card.ejs`, `views/recipes/view.ejs`, `views/recipes/public-view.ejs` (new "Add to Meal Plan" button, gated on `res.locals.user`); `views/layouts/main.ejs` (modal include + script tag); `views/partials/navbar.ejs` (new "Meal Plans" nav link); `public/css/styles.css` (meal-plan card/badge styles and modal styling, reusing existing `feature-card`/`badge-*`/`btn` classes).

### Tests
`npm test`: **135/135 passing**, including the new `mealPlanUtils.test.js` suite. No route-level/integration tests were added — consistent with existing repo convention (no Supabase-backed route file in this codebase has a live-connection test harness).

---

## Known Non-Blocking Notes

The Reviewer approved this change with **no blocking issues**, but flagged two non-blocking "should fix"/nit items during code review:

1. **Implicit vs. explicit recipe-visibility check in `mealPlanApiRoutes.js`.** `POST /api/meal-plans/:id/recipes/:recipeId` relies on `recipes`' own RLS SELECT policy (own-or-published) returning no row for an inaccessible recipe, rather than an explicit `.or(...)` filter in the query itself. Functionally correct and independently backed by the `meal_plan_recipes` RLS INSERT policy, but less self-documenting than an explicit filter. Suggested for a small follow-up PR.
2. **Unchecked `fetch` response in the create-then-add flow (`public/js/meal-plans.js`).** After quick-creating a meal plan via the modal, the immediate follow-up call to add the current recipe to it does not check the response before proceeding — a failure there (rate limit, network blip) would silently leave the new plan without the recipe, without surfacing an error toast. Suggested for the same follow-up PR as item 1.

Neither item blocks this release. Full detail in [`docs/api/meal-plans.md`](api/meal-plans.md#known-issues-non-blocking-reviewer-flagged).

Additional known notes:
3. **No grocery-list generation** — REW-26 is tracked separately; this ticket only ensures the schema supports it (a single join query against `meal_plan_recipes` → `recipes` retrieves all of a plan's recipes and their ingredients, and `planned_servings` is reserved for future use).
4. **No day-level assignment within a plan** — explicitly out of scope per the ticket; a future ticket could add a `planned_date`/`day_offset` column to `meal_plan_recipes`.
5. **No cap on meal-plans-per-user or recipes-per-plan** — relies on the per-user rate limiter to bound abuse.
6. **CSRF protection remains globally disabled** (pre-existing, `src/app.js`, unrelated to REW-63). New meal-plan page forms include the CSRF hidden field for forward-compatibility; the new JSON API has no CSRF-token mechanism at all, the same pre-existing gap as `likeRoutes.js`'s JSON endpoints.

---

## Breaking Changes

None. This is a purely additive feature: two new tables, two new route files mounted at previously-unused paths (`/meal-plans`, `/api/meal-plans`), a new shared modal partial included in the main layout, and a new button on existing card/recipe-page views. No existing route, table, or JSON response shape changed.

---

## Deployment

- **Two new migrations must be run manually** against the Supabase project's SQL editor, in order: `011_create_meal_plans_table.sql`, then `012_create_meal_plan_recipes_table.sql` (see `database/README.md`). This is a manual step in this repo's Supabase workflow, not an automatic migration-runner step.
- No new environment variables.
- No changes to auth, CSRF, or upload-validation middleware. Two new rate-limiter instances (`mealPlanLimiter`, `mealPlanApiLimiter`) reuse the already-installed `express-rate-limit` dependency — no new package.
- Standard Vercel deploy of the updated application code; no Vercel config changes.

---

## Testing

Reviewer verdict: **Approved, no blocking issues** (two non-blocking nit items noted above).

**QA was explicitly skipped for this pipeline run.** No QA report exists to pull testing notes from. Before this is considered production-verified, a manual pass against the acceptance criteria in `docs/plans/REW-63-create-and-manage-meal-plans.md` is recommended, in particular:

- Create/rename/delete a meal plan; blank-title and invalid-date-range validation on create and rename.
- Add multiple recipes to the same plan (modal from multiple cards/pages, and the bulk picker); confirm all appear.
- Add the same recipe to two different plans; confirm it appears independently in both.
- Add one of your own draft recipes to a plan; confirm it's addable.
- Add another user's *published* recipe to your plan via the modal on `/browse`/`/search`; confirm it's addable.
- Attempt to add another user's *draft* recipe to your plan via a direct API call — confirm it's rejected at the RLS layer (not just hidden in the UI).
- Remove a recipe from a plan via both the plan detail page and the modal; confirm the recipe itself is unaffected and still belongs to any other plans/cookbooks.
- Delete a plan with recipes in it; confirm the recipes remain in "My Recipes," any cookbooks, and any other plans.
- Delete a recipe that belongs to one or more plans; confirm no error and the recipe disappears from those plans.
- As a second user, attempt to view another user's meal plan by direct URL/ID — confirm "not found," not a leak of its existence.
- Unauthenticated request to any `/meal-plans*` page route redirects to login; any `/api/meal-plans*` route returns JSON `401`.
- Rapid-fire meal plan mutations trigger the rate limiter (429) after 30/minute on both the page routes and the JSON API.

`npm test`: 135/135 passing (unit tests for `mealPlanUtils.js`, plus the full existing suite including `cookbookUtils.js`; no route-level coverage exists for this or any other Supabase-backed route file in this repo).

---

## Documentation

- `README.md` — new "Meal Plans (REW-63)" feature section; Project Structure updated for `mealPlanRoutes.js`, `mealPlanApiRoutes.js`, `mealPlanUtils.js`, `views/meal-plans/`, `views/partials/meal-plan-modal.ejs`, `public/js/meal-plans.js`.
- `docs/api/meal-plans.md` (new) — full endpoint documentation for `/meal-plans*` and `/api/meal-plans*`, the recipe-card/recipe-view integration, RLS enforcement details, and the two reviewer-flagged non-blocking follow-ups. This page did not exist before REW-63.
- `docs/api/README.md` — added the Meal Plans endpoint table and a link to the new detailed page.
- `database/README.md` — added `meal_plans`/`meal_plan_recipes` to the migration table, table-editor verification list, column-reference sections, Security bullets, Indexes bullets, cascade-behavior/known-gap Notes, and a Rollback snippet.
- `docs/RELEASE_NOTES_REW-63.md` — this file.
- `docs/plans/REW-63-create-and-manage-meal-plans.md` — left as originally written, matching this repo's established convention (completion is tracked in release notes / Jira comments / Confluence instead).
- No `design_handoff_recipe_form/README.md` changes — this ticket touches recipe cards and recipe *view* pages, not the recipe create/edit form.
- Confluence: the plan page (`REW-63: Create and Manage Meal Plans - Feature Plan`) was updated with an as-shipped summary, and a new dedicated `Release: REW-63 - Create and Manage Meal Plans` page was created — see the structured summary in this session's final report for links.

---

## Documentation Gaps / Open Items for a Human

1. **QA has not run.** The acceptance-criteria checklist above is unverified against a live environment. Do not transition REW-63 to Done until a QA pass (or equivalent manual verification) confirms the RLS privacy and own-or-published visibility rules, in particular.
2. **Migrations 011/012 have not been run against any Supabase project yet** (by this pipeline) — confirm they've been applied before this is considered deployed.
3. **The two reviewer-flagged nit items** (implicit recipe-visibility check in `mealPlanApiRoutes.js`; unchecked fetch response in the modal's create-then-add flow) are recommended for a small, low-risk follow-up PR — not blockers for this release.
