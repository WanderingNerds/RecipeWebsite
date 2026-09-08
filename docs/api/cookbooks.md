# Cookbooks (REW-62)

**Feature:** REW-62 — Create and Manage Cookbooks
**Component:** `src/routes/cookbookRoutes.js`, `src/utils/cookbookUtils.js`, `src/routes/recipeRoutes.js` (recipe-view integration), `views/cookbooks/*.ejs`, `views/recipes/view.ejs`, `database/migrations/009_create_cookbooks_table.sql`, `database/migrations/010_create_cookbook_recipes_table.sql`
**Last Updated:** 2026-09-08

---

## Overview

A cookbook is a private, per-user named collection of the owner's own recipes. Users can create, rename, and delete cookbooks, and add/remove recipes from a cookbook independently of the recipe's own lifecycle (draft or published). A cookbook belongs to exactly one user; a single recipe can belong to any number of cookbooks. Deleting a cookbook never deletes the recipes in it, and deleting a recipe removes it from any cookbooks it belonged to without error.

Cookbooks are **private by default and not visible or accessible to any other user** — there is no public/shared read policy on the `cookbooks` table, so this is enforced at the database (RLS) layer, not just by hiding links in the UI. Cookbook sharing (REW-19) is explicitly out of scope for this ticket; the schema and RLS policies are structured so sharing can be layered on later as an additional SELECT policy (or a future `cookbook_shares` table) without a breaking change.

This page did not exist before REW-62 — it's a new API surface, documented here following the same structure as [Recipe Likes API](recipe-likes.md).

---

## Endpoints (`src/routes/cookbookRoutes.js`, mounted at `/cookbooks`)

All endpoints below require authentication (`requireAuth`) and render/redirect server-side (EJS views + flash messages) rather than returning JSON — this feature follows the existing page-based pattern used by `recipeRoutes.js`/`categoryRoutes.js`, not the JSON API pattern used by `likeRoutes.js`. Unauthenticated requests are redirected to login, consistent with `/recipes*`.

All mutation endpoints (create, rename, delete, bulk-add, single-add, remove) share a per-user rate limiter (`cookbookLimiter`): **30 requests/minute, keyed on `req.user.id`** (not IP), mirroring `likeLimiter` in `likeRoutes.js`.

Route params (`:id` for a cookbook, `:recipeId` for a recipe) are validated against a UUID regex before any query runs; a malformed ID is treated the same as "not found."

### `GET /cookbooks`

List the current user's cookbooks, most recently created first, with a batched recipe count per cookbook (single additional query across all cookbook IDs, avoiding N+1). Renders `views/cookbooks/index.ejs`.

### `GET /cookbooks/new`

Renders the create-cookbook form (`views/cookbooks/new.ejs`, title only).

### `POST /cookbooks`

Creates a cookbook owned by the current user.

- Title is validated/normalized via `validateCookbookTitle()` (`src/utils/cookbookUtils.js`) — required, trimmed, max 200 characters. A blank/whitespace-only title is rejected with a flash error and no row is created (also enforced by a DB `CHECK` constraint as defense in depth).
- On success, redirects to `/cookbooks` with a success flash.

### `GET /cookbooks/:id`

Cookbook detail: the cookbook's title plus all recipes currently in it (most recently added first). Ownership is checked via `getOwnedCookbook()` (RLS `.eq("user_id", ...)` filter, belt-and-suspenders with the RLS policy itself) — a cookbook that doesn't exist, or belongs to another user, renders identically as "Cookbook not found" and redirects to `/cookbooks`, never leaking whether the ID exists.

### `GET /cookbooks/:id/edit`

Renders the rename form (`views/cookbooks/edit.ejs`) for an owned cookbook.

### `POST /cookbooks/:id/update`

Renames a cookbook. Same title validation as create. Ownership is enforced by an explicit `.eq("user_id", req.user.id)` filter on the update, in addition to the RLS UPDATE policy.

### `POST /cookbooks/:id/delete`

Deletes a cookbook. **Does not delete the recipes in it** — only the `cookbooks` row (and, via `ON DELETE CASCADE`, its `cookbook_recipes` membership rows). Redirects to `/cookbooks` with a flash confirming the recipes were not affected.

### `GET /cookbooks/:id/add-recipes`

Renders a checklist of all of the owner's own recipes (draft **and** published — cookbook membership is independent of publish status) with current cookbook membership pre-checked (`views/cookbooks/add-recipes.ejs`).

### `POST /cookbooks/:id/add-recipes`

Bulk-adds selected recipes to a cookbook.

- `recipeIds` is normalized from the form body via `normalizeRecipeIdSelection()` (handles the single-value-vs-array quirk of `express.urlencoded`, dedupes, drops malformed/non-UUID values).
- Explicit recipe-ownership check (`.eq("user_id", req.user.id).in("id", recipeIds)`) before insert — belt-and-suspenders alongside the RLS INSERT policy's own recipe-ownership check on `cookbook_recipes`. A user can only add their own recipes, even if application code were buggy.
- Uses `upsert(..., { onConflict: "cookbook_id,recipe_id", ignoreDuplicates: true })` so re-submitting an already-checked recipe (or a race between two tabs) doesn't error on the composite primary key.
- If none of the selected recipe IDs are owned by the requester, no rows are inserted and a flash error is shown; otherwise redirects to the cookbook detail page with a count of recipes added.

### `POST /cookbooks/:id/recipes/:recipeId`

Adds a **single** recipe to a cookbook. Backs the "Save to Cookbook(s)" widget on the recipe detail page (`views/recipes/view.ejs`) — see "Recipe view integration" below. Same ownership checks and idempotent upsert behavior as the bulk endpoint. Redirects back to `/recipes/:recipeId`.

### `POST /cookbooks/:id/recipes/:recipeId/remove`

Removes a recipe from a cookbook (deletes the `cookbook_recipes` row only — **the recipe itself is never deleted or modified**, and it remains in any other cookbooks it belonged to). Used by both the cookbook detail page and the recipe view page's "Save to Cookbook(s)" widget.

- Accepts an optional `returnTo` form field: `returnTo=recipe` redirects back to `/recipes/:recipeId`; anything else (including omitted) redirects back to `/cookbooks/:id`, so both call sites can send the user back to where they clicked "Remove."

---

## Recipe view integration (`src/routes/recipeRoutes.js`, `views/recipes/view.ejs`)

`GET /recipes/:id` now includes an owner-only "Save to Cookbook(s)" section, populated only when the viewer is the recipe's owner (`isOwner === true`):

1. `getOwnerCookbooksForRecipe()` fetches the current user's cookbooks and, in a second batched query against `cookbook_recipes` (not one query per cookbook), which of them already contain this recipe — the same N+1-avoidance approach already used for like-status batching elsewhere in this file.
2. The view renders each cookbook already containing the recipe as a removable badge (posts to `POST /cookbooks/:id/recipes/:recipeId/remove` with `returnTo=recipe`), and every other cookbook as an "+ Add to {title}" button (posts to `POST /cookbooks/:id/recipes/:recipeId`).
3. If the user has no cookbooks yet, the widget shows a prompt linking to `/cookbooks/new` instead.

This is a page-render enrichment only (an EJS local), not a JSON response — no new fields were added to any existing JSON API.

---

## Security

- **Auth:** Every `/cookbooks*` route requires `requireAuth`; unauthenticated requests redirect to login, consistent with `/recipes*`.
- **Authorization:** Double-layered on every route, matching the existing `recipeRoutes.js` convention — RLS (`createSupabaseClient(req.accessToken)`, which runs queries as the authenticated user) **and** an explicit `.eq("user_id", req.user.id)` filter on cookbook reads/writes, plus an explicit recipe-ownership check before any insert into `cookbook_recipes`.
- **Privacy is structural, not just UI-level:** because `cookbooks` has no public/shared SELECT RLS policy, a direct request for another user's `/cookbooks/:id` (or a direct Supabase query as another authenticated user) returns nothing, regardless of route code. This satisfies "cookbooks are private by default" at the data layer.
- **"Add from own recipes only" is enforced at the database layer too:** `cookbook_recipes`'s INSERT RLS policy requires the inserting user to own *both* the target cookbook and the recipe being added — not just application-layer validation.
- **Rate limiting:** 30 mutation requests/minute per user (`cookbookLimiter`), shared across create/rename/delete/bulk-add/single-add/remove.
- **Input validation:** cookbook title is required, trimmed, and capped at 200 characters both in `cookbookUtils.validateCookbookTitle()` (unit-tested) and via a DB `CHECK` constraint. Route params (`:id`, `:recipeId`) are validated against a UUID pattern before querying. Recipe-ID selections from bulk-add forms are normalized/deduped/filtered via `cookbookUtils.normalizeRecipeIdSelection()` (also unit-tested).
- **CSRF:** CSRF protection is currently disabled repo-wide (`doubleCsrfProtection` commented out in `src/app.js`, `res.locals.csrfToken` hard-coded to `''`). This is a pre-existing, cross-cutting gap unrelated to REW-62. New cookbook forms still include the `<input type="hidden" name="_csrf" ...>` field for consistency, so no further changes are needed whenever CSRF is re-enabled repo-wide.

---

## Testing notes

- `src/utils/cookbookUtils.test.js` unit-tests `validateCookbookTitle()` and `normalizeRecipeIdSelection()` (blank/whitespace rejection, max-length boundary, dedup, malformed/non-string filtering, case-insensitive UUID matching). Part of `npm test` (120/120 passing as of this change).
- No request-level/integration tests exist for `cookbookRoutes.js`, consistent with every other Supabase-backed route file in this codebase (none have a live-Supabase-dependent test harness). Acceptance criteria in `docs/plans/rew-62-cookbooks.md` require manual verification against a running app — **this pipeline run explicitly skipped the QA stage**, so manual verification of the full acceptance-criteria list (including the "another user's session cannot view a cookbook via direct URL" RLS check) has not yet been confirmed against a live environment.

---

## Related documentation

- [API Overview](README.md)
- Plan: `docs/plans/rew-62-cookbooks.md`
- `database/README.md` — `cookbooks` / `cookbook_recipes` tables, RLS policies, indexes
- Release notes: `docs/RELEASE_NOTES_REW-62.md`

---

## Changelog

| Date | Change |
|------|--------|
| 2026-09-08 | Page created documenting REW-62 (new feature — no prior version to reconcile). |
