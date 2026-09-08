# Implementation Plan: REW-63 Create and Manage Meal Plans

## Jira issue

**[REW-63 — "Create and Manage Meal Plans"](https://wanderingnerds.atlassian.net/browse/REW-63)** (Story, Priority: High, Status: To Do, assignee: Andrew Carroll)

Related: **[REW-26 — "Grocery list generation"](https://wanderingnerds.atlassian.net/browse/REW-26)** (Task, Status: To Do, no description yet). REW-63's AC explicitly requires the Meal Plan data model to support REW-26; this plan treats that as a schema-forward-compatibility constraint, not a request to build grocery lists now (out of scope — no grocery-list routes/views/tables in this plan).

## Confluence page

Created (nested under the [Recipe Website Roadmap](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/8454313/Recipe+Website+Roadmap) page, same placement pattern as the REW-12 File Import feature plan):

**[REW-63: Create and Manage Meal Plans - Feature Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25198593/REW-63+Create+and+Manage+Meal+Plans+-+Feature+Plan)**

Confirmed via `searchConfluenceUsingCql` before creating: no existing page covers meal plans (the only hit for "meal plan" was the Roadmap page's Phase 5 entry, which is a one-line placeholder, not a feature page). This is a new page, not a fork of an existing one.

## Summary

Add "Meal Plans" as a second, purpose-distinct way to group recipes, alongside the Cookbooks feature shipped in REW-62. A meal plan belongs to exactly one user, has a required title and a required start/end date range, and can hold any number of recipes; a single recipe can belong to any number of meal plans (and independently, any number of cookbooks — the two systems don't interact). Users can create, rename/re-date, and delete meal plans (deleting a plan never deletes its recipes), and can add/remove recipes from a plan independently of the recipe's own lifecycle. Meal plans are private to their owner by construction (RLS), never shared/general collections, and structurally distinct from cookbooks (separate tables, separate routes, separate nav item).

The core data/route/security architecture directly mirrors REW-62 Cookbooks (owner-scoped parent table + many-to-many junction table, both RLS-protected; server-rendered EJS pages with POST-redirect handlers). Two things differ from that template, both driven directly by this ticket's AC:

1. **Which recipes can be added.** Cookbooks only let an owner add their own recipes. This ticket requires "Add to Meal Plan" on recipe cards and recipe pages generally — including on `/browse`, `/search`, and `/recipes/liked`, which display other users' published recipes. So `meal_plan_recipes` must allow a user to add **their own recipe (any status) or any other user's *published* recipe** — the same visibility rule already used by `recipe_likes`. This is enforced at the RLS layer, not just in the route handler.
2. **Where the "Add to Meal Plan" action lives.** Cookbooks' only per-recipe entry point was an owner-only widget on the private `/recipes/:id` page, plus a full-page bulk picker reached from the cookbook itself. This ticket requires the action directly on recipe **cards**, which render many-per-page in grids (`browse`, `search`, `liked`) — a full-page redirect per click there is a poor pattern. This plan adds a shared JS-driven modal (reusing the `likes.js` AJAX/fetch pattern and the `import-modal.ejs` static-modal-in-layout pattern, both already in this codebase) backed by a small JSON API, so "Add to Meal Plan" works the same way from a card, the owner recipe page, or the public recipe page, without a full navigation.

Everything else (migrations, RLS shape, ownership double-checks, rate limiting, UUID validation, EJS view structure, nav link) follows the Cookbooks precedent as closely as the above two differences allow.

## Open questions / assumptions

| # | Question | Assumption made (proceeded on this basis) |
|---|----------|---------------------------------------------|
| 1 | Can a user add another user's recipe to their meal plan? | AC says "Add to Meal Plan" on recipe cards/pages generally, and those surfaces show other users' published recipes (unlike Cookbooks, which only ever showed the owner's own recipes). **Assumption: yes, for published recipes only** — mirrors `recipe_likes`' visibility rule exactly. A user's own draft recipes remain plannable too (you can plan to make your own draft). **This is the single biggest structural deviation from the Cookbooks template — flag to the user/PM if the intent was actually "your own recipes only" like Cookbooks; that would simplify `meal_plan_recipes`' RLS to match `cookbook_recipes` exactly.** |
| 2 | How does "Add to Meal Plan" work from a recipe **card** without a full page reload, given cards render many-per-page? | Not dictated by the AC. **Assumption: a shared modal + small JSON API** (detailed in Tasks/Affected files below), reusing two patterns already proven in this codebase (`public/js/likes.js` fetch-based AJAX, `views/partials/import-modal.ejs` static modal-in-layout). **Flag to Developer/Reviewer as a scope decision**: a simpler, lower-effort alternative that mirrors Cookbooks more literally is a full-page picker (`GET /meal-plans/quick-add?recipeId=...`) reached via a plain link from the card — acceptable per the literal AC text but a worse UX for a grid of cards. Proceeding with the modal approach; easy to descope to the simpler page-based flow if effort is a concern. |
| 3 | Does the meal-plan detail page's bulk "Add Recipes" picker need to search across *all* published recipes (any author), or just the owner's own? | Not specified. **Assumption: owner's own recipes only (draft + published)**, exactly like Cookbooks' bulk picker — keeps that page simple and avoids building a cross-user recipe search UI in this ticket. Adding another user's published recipe to a plan is only done via the per-recipe modal (card or recipe page), not the bulk picker. |
| 4 | Does REW-26 (grocery lists) need anything beyond "join meal_plan_recipes to recipes and read `ingredients`"? | Ticket only requires the structure to *support* REW-26, not implement it. **Assumption: add one small forward-compatible column now** — a nullable `planned_servings INTEGER` on `meal_plan_recipes` (no UI to set it in this ticket) — because REW-26 will need a servings count to scale each recipe's ingredients correctly when aggregating a grocery list, and adding it now avoids a future migration purely to backfill it. If the user/PM would rather keep REW-63 strictly to what's specified and let REW-26 add this column itself later, that's a one-line change to migration `012` — flagging so it's a deliberate choice, not a silent addition. |
| 5 | Date semantics — timezone handling, overlapping plans allowed? | Not specified. **Assumption:** plain `DATE` columns (no time-of-day/timezone), `end_date >= start_date` enforced by CHECK constraint, and **no restriction on overlapping date ranges** across a user's meal plans (e.g., a "Week 1" and a "Holiday Baking" plan can both cover the same calendar days) — nothing in the AC suggests plans must be mutually exclusive in time. |
| 6 | URL/nav naming | **Assumption:** route prefix `/meal-plans` (page routes) and `/api/meal-plans` (JSON API), navbar label "Meal Plans", page heading "My Meal Plans" — parallels "Cookbooks"/"My Cookbooks". |
| 7 | Is a recipe's meal-plan membership shown on the card itself (like the cookbook detail page's badges)? | **Assumption: no** — the card button just opens the modal; current membership is fetched on-demand when the modal opens (`GET /api/meal-plans?recipeId=...`), not pre-computed per card. Avoids N+1/heavy per-card queries on `browse`/`search` grid pages that can show many recipes at once. |
| 8 | Day-level assignment within a plan | Explicitly out of scope per the ticket text. Not built. Noted below as the natural extension point (`planned_date`/`day_offset` column on `meal_plan_recipes`) if a future ticket adds it — not created now. |

If any of these are wrong, they're cheap to change before implementation but should be confirmed against the live Jira ticket / PM first, particularly #1 and #2.

## Tasks

1. **Migration: `meal_plans` table** — owner-scoped parent table with title, `start_date`/`end_date`, timestamps, RLS (mirrors `cookbooks`/`recipes` pattern; no public SELECT policy, so private by construction).
2. **Migration: `meal_plan_recipes` junction table** — many-to-many between `meal_plans` and `recipes`, RLS scoped through the owning plan **and** a recipe-visibility check that differs from `cookbook_recipes` (own recipe of any status, OR any published recipe — not owner-only).
3. **Meal plan utility module** (`src/utils/mealPlanUtils.js` + co-located `mealPlanUtils.test.js`) — pure, unit-testable helpers: `validateMealPlanTitle()` (same shape as `cookbookUtils.validateCookbookTitle`), `validateDateRange(startDate, endDate)` (required, parseable, `end >= start`), and recipe-id-selection normalization for the bulk picker. For the last one, **prefer reusing `normalizeRecipeIdSelection` already exported from `src/utils/cookbookUtils.js`** (it's generic UUID-array normalization, not cookbook-specific) rather than duplicating it — flag to Developer as a small refactor opportunity; duplicating it is also acceptable and matches this repo's existing precedent of small per-route-file helper duplication (e.g., `getLikeCount`/`hasUserLiked` are duplicated between `likeRoutes.js` and `recipeRoutes.js` today).
4. **Meal plan page routes** (`src/routes/mealPlanRoutes.js`, mounted at `/meal-plans`) — list, create, view, rename/re-date, delete, bulk add-recipes (own recipes only), single remove-from-detail-page. Structurally mirrors `cookbookRoutes.js`: `requireAuth` + explicit ownership checks alongside RLS.
5. **Meal plan JSON API routes** (`src/routes/mealPlanApiRoutes.js`, mounted at `/api/meal-plans`) — powers the shared "Add to Meal Plan" modal: list the user's plans plus whether each already contains a given `recipeId`, toggle add/remove for a single recipe, and quick-create a new plan. Structurally mirrors `likeRoutes.js`: a local `requireApiAuth` returning JSON 401s (not redirects), per-user rate limiting, JSON responses only.
6. **Register routes** in `src/routes/index.js` — mount `/meal-plans` and `/api/meal-plans`, alongside the existing `cookbookRoutes`/`likeRoutes` mounts.
7. **Meal plan views** (`views/meal-plans/index.ejs`, `new.ejs`, `view.ejs`, `edit.ejs`, `add-recipes.ejs`) — list (title + date range + recipe count), create form (title + start/end date inputs), detail (recipes-in-plan grid + rename/delete controls + remove-from-plan), rename/re-date form, bulk recipe picker. Directly modeled on `views/cookbooks/*.ejs`.
8. **Shared "Add to Meal Plan" modal** (`views/partials/meal-plan-modal.ejs`) — one modal instance included once in the main layout (gated on `user`), listing the current user's meal plans with add/remove toggle actions plus an inline "+ New meal plan" mini-form (title + start/end date), all driven by `public/js/meal-plans.js` against the JSON API from Task 5. Modeled structurally on `views/partials/import-modal.ejs` (static modal markup in the layout, JS wires it up on click) and behaviorally on `public/js/likes.js` (optimistic-ish fetch calls, error toast reuse).
9. **Recipe card integration** — add an "Add to Meal Plan" button to `views/partials/recipe-card.ejs`, gated on `res.locals.user` (available to every view via `optionalAuth` in `src/app.js`, same as `navbar.ejs` already relies on); guests get a login-prompting variant (same pattern as `likes.js`'s `like-btn-guest` handling). No route-handler changes needed anywhere `recipe-card.ejs` is rendered (`browse.ejs`, `search.ejs`, `liked.ejs`) since the modal fetches plan/membership data client-side.
10. **Recipe view page integration** — add the same "Add to Meal Plan" button (opens the shared modal) to both `views/recipes/view.ejs` (owner's private view, `requireAuth`) and `views/recipes/public-view.ejs` (public `/r/:id` view, optional auth). Unlike the Cookbooks widget, this is **not owner-only** — any authenticated viewer of a recipe they're allowed to see (their own, or someone else's published recipe) can plan it. No new server-side data-fetching needed in `recipeRoutes.js`/`publicRoutes.js` for this button itself (modal fetches on open); existing `isOwner`/`user` locals are sufficient to decide whether to render it at all.
11. **Navigation** — add a "Meal Plans" link to `views/partials/navbar.ejs` for authenticated users, alongside "Cookbooks".
12. **Styling** — additions to `public/css/styles.css` for the meal-plan list/detail cards (reuse `feature-card`, `badge-*`, `btn`/`btn-outline` classes, same as Cookbooks) and the new modal (no existing `.modal` class in `styles.css` — `import-modal.ejs` uses inline styles for its modal chrome; follow that same inline-style convention for `meal-plan-modal.ejs` rather than introducing a first `.modal` class, unless Developer prefers to finally extract one now that there'd be two modals).
13. **Tests** — `src/utils/mealPlanUtils.test.js` covering title validation, date-range validation (missing/unparseable/reversed dates), and recipe-id normalization (if not reused from `cookbookUtils`). Route-level tests remain out of scope, consistent with every other Supabase-backed route file in this repo (no live-Supabase test harness exists anywhere).
14. **Manual/QA verification** against the acceptance criteria below — no automated route coverage exists for any feature in this codebase, matching the Cookbooks precedent.

## Affected files

### New files

- `database/migrations/011_create_meal_plans_table.sql` — `meal_plans` table, indexes, RLS, `updated_at` trigger (reuses `update_updated_at_column()` from migration `001`).
- `database/migrations/012_create_meal_plan_recipes_table.sql` — `meal_plan_recipes` junction table, indexes, RLS (own-plan + own-or-published-recipe INSERT check).
- `src/utils/mealPlanUtils.js` — `validateMealPlanTitle(title)`, `validateDateRange(startDate, endDate)`, recipe-id normalization (reused or duplicated per Task 3).
- `src/utils/mealPlanUtils.test.js` — unit tests for the above.
- `src/routes/mealPlanRoutes.js` — page-based meal plan CRUD + bulk add + detail-page remove (see Task 4).
- `src/routes/mealPlanApiRoutes.js` — JSON API backing the modal (see Task 5).
- `views/meal-plans/index.ejs` — "My Meal Plans" list (empty state + grid with title/date-range/recipe-count), modeled on `views/cookbooks/index.ejs`.
- `views/meal-plans/new.ejs` — create form (title + start date + end date), modeled on `views/cookbooks/new.ejs`.
- `views/meal-plans/view.ejs` — detail: title, date range, rename/delete controls, grid of recipes in the plan with "Remove" actions, "Add Recipes" link to the bulk picker. Modeled on `views/cookbooks/view.ejs`.
- `views/meal-plans/edit.ejs` — rename/re-date form, modeled on `views/cookbooks/edit.ejs`.
- `views/meal-plans/add-recipes.ejs` — checklist of the user's own recipes (draft + published) with current plan membership pre-checked, modeled on `views/cookbooks/add-recipes.ejs`.
- `views/partials/meal-plan-modal.ejs` — shared "Add to Meal Plan" modal (plan list + toggle actions + quick-create mini-form), modeled structurally on `views/partials/import-modal.ejs`.
- `public/js/meal-plans.js` — click handling for `.meal-plan-add-btn` (cards + recipe pages), modal open/populate/close, fetch calls against `/api/meal-plans*`, guest login-prompt, error toast reuse — modeled on `public/js/likes.js`.

### Modified files

- `src/routes/index.js` — `import mealPlanRoutes from "./mealPlanRoutes.js"`, `import mealPlanApiRoutes from "./mealPlanApiRoutes.js"`; `router.use("/meal-plans", mealPlanRoutes)` alongside the existing `router.use("/cookbooks", cookbookRoutes)`; `router.use("/api/meal-plans", mealPlanApiRoutes)` alongside `router.use("/api/likes", likeRoutes)`.
- `views/partials/recipe-card.ejs` — add the "Add to Meal Plan" button (Task 9).
- `views/recipes/view.ejs` — add the "Add to Meal Plan" button near the existing like/edit/delete action row (Task 10).
- `views/recipes/public-view.ejs` — add the "Add to Meal Plan" button near the existing like/edit action row (Task 10).
- `views/layouts/main.ejs` — include `partials/meal-plan-modal` (gated on `user`) and add `<script src="/js/meal-plans.js"></script>` alongside the existing script tags.
- `views/partials/navbar.ejs` — add a "Meal Plans" nav item for authenticated users, following the existing `currentPath`-based active-state pattern used for "Cookbooks"/"My Recipes"/"Liked".
- `public/css/styles.css` — meal-plan card/badge styles (reusing `feature-card`, `badge-draft`/`badge-published`, `tag-badge` classes per the Cookbooks precedent) and modal styling for `meal-plan-modal.ejs`.

## Database changes

Two new migrations, continuing the existing `NNN_description.sql` numbering (last are `009`/`010` for Cookbooks, so this feature is `011`/`012`).

### `011_create_meal_plans_table.sql`

New `meal_plans` table, modeled directly on `cookbooks` (`database/migrations/009_create_cookbooks_table.sql`) with the added date-range fields the ticket requires that cookbooks don't have:

- `id` — UUID PK, `gen_random_uuid()` default.
- `user_id` — UUID, `NOT NULL`, `REFERENCES auth.users(id) ON DELETE CASCADE`.
- `title` — `TEXT NOT NULL`, `CHECK (length(trim(title)) > 0)` (defense in depth alongside `mealPlanUtils.validateMealPlanTitle`), same style as `cookbooks.title`.
- `start_date` — `DATE NOT NULL`.
- `end_date` — `DATE NOT NULL`.
- `CHECK (end_date >= start_date)` — defense in depth alongside `mealPlanUtils.validateDateRange`.
- `created_at`, `updated_at` — `TIMESTAMPTZ DEFAULT NOW()`; reuse `update_updated_at_column()` (already defined in migration `001`) via a new `update_meal_plans_updated_at` trigger.
- Index on `user_id`; consider a secondary index on `(user_id, start_date)` to support a future "upcoming/past plans" sort on the list page cheaply.
- `ENABLE ROW LEVEL SECURITY`.
- Policies: **owner-only** SELECT, INSERT (`WITH CHECK auth.uid() = user_id`), UPDATE, DELETE — identical shape to `cookbooks`. **Deliberately no public/shared SELECT policy** — this is what makes meal plans private by construction, matching "Meal Plans are private to the user who created them" in the AC.

### `012_create_meal_plan_recipes_table.sql`

New `meal_plan_recipes` junction table, modeled on `cookbook_recipes` (`database/migrations/010_create_cookbook_recipes_table.sql`) **with a different INSERT visibility rule**, since this ticket allows planning recipes you don't own (unlike cookbooks):

- `meal_plan_id` — UUID, `NOT NULL`, `REFERENCES meal_plans(id) ON DELETE CASCADE`.
- `recipe_id` — UUID, `NOT NULL`, `REFERENCES recipes(id) ON DELETE CASCADE`.
- `planned_servings` — `INTEGER`, nullable, `CHECK (planned_servings IS NULL OR planned_servings > 0)`. **Forward-compat column for REW-26** (see Open Questions #4) — no route/view in this ticket writes to it; it exists so grocery-list generation can later know "scale this recipe's ingredients to N servings for this plan" without a further migration. If the user/PM prefers strict scope, drop this column from the migration.
- `created_at` — `TIMESTAMPTZ DEFAULT NOW()`.
- Composite `PRIMARY KEY (meal_plan_id, recipe_id)` — same recipe can't be added to the same plan twice; naturally supports "recipe belongs to multiple plans" (different `meal_plan_id` rows) and "plan holds multiple recipes" (different `recipe_id` rows).
- Indexes on `meal_plan_id` and `recipe_id`.
- `ENABLE ROW LEVEL SECURITY`.
- Policies:
  - SELECT/DELETE: `EXISTS (SELECT 1 FROM meal_plans WHERE meal_plans.id = meal_plan_recipes.meal_plan_id AND meal_plans.user_id = auth.uid())` — only the plan's owner can see or remove its contents. Identical shape to `cookbook_recipes`.
  - **INSERT (the key structural difference from Cookbooks):** the same plan-ownership check, **plus** a recipe-visibility check that allows either the user's own recipe (any status) or any published recipe regardless of owner: `EXISTS (SELECT 1 FROM meal_plans WHERE meal_plans.id = meal_plan_recipes.meal_plan_id AND meal_plans.user_id = auth.uid()) AND EXISTS (SELECT 1 FROM recipes WHERE recipes.id = meal_plan_recipes.recipe_id AND (recipes.user_id = auth.uid() OR recipes.status = 'published'))`. This mirrors the *visibility* semantics already implicit in `recipe_likes` (which allows liking any published recipe by any author) rather than `cookbook_recipes`' *ownership* semantics (which allows only your own recipes) — a deliberate, ticket-driven divergence from the structural template, called out in Summary/Open Questions.
  - No UPDATE policy needed for membership rows, same reasoning as `recipe_likes`/`cookbook_recipes` — except if `planned_servings` is added and ever becomes user-editable, that would need an UPDATE policy scoped the same way as SELECT/DELETE. Not needed for this ticket since nothing writes `planned_servings` yet.

**Cascade behavior to double check in review:** deleting a meal plan (`ON DELETE CASCADE` on `meal_plan_id`) removes only `meal_plan_recipes` rows, never touches `recipes` — satisfies "deleting a meal plan does not delete any recipes." Deleting a recipe cascades via `ON DELETE CASCADE` on `recipe_id` and silently removes it from any meal plans (and cookbooks) it was in — existing, expected junction-table behavior, should be called out to QA as intentional, not a regression, exactly as it was for Cookbooks.

**No changes to `database/schema.sql`** — confirmed the Cookbooks migrations (`009`/`010`) were never back-ported into `schema.sql` either; the repo's convention is that `database/migrations/*.sql` is the source of truth going forward and `schema.sql` is not kept in sync per-feature.

## Security considerations

- **Ownership enforcement is double-layered**, matching `cookbookRoutes.js`/`recipeRoutes.js` convention: every `/meal-plans*` and `/api/meal-plans*` route uses `createSupabaseClient(req.accessToken)` (RLS-enforced) **and** an explicit `.eq("user_id", req.user.id)` filter on plan reads/writes. A plan lookup for another user's ID behaves like the existing "not found" pattern — flash/JSON "not found," never leak whether the ID exists but belongs to someone else.
- **Recipe-visibility enforcement is double-layered and intentionally different from Cookbooks:** both the page routes and the JSON API must check "is this recipe either mine, or published?" before inserting into `meal_plan_recipes`, in addition to the RLS INSERT policy performing the same check server-side. A user cannot add another user's *draft* recipe to their plan even if application code were buggy, because the RLS policy enforces it independently — this needs explicit test coverage in QA (see Acceptance Criteria) since it's the one place this feature's authorization rule is *not* "owner only," unlike everything else in the app that touches user-generated content (cookbooks, likes are the closest precedent, not recipes/categories/tags).
- **Privacy is structural, not just UI-level:** because there is no public/shared SELECT RLS policy on `meal_plans`, a direct API/URL guess at another user's `/meal-plans/:id` (or `/api/meal-plans/:id/...`) returns nothing from Supabase regardless of route code — satisfies "Meal Plans are private to the user who created them" at the data layer.
- **CSRF:** CSRF protection is currently disabled repo-wide (`src/app.js`, `doubleCsrfProtection` commented out, `res.locals.csrfToken` hard-coded to `''`) — pre-existing gap, not introduced or fixed here. Page-based forms (`views/meal-plans/*.ejs`, detail-page remove/rename/delete) should still include the `<input type="hidden" name="_csrf" ...>` field for consistency with the rest of the app, same as Cookbooks. **The new JSON API (`mealPlanApiRoutes.js`) driven by `fetch()` from `meal-plans.js` has no CSRF-token mechanism at all today** (same as `likeRoutes.js`'s existing JSON endpoints, which have the identical gap) — flag to Reviewer that when CSRF is eventually re-enabled repo-wide, both `likeRoutes.js` and the new meal-plan API routes will need the client JS updated to read a token (e.g., from a `<meta>` tag) and send it as a header, since JSON fetch requests can't use the hidden-form-field pattern.
- **Rate limiting:** both the page-route mutations (`mealPlanLimiter`, mirroring `cookbookLimiter`: 30/min per `req.user.id`) and the JSON API mutations (`mealPlanApiLimiter`, mirroring `likeLimiter`: 30/min per `req.user.id`) should use `express-rate-limit`, already a dependency.
- **Input validation:** title required/trimmed/length-capped (`validateMealPlanTitle`, mirrors `validateCookbookTitle`'s 200-char cap) both in `mealPlanUtils.js` (unit-tested) and via DB `CHECK`. Date range required, parseable, `end >= start` (`validateDateRange`, unit-tested) both in `mealPlanUtils.js` and via DB `CHECK`. EJS `<%= %>` auto-escapes output, so no extra XSS handling needed for title rendering.
- **UUID validation** on all route params (`:id`, `:recipeId`) and the `recipeId` query param on `GET /api/meal-plans`, mirroring the `UUID_PATTERN` checks already used in `likeRoutes.js`/`cookbookRoutes.js`, before any query runs.
- **No new file-upload surface** — multer/sharp/file-type concerns don't apply to this feature.
- **`requireApiAuth` for the JSON API** returns a `401 { error }` JSON body rather than redirecting, matching `likeRoutes.js`'s existing local `requireApiAuth` helper (checks the `sb-access-token` cookie directly) — duplicate that small helper in `mealPlanApiRoutes.js` rather than trying to share it, consistent with this repo's existing per-route-file helper convention.

## Acceptance criteria

Mapped directly to the ticket's AC:

- [ ] An "Add to Meal Plan" control is visible on recipe cards (`/browse`, `/search`, `/recipes/liked`) for authenticated users; unauthenticated visitors see a control that prompts login rather than silently failing.
- [ ] An "Add to Meal Plan" control is visible on an individual recipe page, both the owner's `/recipes/:id` view and the public `/r/:id` view, for any authenticated viewer (not owner-restricted).
- [ ] Clicking "Add to Meal Plan" presents the user's existing meal plans (selectable) and an option to create a new meal plan, without a full page navigation.
- [ ] A user can create a new meal plan by submitting a title and a start/end date; a blank/whitespace-only title, a missing date, or an end date before the start date is rejected with a validation error and no row is created.
- [ ] A newly created meal plan appears in the user's "My Meal Plans" list immediately.
- [ ] A user can add more than one recipe to the same meal plan (via the modal from multiple cards/pages, and/or the bulk picker on the plan's own detail page).
- [ ] The same recipe can be added to two or more of the user's meal plans and appears in each independently.
- [ ] A user can add one of their own recipes (draft or published) to a meal plan.
- [ ] A user can add another user's *published* recipe to their own meal plan.
- [ ] A user **cannot** add another user's *draft/unpublished* recipe to a meal plan — verified at the RLS layer (a direct insert attempt as another authenticated user is rejected by Postgres, not just blocked in the UI).
- [ ] A user can remove a recipe from a meal plan (from the plan detail page and from the modal); the recipe itself still exists and is still viewable/editable afterward, and remains in any other meal plans or cookbooks it belonged to.
- [ ] A user can rename an existing meal plan and/or change its date range; changes are reflected in the list and detail views immediately.
- [ ] A user can delete a meal plan; after deletion, none of the recipes that were in it are deleted, and they remain visible in "My Recipes," any cookbooks, and any other meal plans.
- [ ] A meal plan (and any recipes added to it) is not visible to any other user — a second user's session cannot view it via the UI or by directly requesting its URL/ID (verified via RLS: a direct query as another authenticated user returns no row).
- [ ] Deleting a recipe (existing delete flow) removes it from any meal plans it belonged to without error, and does not delete the meal plan itself.
- [ ] A user can view a list of all their own meal plans (title, date range, recipe count) and open one to see all recipes currently assigned to it.
- [ ] Unauthenticated requests to any `/meal-plans*` page route redirect to login, consistent with `/recipes*`/`/cookbooks*`.
- [ ] Unauthenticated requests to any `/api/meal-plans*` JSON route return `401` JSON rather than redirecting, consistent with `/api/likes*`.
- [ ] Meal plan mutation endpoints (both page routes and JSON API routes) are rate-limited per user and reject excessive requests.
- [ ] The schema supports REW-26 without further migration: for a given meal plan, all of its recipes (and their ingredient data) can be retrieved in a single join query against `meal_plan_recipes` → `recipes`.

## Reference files for the Developer agent

- `database/migrations/009_create_cookbooks_table.sql`, `010_create_cookbook_recipes_table.sql` — direct structural template for the two new migrations; read the divergence in `012`'s INSERT policy carefully before copying.
- `database/migrations/008_create_recipe_likes_table.sql` — precedent for the "own recipe OR published" visibility rule needed in `meal_plan_recipes`' INSERT policy (see `recipeExists()` in `likeRoutes.js` for the app-layer equivalent check).
- `src/routes/cookbookRoutes.js`, `src/utils/cookbookUtils.js` — template for `mealPlanRoutes.js`/`mealPlanUtils.js` (page-based CRUD, ownership double-checks, rate limiting, UUID validation).
- `src/routes/likeRoutes.js` — template for `mealPlanApiRoutes.js` (`requireApiAuth`, JSON 401s, per-user rate limiting, `UUID_PATTERN` validation).
- `src/app.js` (`optionalAuth`, `res.locals.user`) — confirms `user` is available in every EJS render, including partials like `recipe-card.ejs`, without extra plumbing.
- `views/cookbooks/*.ejs` — template for `views/meal-plans/*.ejs`.
- `views/partials/import-modal.ejs` — template for `views/partials/meal-plan-modal.ejs` (static modal markup included once in the layout, wired up by JS on click; note it uses inline styles, not a `.modal` CSS class).
- `public/js/likes.js` — template for `public/js/meal-plans.js` (fetch-based mutations, optimistic-ish UI updates, guest login prompt, error toast reuse).
- `views/recipes/view.ejs` (Save to Cookbook(s) widget), `views/recipes/public-view.ejs` — insertion points for the new "Add to Meal Plan" button; note `public-view.ejs` already has a `user`-gated vs. guest-gated pattern for its like button that the meal-plan button should copy.
- `views/partials/recipe-card.ejs` — insertion point for the card-level button; note it currently renders no per-recipe auth-gated actions at all, so this is the first one.
- `views/partials/navbar.ejs` — nav-link pattern (`currentPath`-based active state) to extend for "Meal Plans".
- `docs/plans/rew-62-cookbooks.md`, `docs/api/cookbooks.md` — the REW-62 plan and its post-implementation API doc; useful for the Developer's own `docs/api/meal-plans.md` (not required by this plan, but matches established repo convention of documenting new route files under `docs/api/`).
