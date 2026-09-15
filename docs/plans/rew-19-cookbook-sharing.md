# REW-19: Cookbook Sharing

> **Plan refreshed 2026-09-14.** The previous version of this plan was written on 2026-09-08 and validated against the repo as it stood then. Several tickets have merged since (REW-26 grocery lists, REW-63 meal plans, REW-84 recipe cloning, REW-85 recipe visibility, REW-59/67/83 card work). Every file path, route, migration number, RLS policy, RPC name, helper, and test assertion referenced below has been re-verified against the working tree. See **"What changed since the previous plan"** at the bottom for the diff.

## Jira issue

**REW-19 — Cookbook Sharing** (Story, Medium, status **To Do**, parent epic REW-2 "Phase 2 — Core Recipe Organization & Import")
https://wanderingnerds.atlassian.net/browse/REW-19

Ticket exists — the Developer does **not** need to create one. The ticket already carries a Jira comment (2026-09-08) summarizing the *previous* version of this plan; that comment is now partially stale (it names migration `011`, which is taken). Flagging for the Developer: the Jira comment should be superseded when implementation starts. The Planner does not write to Jira.

Related tickets whose merged code this plan depends on:

- **REW-62** — Cookbooks (`009_create_cookbooks_table.sql`, `010_create_cookbook_recipes_table.sql`). Its migration header explicitly anticipates this ticket: *"sharing can be added later as an ADDITIONAL SELECT policy ... without reworking this migration."*
- **REW-85** — Private/Public recipe visibility (`src/utils/recipeVisibility.js`). Established the app-wide **Private/Public** vocabulary and the `name="visibility" value="private|public"` form-field convention that this ticket must follow.
- **REW-59 / REW-13** — public recipe card metadata policies (`013_public_recipe_card_metadata.sql`) and the anon-readable grant pattern this migration mirrors.
- **REW-84** — recipe cloning (`POST /recipes/:id/clone`, `018_add_recipe_clone_provenance.sql`). Relevant because a visitor to a shared cookbook can already click through to `/r/:id` and use the existing **Add Recipe** button — so "save someone else's recipe" is already solved at the recipe level even though cookbook-level cloning stays out of scope.

## Confluence page

Existing feature-reference page, updated in place (not forked):
**[Cookbooks (REW-62)](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25067521/Cookbooks+REW-62)** — a "REW-19: Cookbook Sharing (planned)" section has been added, and the "Explicitly out of scope" section now points at this plan instead of describing sharing as undesigned.

## Summary

Give a cookbook owner one explicit, reversible **Private ↔ Public** choice. Making a cookbook Public does two things at once:

1. **Share link.** The cookbook becomes readable at `GET /c/:id` by anyone, signed in or not. The cookbook's own UUID `id` is the share identifier — exactly the precedent the app already uses for published recipes at `GET /r/:id`. Flipping back to Private revokes the link instantly, because the page re-checks visibility at the database layer on every request; there is no token to invalidate and no cached visibility flag.
2. **Discoverability.** Public cookbooks surface as a secondary "Cookbooks" section in the existing top-search-bar results page (`GET /search`, `views/recipes/search.ejs`).

Both are served by one new boolean column (`cookbooks.is_public`), two additive RLS SELECT policies, and one new full-text RPC. No `cookbook_shares` table, no share tokens, no per-user grants.

**The privacy-critical design point — draft recipes must never leak.** A cookbook may contain the owner's Private (draft) recipes; REW-62 deliberately made cookbook membership independent of publish status, and `database/README.md` documents that. The defence is structural, not a filter someone can forget:

- `GET /c/:id` and its recipe fetch use the **anon-key `supabase` client** exported from `src/config/supabase.js` — never `createSupabaseClient(req.accessToken)`, and never any owner-scoped client, even when the owner is the one viewing.
- The `recipes` SELECT policies from `001_create_recipes_table.sql` are `auth.uid() = user_id` **or** `status = 'published'`. Under the anon key, `auth.uid()` is null, so only published recipes are ever returned. A draft in a Public cookbook is invisible at the database layer regardless of what the route handler does.
- An explicit `status = 'published'` predicate is added in application code **as defence in depth only**, mirroring how `GET /r/:id` already does it (and how `publicRoutes.test.js` already asserts it).

Consequence to accept deliberately: a Public cookbook containing only Private recipes renders as an empty cookbook to visitors. That is correct behavior, and it needs its own empty state and its own acceptance criterion (AC6).

## Open questions / assumptions

All of the following are **assumptions I proceeded on**, not blockers. Raise any of them with the user before implementation only if you disagree.

1. **Two states, not three.** Public means both linkable *and* searchable. No "unlisted / link-only, not searchable" middle state — the ticket asks for exactly two mechanisms bound to one Public flag. If unlisted is wanted later, `is_public` splits into two independent booleans; not built speculatively.
2. **No share token or slug.** Considered and rejected. A token would allow revoking one link independently of search visibility, but doubles the surface area and diverges from `/r/:id`, which already treats a bare UUID as sufficient. UUIDv4 is not enumerable.
3. **No owner-name attribution on the public cookbook page.** *(Changed from the previous plan.)* The previous plan proposed showing the owner's display name via `getAccountDisplayName()`. That helper (`src/utils/userUtils.js`) reads `user.user_metadata.name` off a **Supabase auth user object** — it can only describe the *currently logged-in* viewer, and the anon client cannot read another account's `auth.users` row at all. Showing the owner's name would require either a new public `profiles` table or an `owner_display_name` snapshot column, i.e. a new privacy decision and extra schema the ticket never asked for. Assumption: ship without cookbook-level owner attribution. Per-recipe attribution still appears, because every recipe card already renders `recipe.author` (a free-text column, REW-46).
4. **Search results are capped, not paginated.** Recipes remain the primary result set with full pagination. Cookbooks render as a small capped section (recommend 5) beneath/above the recipe grid. The ticket asks for discoverability, not a dedicated cookbook-search page. If a "see all cookbooks matching X" page is wanted, that's a follow-up ticket.
5. **`tsvector` + GIN, not `ILIKE`.** Consistent with `003_add_recipe_search.sql`, and future-proof if `cookbooks` ever gains a description. Ranking is necessarily title-only today.
6. **Cookbook cloning stays out of scope**, per the ticket's own "Out of scope" section. Note for the user: REW-84 already shipped recipe-level cloning, so a visitor can click a recipe in a shared cookbook through to `/r/:id` and hit **Add Recipe**. A cookbook-level "save this whole cookbook" is a reasonable follow-up ticket — **recommend the user have Developer file one**; the Planner does not create Jira issues.
7. **A Public badge on the cookbook list page** (`views/cookbooks/index.ejs`) is included (Task 6) because an owner needs to see at a glance which of their cookbooks are shared. It must be visually distinguishable from the per-recipe Private/Public badges to avoid confusion — see the Security/UX note about terminology collision.

## Tasks

### 1. `database/migrations/019_add_cookbook_sharing.sql` (new)

**The next free migration number is `019`.** `011` and `012` are meal plans (REW-63), `013`–`018` are REW-59/70/71/78/80/84. The highest applied migration today is `018_add_recipe_clone_provenance.sql`. Do **not** edit 009 or 010, or any other applied migration. (Note: the repo already contains two files prefixed `003_` — `003_create_categories_table.sql` and `003_add_recipe_search.sql`. Do not repeat that; `019` must be unique.)

One migration bundling the column, indexes, policies, grants, and RPC — following the `003_add_recipe_search.sql` precedent of shipping a search feature's whole surface in one file. Contents, described (no SQL here):

- Add `is_public` to `cookbooks`: boolean, `NOT NULL`, default `false`. Existing rows therefore stay Private, satisfying "private by default."
- A **partial index** on `cookbooks` keyed by `created_at DESC` where `is_public = true`, mirroring `idx_recipes_published_created` from `003`.
- A **generated `tsvector` column** over `cookbooks.title` plus a **GIN index** on it, mirroring `idx_recipes_search_vector`.
- A new **additive SELECT policy on `cookbooks`** allowing any row where `is_public = true`. Declare it explicitly `TO anon, authenticated`, matching the style of `013_public_recipe_card_metadata.sql` (009's policies omit the `TO` clause). It must not modify or drop the four owner-only policies from 009.
- A new **additive SELECT policy on `cookbook_recipes`** allowing rows whose parent cookbook is public, expressed as an `EXISTS` subquery against `cookbooks`. Also `TO anon, authenticated`. This is safe from RLS recursion: `cookbook_recipes` policies reference `cookbooks`, and `cookbooks` policies reference nothing — no cycle. It must not modify the owner-only policies from 010.
- **Explicit `GRANT SELECT` on `cookbooks` and `cookbook_recipes` to `anon` and `authenticated`.** `003` and `013` both do this explicitly rather than relying on Supabase default privileges; follow suit. RLS remains the row-visibility boundary — the grant only permits the read to be *attempted*.
- A new RPC **`search_cookbooks(search_query text, result_limit integer, result_offset integer)`**, declared `LANGUAGE sql`, **`STABLE`**, **`SECURITY INVOKER`**, with `SET search_path = public, pg_temp` — an exact match for `search_recipes`'s security posture, so RLS stays the real boundary and a bug in the function's own filter cannot leak a Private cookbook. It should:
  - filter `is_public = true` (defence in depth on top of RLS),
  - match via `websearch_to_tsquery` against the title vector, plus a partial-title `ILIKE` fallback with LIKE metacharacters escaped, exactly as `search_recipes` does, so "week" still finds "Weeknight Favorites",
  - return at minimum `id`, `title`, `created_at`, a `rank`, a **published-only recipe count**, and `total_count` via a `count(*) OVER ()` window, matching `search_recipes`'s pagination shape,
  - compute the recipe count with an explicit `status = 'published'` join predicate so the number a visitor sees is identical to the number the owner sees (without it, an owner's own RLS visibility would inflate their count with their drafts),
  - clamp `result_limit` and floor `result_offset` the same way `search_recipes` does.
- `GRANT EXECUTE` on the new function to `anon, authenticated`.
- A header comment naming the ticket and a rollback note, matching the conventions in `003`, `009`, and `010`.

### 2. `src/routes/cookbookRoutes.js` — visibility toggle endpoint

Add `POST /cookbooks/:id/visibility`, placed next to the existing `POST /:id/update` handler (it must sit above the catch-all `GET /:id` for readability; there is no actual routing conflict since the methods differ).

- Middleware: `requireAuth`, then the **existing `cookbookLimiter`** (30/min, keyed on `req.user.id`) already defined at the top of this file. Do not add a new limiter; do confirm it is actually applied — easy to omit on a new route.
- Screen `:id` against the file's existing `UUID_PATTERN` before touching the database, matching every other handler here.
- Accept the REW-85 field convention: `req.body.visibility` with values `"private"` / `"public"`, **not** a raw `isPublic=true|false`. Normalize through a new helper (Task 5) that fails closed to Private on anything unexpected — the same fail-closed posture `normalizeRecipeVisibility()` already has.
- Perform the update with an explicit `.eq("id", id).eq("user_id", req.user.id)` filter and `.select().maybeSingle()`, so a missing row and a non-owned row are indistinguishable — copy the shape of the existing `POST /:id/update` handler rather than inventing a new one. RLS's UPDATE policy from 009 already covers owners writing their own rows; no new UPDATE policy is required because only a new column is being written on an already-writable row.
- Flash + redirect to `/cookbooks/:id`. Suggested copy: *"This cookbook is now Public — anyone with the link can view it."* / *"This cookbook is now Private. Its share link no longer works."* Use the words Private/Public, never draft/published.
- **Testability:** follow the `handleRecipeUpdate` precedent in `src/routes/recipeRoutes.js` — export the handler with an injectable `{ createClient = createSupabaseClient }` option so `src/routes/cookbookVisibilityRoutes.test.js` (Task 9) can drive it with a fake query builder, exactly as `src/routes/recipeVisibilityRoutes.test.js` does.

### 3. `src/routes/publicRoutes.js` — public cookbook view + search extension

This file opens with the comment *"Every route here is public. We deliberately use the anon-key client…"*. Both additions must honor that literally.

**3a. `GET /c/:id` (new).**
- Screen `:id` with the file's existing `UUID_PATTERN`; a malformed id returns the generic not-found immediately (Postgres would reject it anyway).
- Fetch the cookbook through the module-level anon `supabase` client, filtered on `id` **and** `is_public = true`.
- If the row is missing **or** private, call the file's existing `renderNotFound(res, …)` with one single message covering both cases. A private cookbook's existence must never be distinguishable from a nonexistent one.
- Fetch its recipes through the **same anon client**. `getCookbookRecipes()` in `cookbookRoutes.js` is module-private and takes an owner-scoped client — do **not** export and reuse it as-is. Write a small local fetch in `publicRoutes.js` that:
  - selects from `cookbook_recipes` filtered on `cookbook_id`, embedding the recipe columns the card needs (`id, title, author, prep_time, cook_time, servings, difficulty, thumbnail_url, created_at`),
  - uses an **inner-join embed** so membership rows whose recipe is RLS-invisible are dropped rather than returned with a null embed, and additionally filters the embedded `status` to `published` as defence in depth,
  - defensively filters out any null embed that still slips through (the existing `getCookbookRecipes` already does this for a delete race),
  - orders by the junction row's `created_at` descending, matching the owner view.
- Render a new `views/cookbooks/public-view.ejs`. Do **not** create an owner-scoped client anywhere in this handler, not even to detect ownership — see Task 4's note on why the page is read-only for everyone.

**3b. `GET /search` (extended).**
- Keep the existing `search_recipes` call, its pagination, and its empty-query short-circuit exactly as they are.
- When `query` is non-empty, additionally call `search_cookbooks` on the same anon client with a small fixed limit (recommend 5) and offset 0.
- A `search_cookbooks` failure must **not** break recipe search: log it and pass an empty `cookbooks` array, rather than flashing and redirecting to `/browse` the way a `search_recipes` failure does. Cookbook results are a bonus surface; degrading them silently is correct.
- Pass `cookbooks` into `recipes/search.ejs` on **all** render paths from this handler (including the empty-query path), so the template never sees an undefined local in production.

### 4. `views/cookbooks/public-view.ejs` (new)

Read-only rendering of a Public cookbook: title, recipe count, and its (published-only, by RLS) recipes.

- **Reuse `views/partials/recipe-card.ejs`.** It has been verified to fit: it links to `/r/<%= recipe.id %>`, reads only `id/title/thumbnail_url/prep_time/cook_time/servings/author/categories/description`, and already handles the signed-out case via a `user`/guest split on its "+ Meal Plan" button. It is the same partial `views/recipes/search.ejs` uses. Categories/tags are optional in it, so not embedding them is fine.
- No edit, delete, rename, add-recipes, or remove-from-cookbook affordances — **for anyone, including the owner viewing their own share link.** Keeping the page unconditionally read-only means there is no `isOwner` branch to get wrong, and no reason for the handler to ever construct an owner-scoped client.
- Empty state required: a Public cookbook whose recipes are all Private renders zero cards. Show something like *"This cookbook doesn't have any Public recipes yet."* — do **not** leak that hidden recipes exist (no "3 recipes hidden" counter).
- Follow `views/recipes/public-view.ejs`'s signed-out sign-up CTA pattern if desired (optional, not an AC).
- Use the shared `organization-card-grid` class if the page renders a card grid, for consistency with `src/views/organizationCardGrid.test.js`'s contract. Consider adding this file to that test's `organizationViews` list.

### 5. `src/utils/cookbookUtils.js` — visibility normalizer

Add one small pure helper (name suggestion: `normalizeCookbookVisibility`) that maps `"public"` → `true` and everything else — `"private"`, an array, `undefined`, a stray string, a non-string — → `false`. Fail closed to Private. Model it directly on `normalizeRecipeVisibility()` in `src/utils/recipeVisibility.js`; keep it in `cookbookUtils.js` alongside `validateCookbookTitle` / `normalizeRecipeIdSelection`, matching this file's stated role as the home for cookbook pure logic. Cover it in the existing `src/utils/cookbookUtils.test.js`.

### 6. `views/cookbooks/view.ejs` — owner visibility control + share link

- Add a visibility control in the existing action row (next to Add Recipes / Rename / Delete Cookbook), posting to `/cookbooks/<%= cookbook.id %>/visibility` with the inert-safe `_csrf` hidden field **and** a `visibility` field carrying `private`/`public`, matching the REW-85 form convention.
- When `cookbook.is_public` is true, show the full share URL (`<appUrl>/c/<cookbook.id>`) in a read-only input alongside a **Copy link** button.
- **`appUrl` must come from `getAppUrl()`** (`src/utils/authUtils.js`) passed in by the route — never from `req.headers.host` / `X-Forwarded-Host`. That helper's own doc comment spells out the header-injection reasoning; it applies at least as strongly here, because this string is explicitly designed to be copied and re-shared by a human.
- **Do not make new locals mandatory.** `src/views/recipeCard.test.js` renders this template directly with only `{ cookbook, recipes, user, csrfToken }`. Guard new locals with `typeof appUrl !== 'undefined'` (and treat a missing `cookbook.is_public` as false), or update that test's fixture. If the template throws on a missing local, that existing test fails.
- **Terminology:** `src/views/recipeVisibility.test.js` asserts this file contains `>Private</span>` and contains neither `>Draft</span>` nor `>Published</span>`. Those assertions refer to the **per-recipe** badge already on each card. The new **cookbook-level** control must also use Private/Public wording but be visually and structurally distinct from the per-recipe badge (e.g. a labeled control in the header row, not another bare badge on a card), so a reader can tell "this cookbook is Public" apart from "this recipe is Public."

### 7. `views/cookbooks/index.ejs` — Public marker on the list page

Render a small Public marker on cards whose `cookbook.is_public` is true so an owner can see at a glance which cookbooks are shared. `GET /cookbooks` already does `select("*")`, so `is_public` arrives with no route change. Guard on `typeof`/falsy so the existing `recipeCard.test.js` fixture (which passes a cookbook object without `is_public`) keeps rendering.

### 8. `views/recipes/search.ejs` — Cookbooks results section

- Render a "Cookbooks" section only when the new `cookbooks` array is present and non-empty, each entry linking to `/c/<id>` and showing the title and published-recipe count.
- Keep it visually secondary to the recipe grid — this is a recipe site.
- **Must not break the existing test.** `src/views/recipeCard.test.js` renders this template with exactly `{ query, recipes, user, totalCount, page, totalPages }` — no `cookbooks`. Guard with `typeof cookbooks !== 'undefined' && cookbooks.length`, or update that fixture. Also note that test asserts the search page does **not** contain `recipe-summary-card`, `Prep:`, `Cook:`, `Created`, or `tag-badge`; the new cookbook section must not introduce those strings.
- The "no results" branch currently triggers on `recipes.length === 0`. Decide and implement deliberately: if there are zero recipes but one or more matching cookbooks, the page should show the cookbook section rather than a bare "No recipes match" dead end.

### 9. `public/js/cookbook-share.js` (new)

The Copy-link handler only (`navigator.clipboard.writeText`, with a visible confirmation and a graceful fallback when the Clipboard API is unavailable or the page is not a secure context).

- Load it with a `<script src="/js/cookbook-share.js"></script>` at the bottom of `views/cookbooks/view.ejs`. That is the established per-page pattern (`views/recipes/new.ejs`, `edit.ejs`, `import.ejs`, `index.ejs` all do this). Do **not** add it to `views/layouts/main.ejs`, which is reserved for globally-needed scripts.
- CSP is `scriptSrc: ["'self'"]` in `src/app.js` — external file only, no inline `onclick`, no inline `<script>` body.

### 10. Tests (co-located `*.test.js`, run by `npm test` / `node --test`)

- `src/utils/cookbookUtils.test.js` — extend for the new normalizer: `"public"` → true; `"private"`, `undefined`, `null`, `["public"]`, `"PUBLIC"`, `"true"`, numbers, objects → false.
- `src/routes/cookbookVisibilityRoutes.test.js` (new) — drive the exported visibility handler with a fake query builder, asserting: the update value flips correctly for both inputs; both `id` and `user_id` filters are applied on every call; a malformed UUID never reaches the database; an unknown `visibility` value fails closed to Private. Model it on `src/routes/recipeVisibilityRoutes.test.js`.
- `src/routes/publicRoutes.test.js` — extend with a `/c/:id` case in the style of the existing `'public detail applies the published predicate on every request'` test: assert the handler filters on both `id` and `is_public = true`, and that a null result renders the 404 path rather than leaking. Also extend the existing migration-content test (which already reads `003_add_recipe_search.sql` from disk) with an equivalent assertion that `019_add_cookbook_sharing.sql` contains an `is_public = true` predicate, declares `SECURITY INVOKER`, and contains no `MATERIALIZED VIEW`.
- `src/views/` — add render assertions for `views/cookbooks/public-view.ejs`: no `/cookbooks/…/edit`, `/delete`, `/add-recipes`, or `/remove` strings; no `<form` for mutations; links go to `/r/<id>`; the empty state renders when `recipes` is empty. Re-run `src/views/recipeCard.test.js`, `src/views/recipeVisibility.test.js`, and `src/views/organizationCardGrid.test.js` — all three touch templates this ticket edits.

### 11. Documentation (Documentation stage, after implementation)

- `docs/api/cookbooks.md` — `POST /cookbooks/:id/visibility` and `GET /c/:id`.
- `database/README.md` — add row 19 to the migration table, the `cookbooks.is_public` column, the two new RLS policies under the cookbooks/cookbook_recipes security sections, the new index entries, and the `search_cookbooks` RPC. *(Pre-existing gap worth fixing while in there: that table never lists `003_add_recipe_search.sql` at all.)*
- `README.md` — feature bullet.
- `docs/RELEASE_NOTES_REW-19.md` (new), `docs/confluence/REW-19-cookbook-sharing.md`, `docs/confluence/JIRA_COMMENT_REW-19.md` — matching the per-ticket convention already in `docs/`.
- Confluence: update **Cookbooks (REW-62)** page 25067521 (already seeded with a planned-work section by this planning pass) with as-built detail.

## Affected files

| Path | Change |
| --- | --- |
| `database/migrations/019_add_cookbook_sharing.sql` | **New.** `is_public` column, partial index, title `tsvector` + GIN index, two additive SELECT policies, anon/authenticated grants, `search_cookbooks` RPC. |
| `src/routes/cookbookRoutes.js` | **New** `POST /:id/visibility` handler (exported with injectable client for tests); reuses the existing `cookbookLimiter` and `UUID_PATTERN`. |
| `src/routes/publicRoutes.js` | **New** `GET /c/:id` (anon client, generic not-found); `GET /search` extended with a capped `search_cookbooks` call that degrades silently on error. |
| `src/utils/cookbookUtils.js` | **New** fail-closed visibility normalizer. |
| `src/utils/cookbookUtils.test.js` | Coverage for the normalizer. |
| `src/routes/cookbookVisibilityRoutes.test.js` | **New.** Handler unit tests. |
| `src/routes/publicRoutes.test.js` | `/c/:id` predicate test + migration-content assertions for `019`. |
| `views/cookbooks/view.ejs` | Visibility control + share-link input + Copy button + page-local script tag. |
| `views/cookbooks/index.ejs` | Public marker on shared cookbooks. |
| `views/cookbooks/public-view.ejs` | **New.** Read-only public cookbook page reusing `views/partials/recipe-card.ejs`. |
| `views/recipes/search.ejs` | **New** guarded "Cookbooks" results section. |
| `public/js/cookbook-share.js` | **New.** Copy-link handler only. |
| `src/views/*.test.js` | New public-view assertions; verify `recipeCard.test.js`, `recipeVisibility.test.js`, `organizationCardGrid.test.js` still pass. |

**Explicitly not touched:** `src/app.js` (helmet/CSP, CORS, csrf, rate limiting, session — all unchanged), `src/middleware/authMiddleware.js`, `src/middleware/csrfMiddleware.js`, `src/config/supabase.js`, `src/routes/index.js` (publicRoutes is already mounted at `/`, so `/c/:id` needs no registration change), `views/layouts/main.ejs`, `views/cookbooks/edit.ejs` / `new.ejs` / `add-recipes.ejs`, and **every already-applied migration including `009` and `010`**.

## Database changes

One new migration: **`database/migrations/019_add_cookbook_sharing.sql`** — full contents described in Task 1. Summary of schema/RLS impact:

- `cookbooks` gains `is_public BOOLEAN NOT NULL DEFAULT false` plus a generated title search vector; existing rows stay Private with no backfill required.
- `cookbooks` gains **one additional** SELECT policy (`is_public = true`, `TO anon, authenticated`). The four owner-only policies from 009 are untouched.
- `cookbook_recipes` gains **one additional** SELECT policy scoped through the parent cookbook's `is_public`. The three policies from 010 are untouched. No UPDATE policy is added anywhere — membership stays insert/delete only, and the visibility column lives on a row owners can already update.
- New indexes: partial `is_public` index on `cookbooks`, GIN index on the new title vector.
- New grants: `SELECT` on `cookbooks` and `cookbook_recipes` to `anon, authenticated`; `EXECUTE` on `search_cookbooks` to `anon, authenticated`.
- **No change to `recipes`, its policies, or its grants.** The existing published/owner SELECT policy from `001` is precisely the mechanism relied on for draft privacy, and must not be modified.
- Rollback (for the migration header): drop the RPC, the two new policies, the two new indexes, the generated search column, and the `is_public` column. Dropping them returns cookbooks to REW-62 behavior without data loss.

## Security considerations

1. **Draft-recipe leakage is the single highest-risk item in this ticket.** `GET /c/:id` and its recipe fetch must use the anon-key `supabase` client only. Any appearance of `createSupabaseClient(...)`, `req.accessToken`, or `req.cookies["sb-access-token"]` inside the `/c/:id` handler is a blocking review finding. Reviewer: grep the handler for these before approving.
2. **Existence disclosure.** A Private cookbook and a nonexistent cookbook must produce byte-identical responses at `/c/:id` — same status (404), same message, same template. No distinct flash, no redirect-to-login, no timing-sensitive extra query on the private branch.
3. **Ownership checks stay belt-and-suspenders.** The visibility endpoint filters on both `id` and `user_id` in application code *and* is covered by RLS. Do not drop the application-level filter on the grounds that RLS covers it — that is this codebase's stated convention (see the comment on `POST /:id/update`).
4. **CSRF is enabled and must stay enabled.** *(Corrected from the previous plan, which stated CSRF was globally disabled — it is not.)* `src/app.js` applies `csrfProtectionExceptMultipart` globally, `POST` is not in `ignoredMethods`, and `res.locals.csrfToken` is populated for every render. The new visibility form **requires** a real `_csrf` hidden field or it will be rejected. Do not add a CSRF exemption for this route.
5. **Rate limiting.** Reuse the existing `cookbookLimiter` (30/min/user) on the visibility route; confirm it is actually in the middleware chain. Do not relax it, do not add a route-level bypass. `GET /c/:id` and `GET /search` are covered by the production-only `generalLimiter` in `src/app.js` like every other public GET — leave that alone.
6. **CSP.** `scriptSrc: ["'self'"]`. The Copy-link behavior ships as `/js/cookbook-share.js`; no inline handlers, no inline script bodies, no CSP directive changes.
7. **Share-URL construction.** Build from `getAppUrl()` only. A header-derived origin would let an attacker induce a share link pointing at an attacker-controlled host while wearing the app's branding — exactly the class of bug REW-57 fixed for emailed links, and worse here because the string is designed to be re-shared.
8. **RPC security posture.** `search_cookbooks` must be `STABLE` + `SECURITY INVOKER` + `SET search_path = public, pg_temp`, matching `search_recipes`. If it were `SECURITY DEFINER`, its own `is_public` filter would become the only thing standing between a visitor and every private cookbook in the database. Reviewer: verify this literally in the migration text.
9. **Query-input handling.** The existing `/search` handler already trims and caps `q` at 100 chars; reuse that same sanitized value for the cookbook RPC — do not read `req.query.q` a second time. The RPC must escape LIKE metacharacters in its partial-match branch exactly as `search_recipes` does, so a literal `%` or `_` stays literal.
10. **No cached visibility.** Both `/c/:id` and `/search` must read visibility per request straight from Postgres. Do not memoize, cache, or store `is_public` in the session — AC5 (instant revocation) depends on this.
11. **No new redirect surface.** The share link is a fixed internal `/c/:id` path built from a database-stored UUID; nothing user-supplied shapes it.
12. **Unchanged invariants.** Cookbook visibility must not write to `recipes.status`, and cookbook deletion must continue to leave recipes intact (`ON DELETE CASCADE` on `cookbook_recipes.cookbook_id` only). No code in this ticket should touch the `recipes` table at all.

## Acceptance criteria

- [ ] **AC1** — A cookbook's owner can switch it from Private to Public and back from `/cookbooks/:id`, unlimited times, with a confirming flash message that uses the words Private/Public (never draft/published).
- [ ] **AC2** — Newly created cookbooks are Private by default, and every cookbook that existed before migration 019 is Private after it runs.
- [ ] **AC3** — While a cookbook is Public, its detail page shows the full share URL `<APP_URL>/c/<id>` in a copyable field with a working Copy button, and the URL's origin comes from `APP_URL`/`getAppUrl()`, not from the request's `Host` header (verify by sending a spoofed `Host`/`X-Forwarded-Host` — the rendered link must not change).
- [ ] **AC4** — Opening a Public cookbook's share link **while logged out** renders its title and its Public recipes as read-only cards, with no edit, rename, delete, add-recipe, or remove-recipe control anywhere on the page — and the same is true when the **owner** opens their own share link.
- [ ] **AC5** — A Public cookbook containing at least one Private (draft) recipe shows **zero** trace of that recipe at `/c/:id` — not in the cards, not in the recipe count, not in the page source — to a logged-out visitor, to a different logged-in user, **and** to the owner.
- [ ] **AC6** — A Public cookbook whose recipes are all Private renders a neutral empty state that does not reveal that hidden recipes exist.
- [ ] **AC7** — `/c/:id` for a **Private** cookbook, for a **nonexistent** UUID, and for a **malformed** id all return HTTP 404 with the same rendered message — as a logged-out visitor and as a different logged-in user.
- [ ] **AC8** — Switching a previously-Public cookbook back to Private revokes its link on the very next request: reloading the previously-working `/c/:id` returns the AC7 404.
- [ ] **AC9** — Searching a Public cookbook's title in the top nav search bar returns it in a distinct "Cookbooks" section of `/search`, linking to `/c/:id`, while recipe results and their pagination continue to work unchanged.
- [ ] **AC10** — A Private cookbook never appears in `/search` results for anyone, including its own owner searching its exact title.
- [ ] **AC11** — A direct PostgREST/API read of another user's Private cookbook row, and of that cookbook's `cookbook_recipes` rows, returns nothing for both an anonymous key and a different authenticated user — i.e. privacy holds at the database layer, not only in the UI.
- [ ] **AC12** — Toggling a cookbook's visibility never changes any recipe's own `status`, never adds or removes cookbook membership, and deleting a cookbook still deletes zero recipes (REW-62 behavior preserved).
- [ ] **AC13** — Submitting the visibility form without a valid CSRF token is rejected, and an unrecognized/absent `visibility` value results in Private (fail closed), never Public.
- [ ] **AC14** — Exceeding 30 cookbook mutations in a minute is rate-limited on the visibility endpoint, the same as every other cookbook mutation.
- [ ] **AC15** — `npm test` passes with no regressions. `src/views/recipeCard.test.js`, `src/views/recipeVisibility.test.js`, and `src/views/organizationCardGrid.test.js` all still pass against the edited templates, and the new unit tests from Task 10 pass.
- [ ] **AC16** — `database/migrations/019_add_cookbook_sharing.sql` is a new file; `git diff` shows **no** modification to any migration `001`–`018`.

## What changed since the previous plan (2026-09-08 → 2026-09-14)

| # | Previous plan said | Corrected to | Why |
| --- | --- | --- | --- |
| 1 | Migration `011_add_cookbook_sharing.sql` | **`019_add_cookbook_sharing.sql`** | `011`/`012` are meal plans (REW-63); `013`–`018` shipped since. `018_add_recipe_clone_provenance.sql` is the current head. |
| 2 | "CSRF remains globally disabled repo-wide (pre-existing)… the inert `_csrf` field" | **CSRF is enforced globally** via `csrfProtectionExceptMultipart` in `src/app.js`; the token is real and required | Factually wrong before, and a security-relevant error: a developer trusting it might have shipped a form that 403s, or "fixed" it by exempting the route. |
| 3 | Show the cookbook owner's display name via `getAccountDisplayName()` | **No cookbook-level owner attribution**; per-recipe `recipe.author` only | `getAccountDisplayName()` reads `user_metadata` off an auth user object — it can only describe the current viewer. The anon client cannot read another account's `auth.users` row. Doing this properly needs new schema the ticket didn't ask for. |
| 4 | Body shape `{ isPublic: "true" \| "false" }` | **`visibility=private\|public`**, normalized fail-closed | REW-85 shipped after the previous plan and established this convention app-wide (`src/utils/recipeVisibility.js`, `name="visibility"` radios). |
| 5 | "reuse `views/partials/recipe-card.ejs` **if** its props line up — check before deciding" | **Confirmed it fits**; reuse it | Verified: it needs only `id/title/thumbnail_url/prep_time/cook_time/servings/author`, links to `/r/:id`, and already has a signed-out branch. |
| 6 | (not mentioned) | **Existing view tests render the edited templates with fixed locals** — `src/views/recipeCard.test.js` lines ~80 and ~134 render `recipes/search.ejs` and `cookbooks/view.ejs` without `cookbooks`/`appUrl` | New required locals would break passing tests. Now called out with the guard requirement. |
| 7 | (not mentioned) | **`src/views/recipeVisibility.test.js` pins Private/Public wording** in `views/cookbooks/view.ejs`, and **`organizationCardGrid.test.js` pins the grid class** | Both shipped after the previous plan and constrain this ticket's template edits. |
| 8 | (not mentioned) | **Explicit `GRANT SELECT` to `anon, authenticated`** on both cookbook tables, and `TO anon, authenticated` on the new policies | Matches the pattern `003` and `013` actually use; 009/010 omitted `TO` clauses, so consistency had to be chosen deliberately. |
| 9 | "reuse `getCookbookRecipes()` … or a small local duplicate" | **Do not reuse it** — it is module-private and owner-client shaped; write a local anon-client fetch with an inner-join embed | Verified its signature and visibility in `src/routes/cookbookRoutes.js`. |
| 10 | RPC returns "enough to join a recipe count if useful" | RPC returns an explicit **published-only** recipe count | Without the explicit predicate, `SECURITY INVOKER` + RLS makes the owner see a count inflated by their own drafts. |
| 11 | "no regressions to the existing 120 tests" | "no regressions" (no count) | The suite has grown; a hardcoded count would be stale again immediately, and I have no shell in this environment to re-count. |
| 12 | Cloning "not requested and not built" | Still out of scope, **but** REW-84 shipped recipe-level cloning (`POST /recipes/:id/clone`), reachable from `/r/:id` | Changes the follow-up recommendation: only *cookbook*-level cloning remains unbuilt. |
| 13 | 9 acceptance criteria, prose-numbered | **16 numbered criteria**, each independently verifiable | Adds DB-layer verification (AC11), CSRF/fail-closed (AC13), rate limiting (AC14), empty-public-cookbook (AC6), malformed-id (AC7), and migration-immutability (AC16). |
| 14 | Typo: "renders the same generic not found response Rin both cases" | Fixed | — |
| 15 | Task 8 "no new pure helpers are strictly required" | **Helper is required** (Task 5) and must fail closed | The REW-85 convention makes normalization non-optional. |

## References

- `docs/plans/rew-62-cookbooks.md` — the base feature this extends.
- `database/migrations/003_add_recipe_search.sql` — the `tsvector` + GIN + `STABLE`/`SECURITY INVOKER` RPC + grants pattern reused for `search_cookbooks`.
- `database/migrations/013_public_recipe_card_metadata.sql` — the `TO anon, authenticated` additive-policy + explicit-grant pattern.
- `src/routes/publicRoutes.js` (`GET /r/:id`) — the anon-client + generic-not-found pattern reused for `GET /c/:id`.
- `src/routes/recipeRoutes.js` (`handleRecipeUpdate`) and `src/routes/recipeVisibilityRoutes.test.js` — the injectable-client handler-export pattern for unit-testing a route.
- `src/utils/recipeVisibility.js` (REW-85) — the fail-closed Private/Public normalization this ticket mirrors.
- `src/utils/authUtils.js` (`getAppUrl()`, REW-57) — share-link origin without trusting request headers.
