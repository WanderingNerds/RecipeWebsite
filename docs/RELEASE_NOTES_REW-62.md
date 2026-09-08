# Release Notes: REW-62 - Create and Manage Cookbooks

**Date:** 2026-09-08
**Jira Issue:** [REW-62](https://wanderingnerds.atlassian.net/browse/REW-62) (link unverified this session — see "Documentation gaps" below)
**Branch:** `REW-62-create-and-manage-cookbooks`
**Pipeline:** Planner → Developer → Reviewer (Approved, no blocking issues). **QA was explicitly skipped for this pipeline run per orchestrator instruction** — not a QA rejection or omission. This release note treats the Reviewer's Approved verdict as the completion gate.

---

## Summary

Users can now organize their own recipes into private, named collections called **cookbooks**. A cookbook belongs to exactly one user, requires a title, and can hold any number of the owner's own recipes (draft or published); a single recipe can belong to any number of cookbooks. Users can create, rename, and delete cookbooks, and add/remove recipes from a cookbook independently of the recipe's own draft/published lifecycle — deleting a cookbook never deletes the recipes in it, and deleting a recipe simply removes it from any cookbooks it belonged to.

Cookbooks are private by default: there is no database policy under which another user can read a cookbook they don't own, so this is enforced at the Row Level Security layer, not just by hiding links in the UI. Cookbook sharing (REW-19) is explicitly out of scope for this ticket; the schema is structured so sharing can be added later without a breaking change.

---

## User-Facing Changes

- A new **"Cookbooks"** link appears in the navbar for authenticated users, leading to "My Cookbooks" (`/cookbooks`) — a list of the user's cookbooks with a recipe count on each.
- Users can create a new cookbook by submitting a title (`/cookbooks/new`); a blank/whitespace-only title is rejected with an inline validation error.
- From a cookbook's detail page (`/cookbooks/:id`), users can rename or delete the cookbook, and open a recipe picker (`/cookbooks/:id/add-recipes`) to bulk-add any of their own recipes — draft or published — into it.
- On the recipe detail page, an owner-only **"Save to Cookbook(s)"** widget lists which of the viewer's cookbooks already contain the recipe (each removable with one click) and offers "+ Add to {cookbook}" buttons for the rest, so recipes can be filed into cookbooks without leaving the recipe page.
- Deleting a cookbook shows a confirmation flash that the recipes in it were not affected; removing a recipe from a cookbook never deletes or modifies the recipe itself.
- A second user's session cannot view another user's cookbook, whether by browsing the UI or by directly requesting its URL/ID.

---

## Technical Changes

### Database — two new migrations
- `database/migrations/009_create_cookbooks_table.sql` — new `cookbooks` table (`id`, `user_id`, `title` with a non-empty `CHECK` constraint, timestamps), indexed on `user_id`, RLS enabled with owner-only SELECT/INSERT/UPDATE/DELETE policies and **no public/shared SELECT policy** (this is what makes cookbooks structurally private). Reuses the existing `update_updated_at_column()` trigger function from migration `001` rather than redefining it.
- `database/migrations/010_create_cookbook_recipes_table.sql` — new `cookbook_recipes` junction table (composite PK `(cookbook_id, recipe_id)`, both `ON DELETE CASCADE`), indexed on both foreign keys, RLS enabled with SELECT/DELETE scoped to cookbook ownership and **INSERT requiring both cookbook ownership and recipe ownership** — the database-layer enforcement of "add recipes from their own recipes only."

### `src/utils/cookbookUtils.js` (new) + `cookbookUtils.test.js` (new)
Pure, unit-tested helper functions extracted following the existing `userUtils.js`/`authUtils.js` pattern: `validateCookbookTitle()` (required, trimmed, 200-char max, mirrors the DB `CHECK` constraint) and `normalizeRecipeIdSelection()` (form-body array/single-value normalization, dedup, malformed-UUID filtering — mirrors the existing category-array handling in `recipeRoutes.js`).

### `src/routes/cookbookRoutes.js` (new)
Full CRUD + membership route set: list, create, view, rename, delete, bulk-add-recipes, single-add-recipe, remove-recipe. Every route uses `requireAuth` plus an explicit `.eq("user_id", ...)` ownership filter alongside RLS (belt-and-suspenders, matching `recipeRoutes.js` convention). Mutation routes share a per-user rate limiter (`cookbookLimiter`, 30 requests/minute, keyed on `req.user.id`, mirroring `likeLimiter`). Registered in `src/routes/index.js` at `/cookbooks`.

### `src/routes/recipeRoutes.js` / `views/recipes/view.ejs`
`GET /:id` now fetches, for the recipe's owner only, which of their cookbooks already contain the recipe (`getOwnerCookbooksForRecipe()`, batched in two queries rather than one per cookbook), and passes that to a new "Save to Cookbook(s)" section in the view.

### Views (new)
`views/cookbooks/index.ejs`, `new.ejs`, `view.ejs`, `edit.ejs`, `add-recipes.ejs`.

### `views/partials/navbar.ejs` / `public/css/styles.css`
New "Cookbooks" nav link (auth-gated, active-state aware). New CSS for cookbook count badges, cookbook badges, and the remove-from-cookbook button on the recipe view widget — reuses existing `tag-badge`/`btn`/`btn-outline` classes rather than introducing a large new style block.

### Tests
`npm test`: **120/120 passing**, including the new `cookbookUtils.test.js` suite. No route-level/integration tests were added — consistent with existing repo convention (no Supabase-backed route file in this codebase has a live-connection test harness).

---

## Documentation Gaps Closed From Reviewer Feedback

The Reviewer approved this change with no blocking issues, but flagged two non-blocking "should fix" documentation gaps, both closed in this pass:
1. `database/README.md` had no entries for migrations 009/010 — added migration-table rows, `cookbooks`/`cookbook_recipes` column-reference sections, RLS bullets under "Security," index bullets under "Indexes," a cascade-behavior note under "Notes," and a rollback snippet.
2. No `docs/api/*.md` page existed for the cookbook endpoints — added `docs/api/cookbooks.md` (following `docs/api/recipe-likes.md`'s structure) and linked it from `docs/api/README.md`'s endpoint table.

---

## Known Non-Blocking Notes

1. **QA stage skipped for this pipeline run**, per explicit orchestrator instruction — not a QA rejection. The acceptance-criteria checklist in `docs/plans/rew-62-cookbooks.md` (13 items, including the "another user's session cannot view a private cookbook" RLS check) has not been manually/QA-verified against a running app. See "Testing" below.
2. **No sharing** — cookbooks cannot be shared with other users in this ticket (REW-19, tracked separately). The data model was deliberately kept additive-friendly for that future work.
3. **No cap on cookbooks-per-user or recipes-per-cookbook** — relies on the per-user rate limiter to bound abuse; a future ticket can add hard limits if needed.
4. **CSRF protection remains globally disabled** (pre-existing, `src/app.js`, unrelated to REW-62). New cookbook forms still include the CSRF hidden field for forward-compatibility.
5. **The Jira issue link and description were not re-verified against live Jira this session** — see "Documentation gaps" below.

---

## Breaking Changes

None. This is a purely additive feature: two new tables, one new route file mounted at a previously-unused path (`/cookbooks`), one new local (`ownerCookbooks`) added to `GET /recipes/:id`'s render data, and one new UI section on an existing page. No existing route, table, or JSON response shape changed.

---

## Deployment

- **Two new migrations must be run manually** against the Supabase project's SQL editor, in order: `009_create_cookbooks_table.sql`, then `010_create_cookbook_recipes_table.sql` (see `database/README.md`). This is a manual step in this repo's Supabase workflow, not an automatic migration-runner step.
- No new environment variables.
- No changes to auth, CSRF, or upload-validation middleware. New rate-limiter instance (`cookbookLimiter`) reuses the already-installed `express-rate-limit` dependency — no new package.
- Standard Vercel deploy of the updated application code; no Vercel config changes.

---

## Testing

Reviewer verdict: **Approved, no blocking issues** (two non-blocking documentation gaps, both closed above).

**QA was explicitly skipped for this pipeline run.** No QA report exists to pull testing notes from. Before this is considered production-verified, a manual pass against the acceptance criteria in `docs/plans/rew-62-cookbooks.md` is recommended, in particular:
- Create/rename/delete a cookbook; blank-title validation on create and rename.
- Bulk-add multiple recipes (draft and published) to a cookbook via the picker; confirm all appear.
- Add the same recipe to two different cookbooks; confirm it appears independently in both.
- Remove a recipe from a cookbook via both the cookbook detail page and the recipe view widget; confirm the recipe itself is unaffected and still belongs to any other cookbooks.
- Delete a cookbook with recipes in it; confirm the recipes remain in "My Recipes" and any other cookbooks.
- Delete a recipe that belongs to one or more cookbooks; confirm no error and the recipe disappears from those cookbooks.
- As a second user, attempt to view another user's cookbook by direct URL/ID — confirm "not found," not a leak of its existence.
- Unauthenticated request to any `/cookbooks*` route redirects to login.
- Rapid-fire cookbook mutations trigger the rate limiter (429) after 30/minute.

`npm test`: 120/120 passing (unit tests for `cookbookUtils.js` only — no route-level coverage exists for this or any other Supabase-backed route file in this repo).

---

## Documentation

- `README.md` — new "Cookbooks (REW-62)" feature section; Project Structure updated to list `cookbookRoutes.js`, `cookbookUtils.js`, and `views/cookbooks/`.
- `docs/api/cookbooks.md` (new) — full endpoint documentation for `/cookbooks*`, the recipe-view "Save to Cookbook(s)" integration, and RLS enforcement details. This page did not exist before REW-62.
- `docs/api/README.md` — added the Cookbooks endpoint table and a link to the new detailed page.
- `database/README.md` — added `cookbooks`/`cookbook_recipes` to the migration table, table-editor verification list, column-reference sections, Security bullets, Indexes bullets, a cascade-behavior Note, and a Rollback snippet. (Reviewer-flagged gap, closed here.)
- `docs/RELEASE_NOTES_REW-62.md` — this file.
- `docs/plans/rew-62-cookbooks.md` — left as originally written, matching this repo's established convention (every prior completed ticket's plan file is left at its "Planning Complete" state; completion is tracked in release notes / Jira comments / Confluence instead).
- No `design_handoff_recipe_form/README.md` changes — that directory does not exist anywhere in this repository, and this ticket touches the recipe *view* page (a small owner-only widget), not the recipe create/edit form, so it would not have been in scope even if the directory existed.
- Confluence: drafted, not posted this session — see "Confluence pages" in the structured summary below.

---

## Documentation Gaps / Open Items for a Human

1. **Jira issue link/description unverified.** Atlassian access was unavailable throughout the Planner/Developer/Reviewer/Documentation stages of this pipeline run (consistent with prior tickets in this repo — REW-52 through REW-58). Someone with working Jira access should open REW-62 directly, confirm the AC matches `docs/plans/rew-62-cookbooks.md`, post this release note's summary as a comment, and decide the correct "implemented + reviewed, not yet QA'd" status for this team's workflow (do not transition straight to Done).
2. **Confluence pages not published.** Content is drafted below and in this file; needs to be posted by someone with working Confluence access.
3. **QA has not run.** The acceptance-criteria checklist above is unverified against a live environment.
4. **Migrations 009/010 have not been run against any Supabase project yet** (by this pipeline) — confirm they've been applied before this is considered deployed.
