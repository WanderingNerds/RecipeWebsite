# Meal Plans (REW-63)

**Feature:** REW-63 — Create and Manage Meal Plans
**Component:** `src/routes/mealPlanRoutes.js`, `src/routes/mealPlanApiRoutes.js`, `src/utils/mealPlanUtils.js`, `views/meal-plans/*.ejs`, `views/partials/meal-plan-modal.ejs`, `public/js/meal-plans.js`, `database/migrations/011_create_meal_plans_table.sql`, `database/migrations/012_create_meal_plan_recipes_table.sql`
**Last Updated:** 2026-09-08

---

## Overview

A meal plan is a private, per-user named collection of recipes scoped to a required start/end date range — in contrast to [Cookbooks](cookbooks.md) (REW-62), which are open-ended, undated collections. A meal plan belongs to exactly one user, requires a title and a valid date range (`end_date >= start_date`), and can hold any number of recipes; a single recipe can belong to any number of meal plans (and independently, any number of cookbooks — the two features don't interact). Users can create, rename/re-date, and delete meal plans (deleting a plan never deletes its recipes), and can add/remove recipes from a plan independently of the recipe's own draft/published lifecycle.

Meal plans are **private by default and not visible or accessible to any other user** — there is no public/shared read policy on the `meal_plans` table, enforced at the database (RLS) layer, not just by hiding links in the UI.

**Key structural difference from Cookbooks:** Cookbooks only ever let an owner add their own recipes. This feature requires an "Add to Meal Plan" action on recipe cards and pages generally — including `/browse`, `/search`, and `/recipes/liked`, which display other users' published recipes. So a meal plan can contain **the owner's own recipe (any status) or any other user's *published* recipe** — the same visibility rule already used by `recipe_likes`. This rule is enforced at the RLS layer, not just in route handlers.

The schema is deliberately forward-compatible with REW-26 (grocery list generation, not built in this ticket): `meal_plan_recipes` has a nullable `planned_servings` column, unused by any REW-63 route/view, so a future feature can scale a recipe's ingredients per plan without another migration.

This page did not exist before REW-63 — it's a new API surface, documented here following the same structure as [Cookbooks API](cookbooks.md).

---

## Page routes (`src/routes/mealPlanRoutes.js`, mounted at `/meal-plans`)

All endpoints below require authentication (`requireAuth`) and render/redirect server-side (EJS views + flash messages), following the same page-based pattern as `cookbookRoutes.js`, not the JSON pattern used by `likeRoutes.js`. Unauthenticated requests are redirected to login, consistent with `/recipes*`/`/cookbooks*`.

All mutation endpoints (create, update, delete, bulk-add, remove) share a per-user rate limiter (`mealPlanLimiter`): **30 requests/minute, keyed on `req.user.id`** (not IP), mirroring `cookbookLimiter`.

Route params (`:id` for a meal plan, `:recipeId` for a recipe) are validated against a UUID regex before any query runs; a malformed ID is treated the same as "not found."

### `GET /meal-plans`

List the current user's meal plans, ordered by `start_date` ascending, with a batched recipe count per plan (single additional query across all plan IDs, avoiding N+1). Renders `views/meal-plans/index.ejs`.

### `GET /meal-plans/new`

Renders the create-meal-plan form (`views/meal-plans/new.ejs` — title, start date, end date).

### `POST /meal-plans`

Creates a meal plan owned by the current user.

- Title is validated via `validateMealPlanTitle()` — required, trimmed, max 200 characters.
- Date range is validated via `validateDateRange()` — both dates required, must be real calendar dates (`YYYY-MM-DD`), and `end_date >= start_date`.
- A blank/whitespace-only title, a missing date, an unparseable date, or an end date before the start date is rejected with a flash error and no row is created (also enforced by DB `CHECK` constraints as defense in depth).
- On success, redirects to `/meal-plans` with a success flash.

### `GET /meal-plans/:id`

Meal plan detail: title, date range, and all recipes currently in it (most recently added first). Ownership is checked via `getOwnedMealPlan()` (`.eq("user_id", ...)` filter, belt-and-suspenders with the RLS policy itself) — a plan that doesn't exist, or belongs to another user, renders identically as "Meal plan not found" and redirects to `/meal-plans`, never leaking whether the ID exists.

### `GET /meal-plans/:id/edit`

Renders the rename/re-date form (`views/meal-plans/edit.ejs`) for an owned plan.

### `POST /meal-plans/:id/update`

Renames and/or re-dates a meal plan. Same title/date-range validation as create. Ownership is enforced by an explicit `.eq("user_id", req.user.id)` filter on the update, in addition to the RLS UPDATE policy.

### `POST /meal-plans/:id/delete`

Deletes a meal plan. **Does not delete the recipes in it** — only the `meal_plans` row (and, via `ON DELETE CASCADE`, its `meal_plan_recipes` membership rows). Redirects to `/meal-plans` with a flash confirming the recipes were not affected.

### `GET /meal-plans/:id/add-recipes`

Renders a checklist of **the owner's own recipes only** (draft **and** published — plan membership is independent of publish status) with current plan membership pre-checked (`views/meal-plans/add-recipes.ejs`). This bulk picker deliberately does not search across other users' recipes — adding another user's published recipe to a plan is only done via the per-recipe modal (card or recipe page), described below.

### `POST /meal-plans/:id/add-recipes`

Bulk-adds selected recipes to a meal plan.

- `recipeIds` is normalized via `normalizeRecipeIdSelection()` — **reused directly from `src/utils/cookbookUtils.js`** rather than duplicated, since it's generic UUID-array normalization, not cookbook-specific (handles the single-value-vs-array quirk of `express.urlencoded`, dedupes, drops malformed/non-UUID values).
- Explicit recipe-ownership check (`.eq("user_id", req.user.id).in("id", recipeIds)`) before insert — belt-and-suspenders alongside the RLS INSERT policy's recipe-visibility check on `meal_plan_recipes`. This route only ever offers/accepts the owner's own recipes.
- Uses `upsert(..., { onConflict: "meal_plan_id,recipe_id", ignoreDuplicates: true })` so re-submitting an already-checked recipe (or a race between two tabs) doesn't error on the composite primary key.
- If none of the selected recipe IDs are owned by the requester, no rows are inserted and a flash error is shown; otherwise redirects to the plan detail page with a count of recipes added.

### `POST /meal-plans/:id/recipes/:recipeId/remove`

Removes a recipe from a meal plan (deletes the `meal_plan_recipes` row only — **the recipe itself is never deleted or modified**, and it remains in any other meal plans or cookbooks it belonged to). Used by the meal plan detail page. Redirects back to `/meal-plans/:id`.

---

## JSON API (`src/routes/mealPlanApiRoutes.js`, mounted at `/api/meal-plans`)

Backs the shared "Add to Meal Plan" modal (`views/partials/meal-plan-modal.ejs`, `public/js/meal-plans.js`), which is included once in the main layout and opened from a `.meal-plan-add-btn` on a recipe card, the owner's recipe view page (`/recipes/:id`), or the public recipe page (`/r/:id`) — for **any authenticated viewer**, not just the recipe's owner (unlike Cookbooks' "Save to Cookbook(s)" widget, which is owner-only).

Every route in this file requires auth via a local `requireApiAuth` helper (duplicated from `likeRoutes.js`'s helper, per this repo's per-route-file convention) that returns a JSON `401` rather than redirecting — **there is no anonymous-GET case here**, unlike `likeRoutes.js`, because meal plans have no public/shared read at all.

Mutation routes (`POST`/`DELETE`) share a per-user rate limiter (`mealPlanApiLimiter`): **30 requests/minute, keyed on `req.user.id`**, mirroring `likeLimiter`.

Route params and the `recipeId` query param are validated against the same UUID pattern used elsewhere in the app before any query runs.

### `GET /api/meal-plans?recipeId=<uuid>`

Lists the current user's meal plans. If `recipeId` is supplied (optional), each returned plan also carries `containsRecipe: boolean`, so the modal can render "Add" vs. "Remove" per plan on open, without a separate request per plan.

**Response `200`:**
```json
{
  "mealPlans": [
    { "id": "uuid", "title": "Week of Sept 8", "startDate": "2026-09-08", "endDate": "2026-09-14", "containsRecipe": true }
  ]
}
```

**Errors:** `400` if `recipeId` is present but not a valid UUID; `401` if unauthenticated; `500` on a database error.

### `POST /api/meal-plans`

Quick-creates a new meal plan — backs the modal's inline "+ New meal plan" mini-form (title + start/end date). Same `validateMealPlanTitle()`/`validateDateRange()` validation as the page-based create route.

**Request body:** `{ "title": string, "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }`

**Response `201`:**
```json
{ "mealPlan": { "id": "uuid", "title": "...", "startDate": "...", "endDate": "...", "containsRecipe": false } }
```

**Errors:** `400` with `{ "error": "..." }` on title/date validation failure; `401` if unauthenticated; `500` on a database error.

### `POST /api/meal-plans/:id/recipes/:recipeId`

Adds a recipe to a meal plan (the modal's "Add" toggle action).

- Ownership of the plan is checked via `getOwnedMealPlan()`; a plan that doesn't exist or isn't owned by the requester returns `404`.
- **Recipe-visibility check:** the route queries `recipes` for the given `recipeId` using the caller's RLS-scoped Supabase client. Because the `recipes` table's own RLS SELECT policies only return a row when it's the caller's own recipe **or** it's `status = 'published'` (see `database/migrations/001_create_recipes_table.sql`), this query implicitly enforces the same "own or published" rule as the `meal_plan_recipes` INSERT policy — a recipe that is neither the caller's own nor published returns no row, and the route responds `404 Recipe not found`. **Reviewer note (non-blocking):** this check is *implicit* (relying on `recipes`' own RLS SELECT policy) rather than an *explicit* `.or("user_id.eq.<id>,status.eq.published")` filter the way `mealPlanRoutes.js`'s bulk-add route explicitly checks ownership. It is correct as written and backed by the `meal_plan_recipes` RLS INSERT policy regardless, but an explicit filter would make the intent self-evident from the query alone without relying on a reader also knowing the `recipes` RLS policy shape. Flagged as a minor follow-up, not a blocker — see "Known issues" below.
- Insert uses `upsert(..., { onConflict: "meal_plan_id,recipe_id", ignoreDuplicates: true })`, same idempotency behavior as the bulk-add route.

**Response `200`:** `{ "added": true, "mealPlanId": "uuid", "recipeId": "uuid", "mealPlanTitle": "..." }`

**Errors:** `400` on invalid UUIDs; `401` if unauthenticated; `404` if the plan isn't owned by the caller, or the recipe doesn't exist/isn't visible to the caller (own-or-published); `500` on a database error.

### `DELETE /api/meal-plans/:id/recipes/:recipeId`

Removes a recipe from a meal plan (the modal's "Remove" toggle action) — same ownership check and never deletes/modifies the recipe itself.

**Response `200`:** `{ "added": false, "mealPlanId": "uuid", "recipeId": "uuid", "mealPlanTitle": "..." }`

**Errors:** same as the add route above (`400`/`401`/`404`/`500`).

---

## Recipe card, recipe view, and public recipe view integration

- `views/partials/recipe-card.ejs` — an "Add to Meal Plan" button (`.meal-plan-add-btn`, carries `data-recipe-id`) is gated on `res.locals.user` (populated everywhere via `optionalAuth` in `src/app.js`); guests see a `.meal-plan-add-btn-guest` variant that prompts login via `confirm()` instead of silently failing. No route-handler changes were needed anywhere `recipe-card.ejs` renders (`/browse`, `/search`, `/recipes/liked`) — the modal fetches plan/membership data client-side on open.
- `views/recipes/view.ejs` (owner's private view) and `views/recipes/public-view.ejs` (public `/r/:id` view) both render the same button for any authenticated viewer — **not owner-only**, unlike Cookbooks' widget, since any authenticated user allowed to see a recipe (their own, or someone else's published recipe) can plan it.
- `views/layouts/main.ejs` includes `partials/meal-plan-modal` once (gated on `user`) and loads `public/js/meal-plans.js`, which globally delegates clicks on `.meal-plan-add-btn` so no per-instance wiring is needed regardless of how many cards are on the page.
- `views/partials/navbar.ejs` has a new "Meal Plans" nav item for authenticated users, alongside "Cookbooks."

This is a client-side/render-only integration — no new fields were added to any existing page's server-rendered JSON or EJS locals for card rendering; membership state is fetched on demand when the modal opens (`GET /api/meal-plans?recipeId=...`), not pre-computed per card, to avoid N+1/heavy per-card queries on grid pages that can show many recipes at once.

---

## Security

- **Auth:** Every `/meal-plans*` page route requires `requireAuth` (redirects to login); every `/api/meal-plans*` route requires the local `requireApiAuth` (JSON `401`), consistent with `/recipes*`/`/cookbooks*` and `/api/likes*` respectively.
- **Authorization:** Double-layered on every route — RLS (`createSupabaseClient(req.accessToken)`, which runs queries as the authenticated user) **and** an explicit `.eq("user_id", req.user.id)` filter on plan reads/writes, matching the `cookbookRoutes.js`/`recipeRoutes.js` convention.
- **Recipe-visibility enforcement is double-layered and intentionally different from Cookbooks:** both the page routes (bulk-add) and the JSON API (single add) check that a recipe is either the caller's own or published before inserting into `meal_plan_recipes`, **in addition to** the `meal_plan_recipes` RLS INSERT policy performing the identical check server-side. A user cannot add another user's *draft* recipe to their plan even if application code were buggy, because the RLS policy enforces it independently. This is the one place in this feature (and one of very few in the app, alongside `recipe_likes`) where authorization is *not* "owner only."
- **Privacy is structural, not just UI-level:** because there is no public/shared SELECT RLS policy on `meal_plans`, a direct API/URL guess at another user's `/meal-plans/:id` (or `/api/meal-plans/:id/...`) returns nothing from Supabase regardless of route code.
- **Rate limiting:** 30 mutation requests/minute per user on both the page routes (`mealPlanLimiter`) and the JSON API (`mealPlanApiLimiter`).
- **Input validation:** title required/trimmed/capped at 200 characters (`validateMealPlanTitle()`, unit-tested); date range required, must be real calendar dates, `end >= start` (`validateDateRange()`, unit-tested) — both enforced in `mealPlanUtils.js` and via DB `CHECK` constraints as defense in depth. Route/query UUIDs are validated against a pattern before any query runs.
- **CSRF:** CSRF protection is currently disabled repo-wide (`src/app.js`, `doubleCsrfProtection` commented out, `res.locals.csrfToken` hard-coded to `''`) — pre-existing gap, not introduced or fixed here. Page-based forms include the CSRF hidden field for forward-compatibility. **The JSON API has no CSRF-token mechanism at all**, the same pre-existing gap as `likeRoutes.js`'s JSON endpoints — when CSRF is eventually re-enabled repo-wide, both will need client JS updated to read a token (e.g. from a `<meta>` tag) and send it as a header.

---

## Known issues (non-blocking, reviewer-flagged)

The Reviewer approved this change with **no blocking issues**, but flagged two non-blocking "should fix"/nit items during code review, tracked here as known follow-ups:

1. **Implicit vs. explicit recipe-visibility check in `mealPlanApiRoutes.js`.** `POST /api/meal-plans/:id/recipes/:recipeId` determines whether a recipe is addable by querying `recipes` with the caller's RLS-scoped client and checking for a returned row, relying on `recipes`' own RLS SELECT policy (own-or-published) rather than an explicit `.or("user_id.eq.<id>,status.eq.published")` filter in the query itself (the pattern `mealPlanRoutes.js`'s bulk-add route uses for ownership). Functionally correct and backed by the `meal_plan_recipes` RLS INSERT policy regardless, but less self-documenting. Suggested fix: make the filter explicit in a follow-up PR.
2. **Unchecked `fetch` response in the create-then-add flow (`public/js/meal-plans.js`, `handleCreateMealPlan`).** After a new meal plan is created via `POST /api/meal-plans`, the code immediately calls `POST /api/meal-plans/:id/recipes/:recipeId` to add the current recipe to it, but does not check that second response's `ok`/status before proceeding to `resetNewMealPlanForm()`/`loadMealPlans()`. If the add call fails (e.g. rate limit, network blip), the user sees the new plan appear without an error, and the plan may not actually contain the recipe — silently misleading, though not destructive (the plan still exists and can be retried from the list). Suggested fix: check the response and surface `showMealPlanErrorToast()` on failure, consistent with every other mutation in this file.

Neither item blocks this release; both are recommended for a small, low-risk follow-up PR.

---

## Testing notes

- `src/utils/mealPlanUtils.test.js` unit-tests `validateMealPlanTitle()` and `validateDateRange()` (blank/whitespace title rejection, max-length boundary, missing dates, unparseable/invalid calendar dates such as `2024-02-30`, end-before-start rejection). Part of `npm test` (**135/135 passing** as of this change). Recipe-ID selection normalization for the bulk picker is covered by the existing `cookbookUtils.test.js` suite, since `mealPlanRoutes.js` reuses `normalizeRecipeIdSelection()` directly rather than duplicating it.
- No request-level/integration tests exist for `mealPlanRoutes.js`/`mealPlanApiRoutes.js`, consistent with every other Supabase-backed route file in this codebase (no live-Supabase test harness exists anywhere).
- **QA was intentionally skipped for this pipeline run** (explicit orchestrator instruction, not a QA rejection or omission). The acceptance-criteria checklist in `docs/plans/REW-63-create-and-manage-meal-plans.md` (19 items, including the "another user's session cannot view a meal plan via direct URL/ID" RLS check and the "cannot add another user's draft recipe" RLS check) has not been manually/QA-verified against a running app.

---

## Related documentation

- [API Overview](README.md)
- [Cookbooks API](cookbooks.md) — the structural precedent this feature extends/diverges from
- Plan: `docs/plans/REW-63-create-and-manage-meal-plans.md`
- `database/README.md` — `meal_plans` / `meal_plan_recipes` tables, RLS policies, indexes
- Release notes: `docs/RELEASE_NOTES_REW-63.md`

---

## Changelog

| Date | Change |
|------|--------|
| 2026-09-08 | Page created documenting REW-63 (new feature — no prior version to reconcile). |
