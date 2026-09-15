# REW-69: Add Meal Plan Sharing

> **Planned 2026-09-14**, against the working tree at commit `8488f55`. Every file path, migration number, RLS policy, helper name, CSS class, and existing-test assertion referenced below was re-verified against the repo as it stands today, after REW-19 (cookbook sharing) merged in `32caeb9`.

## Jira issue

**[REW-69 — Add Meal Plan Sharing](https://wanderingnerds.atlassian.net/browse/REW-69)** (Task, Medium, status **To Do**, labels `QA-findings` + `enhancement`, parent epic REW-2 "Phase 2 — Core Recipe Organization & Import")

The ticket exists — the Developer does **not** need to create one.

Tickets whose merged code this plan builds directly on:

- **REW-19 — Cookbook Sharing** (Done, `32caeb9`). This plan is a deliberate, close mirror of it: `019_add_cookbook_sharing.sql`, `POST /cookbooks/:id/visibility`, `GET /c/:id`, `views/cookbooks/public-view.ejs`, `public/js/cookbook-share.js`, `src/views/cookbookSharing.test.js`, `src/routes/cookbookVisibilityRoutes.test.js`. **Read those seven files before writing anything.**
- **REW-92** (the QA finding folded into `019`). It established that gating a public junction-table policy on the *parent* row alone is insufficient — the membership edge itself leaks `recipe_id`/`created_at` for the owner's Private recipes over a direct anon PostgREST read. Migration `020` must not repeat that mistake. `src/routes/publicRoutes.test.js` already pins this for cookbooks and must get the equivalent assertion for meal plans.
- **REW-63 — Create and Manage Meal Plans** (`011_create_meal_plans_table.sql`, `012_create_meal_plan_recipes_table.sql`). Migration `011`'s header states meal plans are "structurally private at the RLS layer" with "deliberately NO public/shared SELECT policy." That comment becomes stale with this ticket; `020` adds exactly one additive SELECT policy per table and leaves `011`/`012` untouched on disk.
- **REW-85 — Private/Public recipe visibility** (`src/utils/recipeVisibility.js`). Source of the app-wide Private/Public vocabulary and the `name="visibility"` / `value="private|public"` form convention this ticket must follow.

Related tickets the Developer should be aware of but **must not** implement here:

- **REW-89 — Standardize Meal Plan Recipe Card Content & Actions** (To Do). It will also edit `views/meal-plans/view.ejs`. Expect a merge conflict in that file's card markup if both are in flight; this ticket only touches that template's header/action row and adds a share panel, not the card bodies.
- **REW-91 — Save a shared cookbook to your own account** (To Do). The meal-plan equivalent ("copy this shared plan into my account") is **out of scope** here, same as cookbook cloning was out of scope for REW-19.

## Confluence page

Existing meal-plan feature page, **updated in place** (not forked):
**[Meal Plans (REW-63, REW-69)](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25198593)** — a "REW-69: Meal Plan Sharing (planned)" section has been added, mirroring how the [Cookbooks (REW-62, REW-19)](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25067521) page was extended for REW-19. While editing it I also corrected a factually wrong line in its Security section (it claimed "CSRF protection is disabled repo-wide" — it is not; see Security consideration #4 below).

## Summary

Give a meal plan owner one explicit, reversible **Private ↔ Public** choice, using exactly the interaction REW-19 established for cookbooks. Making a meal plan Public makes it readable by anyone at `GET /m/:id` — the plan's own UUID is the share identifier, matching `/r/:id` for recipes and `/c/:id` for cookbooks. The shared page renders the plan's title, its scheduled date range, and its recipes as read-only cards. Flipping back to Private revokes the link on the very next request, because visibility is re-read from Postgres on every request and never cached.

The whole mechanism is one new boolean column (`meal_plans.is_public`) plus two additive RLS SELECT policies. No `meal_plan_shares` table, no share tokens, no per-user grants, no email invites.

**The privacy-critical design point — Private recipes must never leak through a shared plan.** A meal plan can contain the owner's Private (draft) recipes; REW-63 deliberately made plan membership independent of publish status. The defence is structural, not a filter someone can forget:

- `GET /m/:id` and its recipe fetch use the **anon-key `supabase` client** exported from `src/config/supabase.js` — never `createSupabaseClient(req.accessToken)`, never `req.cookies["sb-access-token"]`, even when the owner is the one viewing.
- Under the anon key `auth.uid()` is null, so the `recipes` SELECT policies from `001_create_recipes_table.sql` (`auth.uid() = user_id` OR `status = 'published'`) return published rows only. A Private recipe in a Public plan is invisible at the database layer regardless of what the handler does.
- The new `meal_plan_recipes` SELECT policy additionally requires the joined recipe to be `published`, so even a raw anon PostgREST read of the junction table cannot count or enumerate the owner's Private recipes (the REW-92 lesson).
- An explicit `status = 'published'` predicate in application code is defence in depth only, mirroring `GET /r/:id` and `GET /c/:id`.

Deliberate consequence: a Public meal plan containing only Private recipes renders as an empty plan to visitors. That is correct, and it gets its own empty state and its own acceptance criterion (AC6).

**Second privacy note unique to meal plans:** `meal_plan_recipes` rows can point at *other users'* published recipes (REW-63's divergence from cookbooks). Those are already world-readable at `/r/:id`, so surfacing them on a shared plan exposes nothing new. But it means the shared page is not "the owner's recipes" — card attribution (`recipe.author`) matters more here than it did for cookbooks.

## Open questions / assumptions

All of the following are **assumptions I proceeded on**, not blockers. Raise any with the user before implementation only if you disagree.

1. **Share link only — no search discoverability.** *(This is the one place this plan deliberately diverges from REW-19.)* For cookbooks, Public meant both linkable and surfaced in `/search`. A meal plan is a time-boxed personal schedule ("Week of Sept 20"), not browsable content; indexing strangers' meal plans into a recipe search would be noise for searchers and a privacy surprise for owners, and the ticket asks only that "another person can easily see what meals are planned." **Assumption: no `search_meal_plans` RPC, no `tsvector` column, no GIN/trigram index, no changes to `views/recipes/search.ejs` or `GET /search`.** If the user wants discoverability later it is a straightforward follow-up migration modeled on `search_cookbooks` — but it should be its own ticket with its own privacy decision. **Confirm this with the user if there is any doubt; it is the largest scope judgement in this plan.**
2. **No share token or slug.** Same reasoning as REW-19: the bare UUIDv4 is not enumerable, and a token would double the surface area for no gain when there is no separate "searchable" axis to revoke independently.
3. **The shared page is read-only for everyone, including the owner.** No `isOwner` branch anywhere in the template or the handler, so there is no owner-only path to get wrong and no reason for the handler to construct an owner-scoped client.
4. **No owner attribution at the plan level.** Same constraint REW-19 hit: `getAccountDisplayName()` in `src/utils/userUtils.js` reads `user_metadata` off a Supabase *auth user object* and can only describe the current viewer; the anon client cannot read another account's `auth.users` row. Per-recipe `recipe.author` still renders on each card.
5. **No grocery list on the shared page.** `/meal-plans/:id/grocery-list` stays owner-only behind `requireAuth`. Not requested; a plausible follow-up ticket.
6. **No day-level/meal-slot organization is rendered, because none exists.** The ticket's "any meal/date organization already supported by the Meal Plan feature" resolves today to exactly two things: the plan-level `start_date`/`end_date` range, and the recipe list ordered by when each recipe was added (`meal_plan_recipes.created_at DESC`). There is no `planned_date`, no day offset, and no meal slot in `012_create_meal_plan_recipes_table.sql` — REW-63 explicitly deferred that. **Do not add per-day assignment in this ticket**; if the user actually expects a day-by-day grid, that is a separate ticket that must land before this one is meaningful to them. Worth a one-line confirmation with the user.
7. **A new `public/js/meal-plan-share.js` rather than generalizing `public/js/cookbook-share.js`.** Generalizing to a shared `/js/share-link.js` is cleaner in the abstract, but it would edit a file that shipped hours ago and would require rewriting three assertions in `src/views/cookbookSharing.test.js` that pin the cookbook script's path and contents. A ~45-line near-copy is the lower-risk trade, and matches the repo's stated tolerance for small per-feature duplication (see the comment above `.meal-plan-count-badge` in `public/css/styles.css`). If the user prefers one shared script, that's a fine call — say so before implementation, not after.
8. **A Public marker on the meal plan list page** (`views/meal-plans/index.ejs`) is included so an owner can see at a glance which plans are shared, matching what REW-19 did for `views/cookbooks/index.ejs`.
9. **No new index.** REW-19 added a partial `created_at` index because public cookbooks are listed and searched. The only query against a public meal plan is `id = ? AND is_public = true`, which the primary key already serves. Adding an unused partial index would be cargo-culting.

## Tasks

### 1. `database/migrations/020_add_meal_plan_sharing.sql` (new)

**The next free migration number is `020`.** The current head on disk is `019_add_cookbook_sharing.sql`. Do **not** edit `011`, `012`, or any other applied migration. (The repo already contains two files prefixed `003_`; do not repeat that — `020` must be unique.)

One additive migration. Contents, described (no SQL here — model it line-for-line on `019_add_cookbook_sharing.sql`):

- Add `is_public` to `meal_plans`: boolean, `NOT NULL`, default `false`, added `IF NOT EXISTS`. Every plan that existed before this migration is therefore Private afterwards, with no backfill — this is what satisfies "private by default."
- **No new index, no search vector, no `pg_trgm` usage** — see assumption 9.
- A new **additive SELECT policy on `meal_plans`** allowing any row where `is_public = true`, declared explicitly `TO anon, authenticated` (the style used by `013` and `019`; `011` omits `TO` clauses). The four owner-only policies from `011` must be left exactly as they are — no `DROP POLICY`, no `ALTER POLICY`. Permissive policies are OR'd, so the owner keeps full visibility of their own plans.
- A new **additive SELECT policy on `meal_plan_recipes`**, also `TO anon, authenticated`, requiring **both**:
  1. an `EXISTS` subquery proving the parent `meal_plans` row is `is_public = true`, **and**
  2. an `EXISTS` subquery proving the joined `recipes` row is `status = 'published'`.

  These must be `AND`-ed, never `OR`-ed. Condition (2) is the REW-92 lesson: the membership row itself carries `recipe_id`, `planned_servings`, and `created_at`, so gating on the parent plan alone would let an anon read of `/rest/v1/meal_plan_recipes?meal_plan_id=eq.<public_id>&select=recipe_id,created_at` disclose the count, UUIDs, and add-times of the owner's Private recipes even though the recipe rows themselves stay hidden. No RLS recursion risk: `meal_plan_recipes` policies reference `meal_plans` and `recipes`; neither of those references `meal_plan_recipes`.
- **Explicit `GRANT SELECT` on `meal_plans` and `meal_plan_recipes` to `anon` and `authenticated`**, matching `003`/`013`/`019` rather than relying on Supabase default privileges. RLS above remains the row-visibility boundary; the grant only permits the read to be attempted.
- **No new UPDATE policy anywhere.** "Users can update own meal plans" from `011` already covers an owner writing a new column on a row they can already update. Membership stays insert/delete only.
- **No change to `recipes`** — no `ALTER TABLE`, no `CREATE POLICY ... ON recipes`, no `GRANT ... ON recipes`. The published/owner SELECT policy from `001` is precisely the mechanism relied on for Private-recipe privacy and must not be touched.
- A header comment naming REW-69, explaining the anon-client privacy model, explicitly noting that it supersedes the "deliberately NO public/shared SELECT policy" comment in `011`, and a **ROLLBACK** block (drop the two policies, drop the column) — matching the header conventions in `009`, `011`, and `019`.

### 2. `src/utils/mealPlanUtils.js` — visibility normalizer

Add one small pure helper, `normalizeMealPlanVisibility`, plus an exported frozen `MEAL_PLAN_VISIBILITY` constant (`{ PRIVATE: "private", PUBLIC: "public" }`), directly mirroring `normalizeCookbookVisibility` / `COOKBOOK_VISIBILITY` in `src/utils/cookbookUtils.js`.

It maps the exact string `"public"` → `true` and **everything else** → `false`: `"private"`, `undefined`, `null`, `""`, `"PUBLIC"`, `"true"`, `"published"`, `["public"]` (duplicate form fields arrive as an array), objects, numbers. Fail closed to Private, so a malformed or forged submission can never accidentally share a plan. Keep it in `mealPlanUtils.js` alongside `validateMealPlanTitle` / `validateDateRange`, which is that file's stated role.

### 3. `src/routes/mealPlanRoutes.js` — visibility endpoint

Add `POST /meal-plans/:id/visibility`, placed immediately after the existing `POST /:id/update` handler. There is no routing conflict with the catch-all `GET /:id` (different methods), but keep it there for readability.

- Export the handler as `handleMealPlanVisibilityUpdate(req, res, { createClient = createSupabaseClient } = {})` and mount it with a thin arrow wrapper, **exactly** as `handleCookbookVisibilityUpdate` is exported and mounted in `src/routes/cookbookRoutes.js`. This is what makes Task 8's unit test possible; `mealPlanRoutes.js` has no named exports today, so this is the file's first one.
- Middleware chain must be `requireAuth`, then the **existing `mealPlanLimiter`** (30/min, keyed on `req.user.id`) already defined at the top of the file. Do not add a new limiter. Do confirm the limiter is actually in the chain — it is easy to omit on a new route, and Task 8 asserts a chain length of 3.
- Screen `:id` against the file's existing `UUID_PATTERN` **before** touching the database, and redirect to `/meal-plans` with a generic "Meal plan not found" flash on failure — matching every other handler in this file.
- Read `req.body.visibility` (values `private`/`public`, the REW-85 convention) and normalize through Task 2's helper. Do **not** accept a raw `isPublic=true|false`.
- Update with an explicit `.eq("id", id).eq("user_id", req.user.id).select().maybeSingle()`. Belt-and-suspenders alongside RLS; this is the codebase's stated convention (see the comment on `POST /:id/update`), so do not drop the application filter on the grounds that RLS covers it. A missing row and a non-owned row must be indistinguishable to the caller.
- Distinguish the two failure modes *in logging only*: a genuine `error` gets `console.error`; a legitimate not-found (`data === null`, `error === null`) must **not** be logged as a database failure. Both produce the identical user-facing flash. `cookbookRoutes.js` does exactly this and `cookbookVisibilityRoutes.test.js` pins it.
- Flash + redirect to `/meal-plans/:id`. Suggested copy: *"This meal plan is now Public. Anyone with the link can view it."* / *"This meal plan is now Private. Its share link no longer works."* Use Private/Public, never draft/published/shared-with.

Also, in the existing **`GET /:id`** handler (bottom of the file), pass `appUrl: getAppUrl()` into the render locals, importing `getAppUrl` from `../utils/authUtils.js` — the same one-line change `cookbookRoutes.js` made. Never derive the origin from `req.headers.host` / `X-Forwarded-Host`.

### 4. `src/routes/publicRoutes.js` — public meal plan view

This file opens with *"Every route here is public. We deliberately use the anon-key client…"*. Honor that literally.

Add `GET /m/:id` (verified free: this file defines only `/search`, `/browse`, `/r/:id`, `/c/:id`, and `publicRoutes` is mounted at `/` in `src/routes/index.js`, so no registration change is needed there).

- Screen `:id` with the file's existing `UUID_PATTERN`; a malformed id returns the generic not-found immediately.
- Fetch the plan through the module-level anon `supabase` client, selecting only `id, title, start_date, end_date` and filtering on `id` **and** `is_public = true`. Do not `select("*")` — `user_id` has no business being handed to the template.
- If the row is missing **or** private, call the file's existing `renderNotFound(res, …)` with **one** message covering both cases (suggest: *"That meal plan doesn't exist or isn't shared."*). Do not run any second query on the not-found branch — a private plan's existence must never be distinguishable from a nonexistent one, including by timing or by a stray membership query.
- Fetch its recipes via a new module-local `getPublicMealPlanRecipes(mealPlanId)` helper placed just above the route, modeled on the existing `getPublicCookbookRecipes`. It must:
  - run on the anon `supabase` client only,
  - select from `meal_plan_recipes` filtered on `meal_plan_id`, with an **inner-join embed** `recipes!inner(id, title, author, prep_time, cook_time, servings, difficulty, thumbnail_url, created_at)` so membership rows whose recipe is RLS-invisible are dropped rather than returned with a null embed,
  - additionally apply `.eq("recipes.status", "published")` as defence in depth,
  - order by the junction row's `created_at` descending, matching the owner view's ordering in `getMealPlanRecipes`,
  - defensively `.filter(Boolean)` the mapped embeds (delete-race guard, same as the existing helpers),
  - log and return `[]` on error.
  - Do **not** export and reuse `getMealPlanRecipes` from `mealPlanRoutes.js` — it is module-private and takes an owner-scoped client, and it selects `status`, which the public page has no use for.
- Render `views/meal-plans/public-view.ejs` with `{ title, mealPlan, recipes }`. Construct no owner-scoped client anywhere in this handler, not even to detect ownership.

### 5. `views/meal-plans/public-view.ejs` (new)

Read-only rendering of a Public meal plan. Model it on `views/cookbooks/public-view.ejs`, including its leading EJS comment explaining why there is no `isOwner` branch.

- Header: plan title, the date range, and the visible recipe count. **Render the date range with the exact same expression the owner view uses** — `new Date(mealPlan.start_date + 'T00:00:00').toLocaleDateString()` … `end_date` — so owner and visitor see identical formatting. (`start_date`/`end_date` arrive from Supabase as `YYYY-MM-DD` strings; the `T00:00:00` suffix is what stops the value drifting a day under timezone parsing.)
- Recipes: **reuse `views/partials/recipe-card.ejs`** inside a `<div class="organization-card-grid">`. Verified to fit: it needs only `id/title/thumbnail_url/prep_time/cook_time/servings/author/categories/description`, links to `/r/<id>`, and already branches on `user` for its "+ Meal Plan" button (the modal partial and `/js/meal-plans.js` are wired up globally in `views/layouts/main.ejs` for signed-in viewers). This is the same partial `views/cookbooks/public-view.ejs` uses.
- A "Shared meal plan" badge in the header, using the new `meal-plan-visibility-badge meal-plan-visibility-public` classes from Task 9.
- **No** edit, delete, rename, re-date, add-recipes, remove-from-plan, or grocery-list affordance — **for anyone, including the owner opening their own share link**. No `<form>`, no `_csrf`, no `isOwner`, no `csrfToken` reference anywhere in the file.
- Empty state required, and it must not leak that hidden recipes exist: something like *"This meal plan doesn't include any Public recipes yet."* No "n recipes hidden" counter, no placeholder cards.
- Optional (not an AC): the signed-out sign-up CTA block from `views/cookbooks/public-view.ejs`.
- Add this file to the `organizationViews` list in `src/views/organizationCardGrid.test.js` (Task 8) — that test pins the shared grid class across every organization view.

### 6. `views/meal-plans/view.ejs` — owner control + share link

- Add a visibility control to the existing action row (which currently holds Add Recipes / Grocery List / Edit / Delete Meal Plan), posting to `/meal-plans/<%= mealPlan.id %>/visibility` with a real `_csrf` hidden field **and** a `visibility` hidden field carrying `private`/`public`. Copy the structure of the `cookbook-visibility-control` form in `views/cookbooks/view.ejs`: when the plan is Public, show a Public badge + `visibility=private` + a "Make Private" button; when Private, the mirror image.
- When `mealPlan.is_public` is true, show the full share URL `<%= appUrl %>/m/<%= mealPlan.id %>` in a readonly input with a **Copy link** button and an `aria-live` feedback span, inside a `meal-plan-share-panel` with `data-meal-plan-share*` hooks.
- **Guard the new locals with `typeof`.** Both `src/views/recipeCard.test.js` (~line 153) and `src/views/groceryList.test.js` (~line 26) render this template directly with only `{ mealPlan, recipes, user, csrfToken }`. A mandatory `appUrl` local, or an unguarded `mealPlan.is_public`, breaks both. Use `<% if (mealPlan.is_public && typeof appUrl !== 'undefined' && appUrl) { %>` for the panel, and treat a missing `is_public` as false for the control.
- **Terminology collision.** `src/views/recipeVisibility.test.js` asserts this file contains `>Private</span>` and contains neither `>Draft</span>` nor `>Published</span>`. Those assertions target the **per-recipe** badges already on each card (`badge-draft badge-draft-sm` / `badge-published badge-published-sm`). The new **plan-level** control must also use Private/Public wording but must be visually and structurally distinct — a labelled control in the header row, with its own `meal-plan-visibility-*` classes, never reusing the per-recipe badge classes — so "this plan is Public" cannot be misread as "this recipe is Public."
- Load the copy script with `<script src="/js/meal-plan-share.js"></script>` at the **bottom of this template**, the established per-page pattern (`views/cookbooks/view.ejs`, `views/recipes/new.ejs`, `edit.ejs`, `import.ejs` all do this). Do **not** add it to `views/layouts/main.ejs`.

### 7. `views/meal-plans/index.ejs` — Public marker

Render a small Public marker on cards whose `mealPlan.is_public` is true, next to the existing `meal-plan-count-badge`, so an owner can see at a glance which plans are shared. `GET /meal-plans` already does `select("*")`, so `is_public` arrives with no route change. Guard on falsy/`typeof` — `src/views/recipeCard.test.js` (~line 125) renders this template with meal plan objects that have no `is_public` key at all, and asserts the output contains no `undefined`.

### 8. Tests (co-located `*.test.js`, run by `npm test` / `node --test`)

- **`src/utils/mealPlanUtils.test.js`** (extend) — the normalizer: `"public"` → true; `"private"`, `undefined`, `null`, `""`, `"PUBLIC"`, `"Public"`, `"true"`, `"published"`, `["public"]`, `{}`, `42` → false.
- **`src/routes/mealPlanVisibilityRoutes.test.js`** (new) — a near-copy of `src/routes/cookbookVisibilityRoutes.test.js`, driving the exported handler with the same fake query builder. Assert: the update value flips in both directions (`{ is_public: true|false }` against table `meal_plans`); **both** `id` and `user_id` filters are applied on every call, in that order; a malformed UUID (`"not-a-uuid"`, `""`, `"../../etc/passwd"`, a SQL-injection-shaped string) never opens a query and redirects to `/meal-plans`; an unknown/absent `visibility` fails closed to Private; a not-found row flashes an error identical to the non-owned case and is not logged as a DB error while a real error is; the success flash uses Private/Public and never matches `/draft|published/i`; and the route is registered at `/:id/visibility` for POST with a 3-layer chain including `requireAuth`.
- **`src/routes/publicRoutes.test.js`** (extend) — add a REW-69 section mirroring the existing REW-19 one:
  - `GET /m/:id` filters on `id` and `is_public = true` and on the not-found branch queries **only** the `meal_plans` table (no second, membership-revealing query), rendering `error` with status 404;
  - private / nonexistent / malformed ids all render one byte-identical not-found payload;
  - a source-level assertion that the `/m/:id` handler **and** `getPublicMealPlanRecipes` contain no `createSupabaseClient`, `req.accessToken`, or `sb-access-token`, and that the fetcher contains `recipes!inner` and `.eq("recipes.status", "published")`;
  - migration-content assertions against `020_add_meal_plan_sharing.sql` read from disk: `is_public BOOLEAN NOT NULL DEFAULT false` present; no `MATERIALIZED VIEW`; the `meal_plan_recipes` policy requires both `is_public = true` and `status = 'published'`, `AND EXISTS` with no `OR EXISTS`; executable SQL (comment lines stripped, as the existing tests do, because the rollback header legitimately names DROPs) contains no `DROP POLICY`, `ALTER POLICY`, `DROP TABLE`, or `DROP COLUMN`; exactly two `CREATE POLICY` statements; and no `ALTER TABLE recipes` / `CREATE POLICY ... ON recipes` / `GRANT ... ON recipes`.
- **`src/views/mealPlanSharing.test.js`** (new) — a near-copy of `src/views/cookbookSharing.test.js` covering: the shared page renders identically for `null` / owner / other-user `user` locals and contains no `/edit|/delete|/add-recipes|/remove|/visibility|/grocery-list` link, no `<form`, no `_csrf`, no `isOwner|accessToken|csrfToken`; title, date range and card metadata are HTML-escaped; cards link to `/r/<id>` and never `/recipes/<id>`; the empty state renders and matches nothing like `/hidden|private recipe|draft|not shown/i`; the owner view posts `private|public` with a real CSRF token and shows the share link only while Public, built from `appUrl`; the owner view still renders when `appUrl` is omitted; and `/js/meal-plan-share.js` is loaded as an external file with no `onclick=` / inline `<script>` body and the client file references `navigator.clipboard` with a select-the-text fallback.
- **`src/views/organizationCardGrid.test.js`** (extend) — add `views/meal-plans/public-view.ejs` to `organizationViews`.
- **Re-run and keep green:** `src/views/recipeCard.test.js`, `src/views/groceryList.test.js`, `src/views/recipeVisibility.test.js`, `src/views/organizationCardGrid.test.js`. All four touch templates this ticket edits.

### 9. `public/js/meal-plan-share.js` (new) and `public/css/styles.css`

- **JS:** the Copy-link handler only, scoped to `[data-meal-plan-share]` / `[data-meal-plan-share-url]` / `[data-meal-plan-share-copy]` / `[data-meal-plan-share-feedback]`. Near-copy of `public/js/cookbook-share.js`: `navigator.clipboard.writeText` with a visible `aria-live` confirmation, and a select-the-text fallback (`input.select()` + "Press Ctrl+C") when the Clipboard API is missing, blocked, or the page is not a secure context. CSP is `scriptSrc: ["'self'"]` — external file only, no inline `onclick`, no inline `<script>` body, no CSP directive change.
- **CSS:** add `.meal-plan-visibility-control`, `.meal-plan-visibility-label`, `.meal-plan-visibility-badge`, `.meal-plan-visibility-private`, `.meal-plan-visibility-public`, `.meal-plan-share-panel`, `.meal-plan-share-panel-label`, `.meal-plan-share-url`, `.meal-plan-share-feedback` alongside the existing `.cookbook-*` block (currently around line 3317). Prefer grouping the new selectors with their `.cookbook-*` equivalents in shared rule blocks rather than copy-pasting nine duplicate declarations — the visual language should be identical.

### 10. Documentation (Documentation stage, after implementation)

- `docs/api/meal-plans.md` — document `POST /meal-plans/:id/visibility` and `GET /m/:id`.
- `database/README.md` — add row 20 to the migration table; document `meal_plans.is_public`; add the two new SELECT policies under the `meal_plans` / `meal_plan_recipes` security sections; note the new anon/authenticated grants; and note that `011`'s "deliberately NO public/shared SELECT policy" statement is superseded by `020`.
- `README.md` — feature bullet.
- `docs/RELEASE_NOTES_REW-69.md` (new), `docs/confluence/REW-69-meal-plan-sharing.md` (new), `docs/confluence/JIRA_COMMENT_REW-69.md` (new) — matching the per-ticket convention already in `docs/`.
- Confluence: update **Meal Plans (REW-63, REW-69)** page `25198593` (seeded with a planned-work section by this planning pass) with as-built detail.

## Affected files

| Path | Change |
| --- | --- |
| `database/migrations/020_add_meal_plan_sharing.sql` | **New.** `meal_plans.is_public` column, two additive `TO anon, authenticated` SELECT policies (the junction one gated on both plan visibility and recipe publish status), anon/authenticated `SELECT` grants. No index, no RPC. |
| `src/utils/mealPlanUtils.js` | **New** `MEAL_PLAN_VISIBILITY` constant + fail-closed `normalizeMealPlanVisibility`. |
| `src/utils/mealPlanUtils.test.js` | Coverage for the normalizer. |
| `src/routes/mealPlanRoutes.js` | **New** exported `handleMealPlanVisibilityUpdate` + `POST /:id/visibility` mount (reusing `requireAuth`, `mealPlanLimiter`, `UUID_PATTERN`); `GET /:id` additionally passes `appUrl: getAppUrl()`; new `getAppUrl` import. |
| `src/routes/mealPlanVisibilityRoutes.test.js` | **New.** Handler unit tests. |
| `src/routes/publicRoutes.js` | **New** `getPublicMealPlanRecipes` helper + `GET /m/:id` (anon client only, generic not-found). |
| `src/routes/publicRoutes.test.js` | `/m/:id` predicate + identical-not-found + anon-client-source tests; migration-content assertions for `020`. |
| `views/meal-plans/view.ejs` | Visibility control + share-link panel + page-local script tag. |
| `views/meal-plans/index.ejs` | Guarded Public marker on shared plans. |
| `views/meal-plans/public-view.ejs` | **New.** Read-only shared plan page reusing `views/partials/recipe-card.ejs`. |
| `public/js/meal-plan-share.js` | **New.** Copy-link handler only. |
| `public/css/styles.css` | `.meal-plan-visibility-*` and `.meal-plan-share-*` classes, grouped with their `.cookbook-*` equivalents. |
| `src/views/mealPlanSharing.test.js` | **New.** Template render + source assertions. |
| `src/views/organizationCardGrid.test.js` | Add `views/meal-plans/public-view.ejs` to the pinned list. |

**Explicitly not touched:** `src/app.js` (helmet/CSP, CORS, csrf, rate limiting, session — all unchanged), `src/middleware/authMiddleware.js`, `src/middleware/csrfMiddleware.js`, `src/config/supabase.js`, `src/routes/index.js` (`publicRoutes` is already mounted at `/`, so `/m/:id` needs no registration change), `src/routes/mealPlanApiRoutes.js`, `views/layouts/main.ejs`, `views/partials/recipe-card.ejs`, `views/partials/meal-plan-modal.ejs`, `views/recipes/search.ejs` and `GET /search` (see assumption 1), `views/meal-plans/new.ejs` / `edit.ejs` / `add-recipes.ejs` / `grocery-list.ejs`, `public/js/cookbook-share.js`, and **every already-applied migration including `011`, `012`, and `019`**.

## Database changes

One new migration: **`database/migrations/020_add_meal_plan_sharing.sql`** — full contents described in Task 1. Schema/RLS impact:

- `meal_plans` gains `is_public BOOLEAN NOT NULL DEFAULT false`. Existing rows stay Private; no backfill.
- `meal_plans` gains **one additional** SELECT policy (`is_public = true`, `TO anon, authenticated`). The four owner-only policies from `011` are untouched.
- `meal_plan_recipes` gains **one additional** SELECT policy requiring the parent plan to be Public **and** the joined recipe to be `published`. The three policies from `012` are untouched.
- New grants: `SELECT` on `meal_plans` and `meal_plan_recipes` to `anon, authenticated`.
- **No new UPDATE/INSERT/DELETE policy anywhere**, no new index, no new function, no change to `recipes` or its policies/grants.
- Deliberately accepted consequence: for a Public plan, an anon PostgREST read can see that row's `user_id`, `title`, `start_date`, `end_date`, and timestamps, and can therefore correlate multiple *Public* plans to the same owner UUID. This matches the pre-existing posture for published `recipes` and Public `cookbooks` (whose `user_id` is likewise anon-readable) and exposes no Private plan. If the user wants that tightened, column-level grants are the tool — but that would be a new, app-wide convention and belongs in its own ticket.
- Note: `meal_plan_recipes.planned_servings` becomes readable for Public plans. It is schema-only today — no route or view writes it (REW-63) — so nothing is disclosed in practice.
- Rollback (state in the migration header): drop the two policies, drop the `is_public` column. That returns meal plans to REW-63 behavior with no data loss.

## Security considerations

1. **Private-recipe leakage is the highest-risk item in this ticket.** `GET /m/:id` and `getPublicMealPlanRecipes` must use the anon-key `supabase` client only. Any appearance of `createSupabaseClient(...)`, `req.accessToken`, or `req.cookies["sb-access-token"]` inside either is a **blocking review finding**. Reviewer: grep for these before approving; Task 8 adds an automated source-level assertion, but check by eye too.
2. **Junction-edge leakage (the REW-92 repeat risk).** The `meal_plan_recipes` public SELECT policy must gate on the recipe's `status` as well as the parent plan's `is_public`. Verify by direct anon PostgREST read against a Public plan containing a Private recipe: `meal_plan_recipes?meal_plan_id=eq.<id>&select=recipe_id,created_at,planned_servings` must return only the published edges. This is AC11 and it cannot be verified from the rendered page alone.
3. **Existence disclosure.** A Private plan, a nonexistent UUID, and a malformed id must produce byte-identical responses at `/m/:id` — same 404 status, same message, same template, no distinct flash, no redirect-to-login, and no extra query on the private branch that could be timed.
4. **CSRF is enabled and must stay enabled.** `src/app.js` applies `csrfProtectionExceptMultipart` globally, `POST` is not in `ignoredMethods`, and `res.locals.csrfToken` is populated for every render. The new visibility form **requires** a real `_csrf` hidden field. Do not add a CSRF exemption for this route. *(The REW-63 Confluence page's Security section wrongly claims CSRF is disabled repo-wide — it is not; that line is corrected as part of this planning pass. Do not act on the stale claim.)*
5. **Ownership checks stay belt-and-suspenders.** The visibility endpoint filters on both `id` and `user_id` in application code *and* is covered by RLS. Do not drop the application filter because "RLS covers it" — that is this codebase's stated convention.
6. **Rate limiting.** Reuse the existing `mealPlanLimiter` (30/min/user) on the visibility route and confirm it is actually in the middleware chain. Do not relax it, do not add a route-level bypass. `GET /m/:id` is covered by the production-only `generalLimiter` in `src/app.js` like every other public GET — leave that alone.
7. **CSP.** `scriptSrc: ["'self'"]`. The Copy-link behavior ships as `/js/meal-plan-share.js`; no inline handlers, no inline script bodies, no CSP directive changes.
8. **Share-URL construction.** Build from `getAppUrl()` only. A header-derived origin would let an attacker induce a share link pointing at an attacker-controlled host while wearing the app's branding — the class of bug REW-57 fixed for emailed links, and worse here because the string exists to be copied and re-shared by a human.
9. **No cached visibility.** `/m/:id` must read `is_public` per request straight from Postgres. Do not memoize it, do not stash it in the session, do not precompute it into a view. AC8 (instant revocation) depends on this.
10. **Fail-closed normalization.** Only the literal string `"public"` may produce a Public plan. Arrays from duplicated form fields, differently-cased values, and non-strings all resolve to Private.
11. **No new redirect surface.** The share link is a fixed internal `/m/:id` path built from a database-stored UUID; nothing user-supplied shapes it.
12. **Unchanged invariants.** Toggling plan visibility must not write to any recipe's `status`, must not add or remove plan membership, and must not alter `start_date`/`end_date`. Deleting a meal plan must still delete zero recipes (REW-63 behavior preserved). No code in this ticket should touch the `recipes` table at all.
13. **Owner-only surfaces stay owner-only.** `/meal-plans/:id`, `/meal-plans/:id/edit`, `/meal-plans/:id/add-recipes`, `/meal-plans/:id/grocery-list`, and every `/api/meal-plans/*` route keep `requireAuth` and their owner scoping. Making a plan Public must not make any of them reachable by a non-owner.

## Acceptance criteria

- [ ] **AC1** — A meal plan's owner can switch it from Private to Public and back from `/meal-plans/:id`, unlimited times, with a confirming flash that uses the words Private/Public (never draft/published).
- [ ] **AC2** — Newly created meal plans are Private by default, and every meal plan that existed before migration `020` is Private after it runs.
- [ ] **AC3** — While a plan is Public, its detail page shows the full share URL `<APP_URL>/m/<id>` in a copyable readonly field with a working Copy button, and the origin comes from `APP_URL`/`getAppUrl()` — verify by sending a spoofed `Host` / `X-Forwarded-Host`: the rendered link must not change.
- [ ] **AC4** — Opening a Public plan's share link **while logged out** renders its title, its start–end date range (formatted identically to the owner view), and its Public recipes as read-only cards, with no edit, rename, re-date, delete, add-recipe, remove-recipe, or grocery-list control anywhere on the page — and the same is true when the **owner** opens their own share link, and when a **different logged-in user** does.
- [ ] **AC5** — A Public plan containing at least one Private (draft) recipe shows **zero** trace of that recipe at `/m/:id` — not in the cards, not in the recipe count, not in the page source — to a logged-out visitor, to a different logged-in user, **and** to the owner.
- [ ] **AC6** — A Public plan whose recipes are all Private renders a neutral empty state that does not reveal that hidden recipes exist (no count, no placeholder, no "hidden" wording).
- [ ] **AC7** — `/m/:id` for a **Private** plan, for a **nonexistent** UUID, and for a **malformed** id all return HTTP 404 with the same rendered message — as a logged-out visitor and as a different logged-in user.
- [ ] **AC8** — Switching a previously-Public plan back to Private revokes its link on the very next request: reloading the previously-working `/m/:id` returns the AC7 404, with no server restart or cache clear.
- [ ] **AC9** — Sharing one meal plan exposes no other plan: with user A holding one Public and two Private plans, a logged-out visitor and a different logged-in user can reach only the Public one; `/m/:id` for either Private plan returns the AC7 404, and there is no listing surface that enumerates A's plans.
- [ ] **AC10** — Updates made by the owner are reflected on the share link on the next load: renaming the plan, changing its date range, adding a Public recipe, and removing a recipe each appear at `/m/:id` without any further sharing action.
- [ ] **AC11** — A direct PostgREST/API read, as both an anonymous key and a different authenticated user, returns nothing for another user's **Private** `meal_plans` row and its `meal_plan_recipes` rows; and for a **Public** plan, a `meal_plan_recipes` read returns only edges whose recipe is Public — no `recipe_id`, `created_at`, or `planned_servings` for the owner's Private recipes. Privacy holds at the database layer, not only in the UI.
- [ ] **AC12** — A meal plan containing another user's Public recipe renders that recipe on the share page with its author attribution, and the card links to `/r/<id>`; if that recipe's owner later switches it to Private, it disappears from the shared page on the next load without error.
- [ ] **AC13** — Toggling a plan's visibility never changes any recipe's `status`, never adds or removes plan membership, never alters `start_date`/`end_date`, and deleting a meal plan still deletes zero recipes.
- [ ] **AC14** — Submitting the visibility form without a valid CSRF token is rejected, and an unrecognized or absent `visibility` value results in Private (fail closed), never Public.
- [ ] **AC15** — A non-owner cannot reach `/meal-plans/:id`, `/meal-plans/:id/edit`, `/meal-plans/:id/add-recipes`, `/meal-plans/:id/grocery-list`, or any `/api/meal-plans/*` route for a plan that is Public — Public grants read access to `/m/:id` only.
- [ ] **AC16** — Exceeding 30 meal plan mutations in a minute is rate-limited on the visibility endpoint, the same as every other meal plan mutation.
- [ ] **AC17** — The meal plan list page marks Public plans and only Public plans, and renders without `undefined` for plans created before the migration.
- [ ] **AC18** — `npm test` passes with no regressions. `src/views/recipeCard.test.js`, `src/views/groceryList.test.js`, `src/views/recipeVisibility.test.js`, and `src/views/organizationCardGrid.test.js` all still pass against the edited templates, and every new test from Task 8 passes.
- [ ] **AC19** — `database/migrations/020_add_meal_plan_sharing.sql` is a new file; `git diff` shows **no** modification to any migration `001`–`019`.

## References

- `docs/plans/rew-19-cookbook-sharing.md` — the plan this one mirrors; read it alongside this file.
- `database/migrations/019_add_cookbook_sharing.sql` — the additive-policy + explicit-grant + anon-privacy pattern, including the REW-92 junction-edge fix this ticket must replicate.
- `database/migrations/013_public_recipe_card_metadata.sql` — the original `TO anon, authenticated` + `status = 'published'` junction-policy precedent.
- `src/routes/publicRoutes.js` (`GET /c/:id`, `getPublicCookbookRecipes`) — the anon-client + generic-not-found + inner-join-embed pattern reused for `/m/:id`.
- `src/routes/cookbookRoutes.js` (`handleCookbookVisibilityUpdate`) and `src/routes/cookbookVisibilityRoutes.test.js` — the injectable-client handler-export pattern for unit-testing a route.
- `src/utils/cookbookUtils.js` (`normalizeCookbookVisibility`) and `src/utils/recipeVisibility.js` (REW-85) — the fail-closed Private/Public normalization.
- `src/utils/authUtils.js` (`getAppUrl()`, REW-57) — share-link origin without trusting request headers.
- `docs/plans/REW-63-create-and-manage-meal-plans.md` — the base feature this extends.
