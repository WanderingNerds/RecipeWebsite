# Implementation Plan: REW-62 Create and Manage Cookbooks

## Jira issue

**REW-62 — "Create and Manage Cookbooks"**

I was not able to reach the Atlassian Rovo MCP tools in this session (`getAccessibleAtlassianResources` / `getJiraIssue` / `searchConfluenceUsingCql` all returned "No such tool available" — no Jira or Confluence tools were exposed to me at all this run, despite that normally being part of my role). I could not re-fetch the live issue to confirm the description/AC below match the current Jira state, and this plan is therefore built entirely from the ticket text pasted into the task request. **Before development starts, someone with working Jira access should open REW-62 directly and confirm nothing has changed since this snapshot** (particularly whether REW-19 — Cookbook Sharing — is still explicitly out of scope, since that assumption drives several design decisions below).

Link (unverified this session): `https://wanderingnerds.atlassian.net/browse/REW-62`

## Confluence page

**Not created.** The same tool-access failure that blocked the Jira re-fetch also blocked Confluence access, so I could not search for an existing page on cookbooks/collections or publish this plan there as my role normally requires. Once Atlassian MCP access is restored, this plan (or a summary of it, linking back to REW-62) should be published under the RecipeWebsite space — check first whether a page already exists for "Recipe Collections" / "Cookbooks" before creating a new one, and update in place if so.

## Summary

Add "cookbooks" as a private, per-user way to organize recipes into named collections. A cookbook belongs to exactly one user, has a required title, and can hold any number of the owner's own recipes; a single recipe can belong to any number of cookbooks. Users can create, rename, and delete cookbooks (deleting a cookbook never deletes the recipes in it), and can add/remove recipes from a cookbook independently of the recipe's own lifecycle. Cookbooks are private by default and are not visible or accessible to any user other than the owner — this ticket does not implement sharing (REW-19), but the data model and RLS policies are structured so sharing can be layered on later (e.g. via an additional RLS policy or a `cookbook_shares` table) without a breaking schema change.

The feature follows the existing `recipes` / `recipe_categories` pattern already in the codebase: an owner-scoped parent table (`cookbooks`, modeled on `recipes`) plus a many-to-many junction table (`cookbook_recipes`, modeled on `recipe_categories`), both protected by Supabase RLS, with server-rendered EJS pages and POST-redirect form handlers matching `recipeRoutes.js` / `categoryRoutes.js`.

## Open questions / assumptions

| # | Question | Assumption made (proceeded on this basis) |
|---|----------|---------------------------------------------|
| 1 | Does a cookbook need a description/cover image? | Not in the AC. **Assumption: title only for this ticket.** Description/cover image would be a small additive migration later if wanted. |
| 2 | Can draft (unpublished) recipes be added to a cookbook? | AC says "recipes from their recipes," not "published recipes." **Assumption: yes** — cookbooks are a private organizational tool, independent of publish status. |
| 3 | Is there a cap on cookbooks per user or recipes per cookbook? | Not specified. **Assumption: no hard cap for MVP**; rely on rate limiting (see Security) to prevent abuse. A future ticket can add limits if abuse is observed. |
| 4 | Where does "add recipe to cookbook" live in the UI — from the cookbook page, from the recipe page, or both? | AC only says users can do it; doesn't dictate the entry point. **Assumption: both** — a bulk "Add Recipes" picker on the cookbook detail page (pick many recipes into one cookbook) and a compact "Save to Cookbook(s)" control on the recipe view page (pick/toggle cookbooks for one recipe), reusing the same underlying add/remove endpoints for both. Flag to the user/Developer if this is more than desired for a first pass — the picker-page flow alone would satisfy the literal AC. |
| 5 | Does REW-19 change anything structural here? | Ticket says REW-19 (sharing) is explicitly out of scope but must not be precluded. **Assumption: no sharing columns/tables are added now**; the normalized `cookbooks` + `cookbook_recipes` design and owner-only RLS policies leave room for REW-19 to add a new SELECT policy (or a `cookbook_shares` join table) without altering this migration. |
| 6 | Nav label / page title wording | **Assumption:** navbar link "Cookbooks" (matches the single-word "Liked" convention), page heading "My Cookbooks" (matches "My Recipes"). |

If any of these assumptions are wrong, they're cheap to change before implementation but should be confirmed against the live Jira ticket first (see note above).

## Tasks

1. **Migration: `cookbooks` table** — owner-scoped parent table with title, timestamps, RLS (mirrors `recipes` table pattern minus the "published" public-read policy, since cookbooks have no public state in this ticket).
2. **Migration: `cookbook_recipes` junction table** — many-to-many between `cookbooks` and `recipes`, RLS scoped through both the owning cookbook and the owning recipe (mirrors `recipe_categories` pattern).
3. **Cookbook utility module** (`src/utils/cookbookUtils.js` + co-located `cookbookUtils.test.js`) — pure, unit-testable helpers: title validation/normalization and recipe-id-selection normalization (array vs. single value from form bodies), following the existing `userUtils.js` / `authUtils.js` extraction pattern so this logic is covered by `npm test` even though route handlers themselves aren't unit tested in this codebase.
4. **Cookbook routes** (`src/routes/cookbookRoutes.js`) — list, create, view, rename, delete, and recipe add/remove endpoints, all `requireAuth` + explicit ownership checks (belt-and-suspenders alongside RLS, matching `recipeRoutes.js`).
5. **Register routes** in `src/routes/index.js` — mount `/cookbooks`.
6. **Cookbook views** (`views/cookbooks/index.ejs`, `new.ejs`, `view.ejs`, `edit.ejs`, `add-recipes.ejs`) — list, create form, detail (recipes-in-cookbook + rename/delete controls), rename form, recipe picker.
7. **Recipe view integration** — extend `views/recipes/view.ejs` (owner-only section) and its route handler (`src/routes/recipeRoutes.js` `GET /:id`) to show which of the viewer's cookbooks contain this recipe and offer add/remove controls, reusing the endpoints from task 4.
8. **Navigation** — add a "Cookbooks" link to `views/partials/navbar.ejs` for authenticated users.
9. **Styling** — minor additions to `public/css/styles.css` for the cookbook list/detail cards and the recipe-view "save to cookbook" control, reusing existing card/badge/button classes wherever possible.
10. **Tests** — `src/utils/cookbookUtils.test.js` covering title validation edge cases and recipe-id normalization; note in the plan (task 11) that route-level tests are out of scope per existing repo convention (no other route file has a co-located test — they depend on a live Supabase connection that isn't mocked anywhere in this repo).
11. **Manual/QA verification** against the acceptance criteria below, since automated route coverage doesn't exist for any feature in this codebase yet.

## Affected files

### New files

- `database/migrations/009_create_cookbooks_table.sql` — `cookbooks` table, indexes, RLS, `updated_at` trigger (reuses the existing `update_updated_at_column()` function from `001_create_recipes_table.sql`).
- `database/migrations/010_create_cookbook_recipes_table.sql` — `cookbook_recipes` junction table, indexes, RLS.
- `src/utils/cookbookUtils.js` — `validateCookbookTitle(title)`, `normalizeRecipeIdSelection(input)` (pure functions).
- `src/utils/cookbookUtils.test.js` — unit tests for the above.
- `src/routes/cookbookRoutes.js` — all cookbook page + mutation routes (see Tasks 4 for the endpoint list; detailed below under Database/route design).
- `views/cookbooks/index.ejs` — "My Cookbooks" list page (empty state + grid, modeled on `views/recipes/liked.ejs` / `views/recipes/index.ejs`).
- `views/cookbooks/new.ejs` — create-cookbook form (title only), modeled on `views/recipes/new.ejs` field/CSRF conventions.
- `views/cookbooks/view.ejs` — cookbook detail: title, rename/delete controls (owner-only, matches `views/recipes/view.ejs` owner-action pattern), grid of recipes in the cookbook (reuse `views/partials/recipe-card.ejs` where possible, or a variant with a "Remove from cookbook" action), "Add Recipes" link.
- `views/cookbooks/edit.ejs` — rename form, modeled on `views/recipes/edit.ejs`.
- `views/cookbooks/add-recipes.ejs` — checklist of the user's own recipes (published + draft) with current cookbook membership pre-checked, submits to the bulk-add endpoint.

### Modified files

- `src/routes/index.js` — `import cookbookRoutes from "./cookbookRoutes.js"` and `router.use("/cookbooks", cookbookRoutes)`, placed alongside the existing `router.use("/recipes", recipeRoutes)` block. No path-prefix collision with `/recipes/:id`, so ordering relative to `recipeRoutes` doesn't matter.
- `src/routes/recipeRoutes.js` — in `GET /:id` (and only when `isOwner` is true), fetch the current user's cookbooks and which of them already contain this recipe, and pass that data to `recipes/view.ejs` (same batching approach as the like-status fetch already in this file, to avoid N+1 queries).
- `views/recipes/view.ejs` — add an owner-only "Save to Cookbook(s)" section: badges for cookbooks currently containing the recipe (each with a small "Remove" form) plus a form to add the recipe to another of the user's cookbooks.
- `views/partials/navbar.ejs` — add a "Cookbooks" nav item for authenticated users, following the existing `<% if (user) { %>` block and `currentPath` active-state pattern already used for "My Recipes" / "Liked".
- `public/css/styles.css` — small additions for cookbook cards/badges and the recipe-view cookbook widget; prefer reusing existing `feature-card`, `tag-badge`, `category-badge`, `btn`/`btn-outline` classes over introducing a large new style block.

## Database changes

Two new migrations, continuing the existing `NNN_description.sql` numbering (last migration is `008_create_recipe_likes_table.sql`, so this feature is `009` and `010`).

### `009_create_cookbooks_table.sql`

New `cookbooks` table, modeled directly on `recipes` (`database/migrations/001_create_recipes_table.sql`):

- `id` — UUID PK, `gen_random_uuid()` default.
- `user_id` — UUID, `NOT NULL`, `REFERENCES auth.users(id) ON DELETE CASCADE` (deleting a user's auth record cleans up their cookbooks).
- `title` — `TEXT NOT NULL`, with a `CHECK` constraint requiring non-empty content after trimming (defense in depth alongside app-level validation in `cookbookUtils.js`), matching the style of the existing `difficulty` CHECK constraint on `recipes`.
- `created_at`, `updated_at` — `TIMESTAMPTZ DEFAULT NOW()`; reuse the existing `update_updated_at_column()` trigger function (already defined in migration `001`) via a new `update_cookbooks_updated_at` trigger — do not redefine the function.
- Index on `user_id`.
- `ENABLE ROW LEVEL SECURITY`.
- Policies: **owner-only** SELECT, INSERT (`WITH CHECK auth.uid() = user_id`), UPDATE, DELETE — all scoped to `auth.uid() = user_id`. **Deliberately no public/"published" SELECT policy** — this is what makes cookbooks private by default and structurally blocks other users from viewing them (there is currently no policy under which a non-owner's `auth.uid()` would satisfy any of the four policies). REW-19 (out of scope here) would add sharing by introducing an *additional* SELECT policy (or a join against a future `cookbook_shares` table) — that's an additive change, not a rework of this migration.

### `010_create_cookbook_recipes_table.sql`

New `cookbook_recipes` junction table, modeled on `recipe_categories` (`database/migrations/005_create_recipe_categories_table.sql`):

- `cookbook_id` — UUID, `NOT NULL`, `REFERENCES cookbooks(id) ON DELETE CASCADE`.
- `recipe_id` — UUID, `NOT NULL`, `REFERENCES recipes(id) ON DELETE CASCADE`.
- `created_at` — `TIMESTAMPTZ DEFAULT NOW()`.
- Composite `PRIMARY KEY (cookbook_id, recipe_id)` — same recipe can't be added to the same cookbook twice; naturally supports "recipe belongs to more than one cookbook" (different `cookbook_id` rows) and "cookbook contains multiple recipes" (different `recipe_id` rows).
- Indexes on `cookbook_id` and `recipe_id`.
- `ENABLE ROW LEVEL SECURITY`.
- Policies:
  - SELECT/DELETE: `EXISTS (SELECT 1 FROM cookbooks WHERE cookbooks.id = cookbook_recipes.cookbook_id AND cookbooks.user_id = auth.uid())` — only the cookbook's owner can see or remove its contents.
  - INSERT: the same cookbook-ownership check **and** an additional `EXISTS (SELECT 1 FROM recipes WHERE recipes.id = cookbook_recipes.recipe_id AND recipes.user_id = auth.uid())` check — this is what enforces "add recipes **from their recipes**": a user cannot add someone else's recipe (including another user's published recipe) into their own cookbook at the database layer, not just in application code.
  - No UPDATE policy needed — membership is insert/delete only, same reasoning as `recipe_likes`.

**Cascade behavior to double check in review:** deleting a cookbook (`ON DELETE CASCADE` on `cookbook_id`) removes only `cookbook_recipes` rows, never touches `recipes` — satisfies "delete a cookbook without deleting the recipes." Deleting a recipe (existing `POST /recipes/:id/delete` in `recipeRoutes.js`, unchanged) cascades via `ON DELETE CASCADE` on `recipe_id` and silently removes it from any cookbooks it was in — this is existing, expected junction-table behavior (same as `recipe_categories`/`recipe_tags` today) and should be called out to QA as intentional, not a regression.

## Security considerations

- **Ownership enforcement is double-layered**, matching the existing convention in `recipeRoutes.js`: every cookbook route uses `createSupabaseClient(req.accessToken)` (RLS-enforced) **and** an explicit `.eq("user_id", req.user.id)` filter on cookbook reads/writes, and an explicit recipe-ownership check before inserting into `cookbook_recipes` (not just relying on RLS to silently no-op). A cookbook lookup for another user's ID should behave like the existing "not found" pattern in `recipeRoutes.js` (`GET /recipes/:id/edit`) — flash "not found" and redirect, never leak whether the ID exists but belongs to someone else.
- **Privacy is structural, not just UI-level**: because there is no public/shared SELECT RLS policy on `cookbooks` in this migration, even a direct API/URL guess at another user's `/cookbooks/:id` returns nothing from Supabase regardless of what the route code does — this satisfies "other users cannot view or access a private cookbook" at the data layer, not just by hiding links in the UI.
- **CSRF**: note that CSRF protection is currently disabled repo-wide (`src/app.js`, `doubleCsrfProtection` commented out with a `TODO`) — this is a pre-existing gap, not something to silently fix as part of this ticket. New cookbook forms should still include the `<input type="hidden" name="_csrf" value="<%= csrfToken %>">` field (same as `recipes/view.ejs`, `recipes/index.ejs`) so they're consistent with the rest of the app and require no further changes whenever CSRF is re-enabled. Flag to Reviewer if this ticket is considered high-risk enough to also request CSRF re-enablement — that's a separate decision, not scoped here.
- **Rate limiting**: mutation endpoints (create/rename/delete cookbook, add/remove recipe) should get a limiter analogous to `likeLimiter` in `src/routes/likeRoutes.js` (keyed on `req.user.id`, not IP) to prevent a compromised session or script from spamming cookbook creation or membership churn. Reuse `express-rate-limit`, already a dependency.
- **Input validation**: cookbook title is required, trimmed, and length-capped both in `cookbookUtils.validateCookbookTitle` (unit-testable) and via the DB `CHECK` constraint. EJS's `<%= %>` auto-escapes output, so no additional XSS handling is needed for title rendering, consistent with how `recipe.title` is already rendered elsewhere.
- **No file upload surface** in this feature — multer/sharp/file-type concerns from `recipeRoutes.js` don't apply.
- **UUID validation** on route params (`:id`, `:recipeId`) before querying, mirroring the `UUID_PATTERN` check already used in `likeRoutes.js`, to fail fast on malformed input rather than relying solely on Supabase to reject it.

## Acceptance criteria

Mapped directly to the ticket's AC:

- [ ] An authenticated user can create a new cookbook by submitting a title; the cookbook appears in their "My Cookbooks" list immediately after.
- [ ] Attempting to create a cookbook with a blank/whitespace-only title is rejected with a validation error and no row is created.
- [ ] From a cookbook's detail page, a user can select one or more of their own recipes (draft or published) and add them to the cookbook; all selected recipes appear in the cookbook afterward.
- [ ] A cookbook can contain more than one recipe simultaneously.
- [ ] The same recipe can be added to two or more different cookbooks belonging to the same user, and appears in each independently.
- [ ] A user can remove a recipe from a cookbook (from the cookbook detail page and/or the recipe view page); the recipe itself still exists and is still viewable/editable afterward, and still belongs to any other cookbooks it was in.
- [ ] A user can rename an existing cookbook; the new title is reflected in the list and detail views immediately.
- [ ] A user can delete a cookbook; after deletion, none of the recipes that were in it are deleted, and they remain visible in "My Recipes" and any other cookbooks.
- [ ] A newly created cookbook, and any cookbook with recipes added to it, is not visible to any other user — a second user's session cannot view it via the UI or by directly requesting its URL/ID (verify via RLS: a direct Supabase query as another authenticated user returns no row).
- [ ] Deleting a recipe (existing delete flow) removes it from any cookbooks it belonged to without error, and does not delete the cookbook itself.
- [ ] A user can view a list of all their own cookbooks and open one to see all recipes currently assigned to it.
- [ ] Unauthenticated requests to any `/cookbooks*` route redirect to login (`requireAuth`), consistent with `/recipes*`.
- [ ] Cookbook mutation endpoints are rate-limited per user and reject excessive requests.

## Reference files for the Developer agent

- `database/migrations/001_create_recipes_table.sql` — owner-scoped table + RLS pattern to mirror for `cookbooks`.
- `database/migrations/005_create_recipe_categories_table.sql` — junction table + RLS pattern to mirror for `cookbook_recipes`.
- `database/migrations/008_create_recipe_likes_table.sql` — most recent migration; confirms `009`/`010` are the next available numbers.
- `src/routes/recipeRoutes.js` — route/Supabase-client conventions, ownership-check pattern, categories-array normalization precedent (`saveRecipeCategories`) to mirror in `cookbookUtils.normalizeRecipeIdSelection`.
- `src/routes/likeRoutes.js` — `UUID_PATTERN` validation, per-user rate limiting pattern.
- `src/utils/userUtils.js` + `src/utils/userUtils.test.js` — precedent for extracting small pure helpers out of routes for unit-test coverage.
- `views/recipes/liked.ejs`, `views/recipes/index.ejs` — list-page structure to mirror for `views/cookbooks/index.ejs`.
- `views/partials/navbar.ejs` — nav-link pattern (auth-gated, active-state via `currentPath`) to extend for "Cookbooks".
