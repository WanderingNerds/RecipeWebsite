# Cookbooks (REW-62, REW-19)

**Feature:** REW-62 — Create and Manage Cookbooks; REW-19 — Cookbook Sharing
**Component:** `src/routes/cookbookRoutes.js`, `src/routes/publicRoutes.js` (REW-19 public surfaces), `src/utils/cookbookUtils.js`, `src/routes/recipeRoutes.js` (recipe-view integration), `views/cookbooks/*.ejs`, `views/recipes/view.ejs`, `views/recipes/search.ejs`, `public/js/cookbook-share.js`, `database/migrations/009_create_cookbooks_table.sql`, `database/migrations/010_create_cookbook_recipes_table.sql`, `database/migrations/019_add_cookbook_sharing.sql`
**Last Updated:** 2026-09-14

---

## Overview

A cookbook is a per-user named collection of the owner's own recipes. Users can create, rename, and delete cookbooks, and add/remove recipes from a cookbook independently of the recipe's own lifecycle (draft or published). A cookbook belongs to exactly one user; a single recipe can belong to any number of cookbooks. Deleting a cookbook never deletes the recipes in it, and deleting a recipe removes it from any cookbooks it belonged to without error.

Cookbooks are **private by default**, enforced at the database (RLS) layer rather than by hiding links in the UI. As of **REW-19**, an owner can additionally flip one cookbook at a time to **Public**, which makes it readable by anyone at `GET /c/:id` and discoverable in site search. Private remains the default for every new cookbook and for every cookbook that existed before migration 019.

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

### `POST /cookbooks/:id/visibility` (REW-19)

Switches a cookbook between Private and Public. Owner-only.

**Middleware:** `requireAuth`, then the existing `cookbookLimiter` (30 requests/minute per user — no new limiter was added). Global CSRF protection applies; the form must carry a valid `_csrf` token.

**Request:** `application/x-www-form-urlencoded`

| Field | Values | Notes |
|-------|--------|-------|
| `_csrf` | token | Required. There is no CSRF exemption for this route |
| `visibility` | `private` \| `public` | Follows the REW-85 recipe-visibility form convention. **Fails closed:** only the exact lowercase string `public` produces a Public cookbook |

`visibility` is normalized by `normalizeCookbookVisibility()` (`src/utils/cookbookUtils.js`) into the boolean stored in `cookbooks.is_public`. A missing field, an array (duplicated inputs), a differently-cased value such as `PUBLIC`, the string `true`, a number, or an object all resolve to Private. A malformed or forged submission therefore cannot accidentally share a cookbook.

**Behavior:**
- `:id` is screened against the file's UUID pattern before any query runs; a malformed ID is treated as not-found.
- The update is filtered on **both** `.eq("id", id)` and `.eq("user_id", req.user.id)` in application code, in addition to the RLS UPDATE policy — the belt-and-suspenders convention used by the rename and delete handlers. A non-existent cookbook and someone else's cookbook produce the same user-facing failure, so neither can be probed for.
- A genuine database error and a not-found/not-owned result are logged differently but produce an identical flash message.

**Response:** redirect to `/cookbooks/:id` with a flash message using Private/Public wording, never draft/published: *"This cookbook is now Public. Anyone with the link can view it."* or *"This cookbook is now Private. Its share link no longer works."*

**Side effects it deliberately does not have:** it never writes `recipes.status`, never adds or removes `cookbook_recipes` rows, and never touches any other cookbook.

The handler is exported as `handleCookbookVisibilityUpdate(req, res, { createClient })` with an injectable Supabase client factory, following the `handleRecipeUpdate` precedent, so it can be unit-tested with a fake query builder.

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

## Public surfaces (REW-19) — `src/routes/publicRoutes.js`

These two routes are **unauthenticated**. Every query on them runs on the module-level **anon-key** Supabase client exported from `src/config/supabase.js` — never `createSupabaseClient(req.accessToken)`, and never any owner-scoped client, even when the person viewing is the cookbook's own owner. That is not a stylistic preference: under the anon key `auth.uid()` is null, so the `recipes` SELECT policy from migration `001` (owner **or** `status = 'published'`) can only ever return published recipes. Draft privacy in a shared cookbook is therefore structural, not a filter a future edit could forget.

Both routes are covered by the production-only `generalLimiter` in `src/app.js`, like every other public GET.

### `GET /c/:id`

Read-only public view of a Public cookbook. The cookbook's own UUID is the share identifier — there is no share token, slug, or `cookbook_shares` table, matching the existing precedent at `GET /r/:id` for published recipes.

**Auth:** none. Results are identical whether or not the visitor is signed in.

**Behavior:**
1. `:id` is screened against the UUID pattern; a malformed ID short-circuits to the not-found render without a query.
2. The cookbook is fetched with `.eq("id", id).eq("is_public", true)`, selecting only `id, title, created_at`.
3. Its recipes are fetched from `cookbook_recipes` with an **inner-join embed** (`recipes!inner(...)`) plus an explicit `.eq("recipes.status", "published")`. The inner join drops membership rows whose recipe is RLS-invisible instead of returning them with a null embed; any null embed that still slips through (a delete racing the query) is filtered out defensively. Ordering is by the membership row's `created_at` descending, matching the owner view.
4. Renders `views/cookbooks/public-view.ejs`.

**Responses:**

| Case | Response |
|------|----------|
| Public cookbook exists | 200, read-only page: title, recipe count, published-recipe cards linking to `/r/:id` |
| Public cookbook with no published recipes | 200, neutral empty state ("This cookbook doesn't have any Public recipes yet.") — deliberately no "n hidden" counter |
| Cookbook is Private | **404**, `views/error.ejs`, message "That cookbook doesn't exist or isn't shared." |
| Cookbook does not exist | **404**, identical status, template, and message |
| `:id` is malformed | **404**, identical status, template, and message |

The three 404 cases are intentionally indistinguishable — same status, same template, same string, no extra query on the private branch — so a Private cookbook's existence can never be probed.

**The page is read-only for everyone, including the owner.** There is no `isOwner` branch and no mutation form anywhere in the template, which is why the handler never needs to construct an owner-scoped client.

### `GET /search` — Cookbooks section

The existing recipe search is unchanged: same `search_recipes` call, same pagination, same empty-query short-circuit. REW-19 adds a secondary result set.

- When the query is non-empty **and** `page === 1`, the handler additionally calls the `search_cookbooks` RPC with `result_limit: 5`, `result_offset: 0`, reusing the same already-trimmed, 100-character-capped `query` string rather than re-reading `req.query.q`.
- Page 2 and beyond skip the RPC entirely. The section is a single capped set, not a paginated one; re-running the same offset-0 query would otherwise repeat the identical five cookbooks under every page of recipe results.
- A `search_cookbooks` failure **degrades silently**: it is logged and `cookbooks` is passed as an empty array. It does not flash or redirect to `/browse` the way a `search_recipes` failure does — a cookbook-search outage must not take recipe search down with it.
- `cookbooks` is passed on every render path from this handler, including the empty-query path, so the template never sees an undefined local.
- `views/recipes/search.ejs` guards the section with `typeof cookbooks !== 'undefined'` and renders it only when non-empty. If a query matches zero recipes but one or more cookbooks, the page shows the cookbook section with the line "No recipes match "…", but these cookbooks do." instead of a dead-end no-results state.

Each entry links to `/c/:id` and shows the title plus the RPC's published-only `recipe_count`. Private cookbooks never appear, for anyone, including their own owner.

---

## Owner-facing UI (REW-19)

- **`views/cookbooks/view.ejs`** — a labelled cookbook-level visibility control in the header action row (a Private/Public state badge plus a "Make Public"/"Make Private" submit), deliberately structured as a control rather than another bare badge so it reads as distinct from the per-recipe Private/Public pills on the cards below. When the cookbook is Public, a share panel shows the full URL in a read-only input with a **Copy link** button.
- **Share URL origin comes from `getAppUrl()`** (`src/utils/authUtils.js`, the REW-57 helper), passed in by the route as the `appUrl` local — never from `req.headers.host` or `X-Forwarded-Host`. This string exists to be copied and re-shared by a human, so a header-derived origin would be a ready-made phishing vector. The local is guarded with `typeof` so templates rendered directly in tests without it still render.
- **`public/js/cookbook-share.js`** — the Copy-link handler only, loaded with a page-local `<script src>` tag at the bottom of the view. CSP is `script-src 'self'`; there are no inline handlers, no inline script bodies, and no CSP changes.
- **`views/cookbooks/index.ejs`** — a small Public marker on shared cookbooks so an owner can see at a glance which of their cookbooks are shared.

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
- **Privacy is structural, not just UI-level:** a Private cookbook has no RLS policy under which a non-owner can read it, so a direct request for another user's `/cookbooks/:id` (or a direct Supabase query as another authenticated user) returns nothing, regardless of route code. REW-19's additional SELECT policy is scoped strictly to `is_public = true` rows and changes nothing for Private cookbooks.
- **"Add from own recipes only" is enforced at the database layer too:** `cookbook_recipes`'s INSERT RLS policy requires the inserting user to own *both* the target cookbook and the recipe being added — not just application-layer validation.
- **Rate limiting:** 30 mutation requests/minute per user (`cookbookLimiter`), shared across create/rename/delete/bulk-add/single-add/remove.
- **Input validation:** cookbook title is required, trimmed, and capped at 200 characters both in `cookbookUtils.validateCookbookTitle()` (unit-tested) and via a DB `CHECK` constraint. Route params (`:id`, `:recipeId`) are validated against a UUID pattern before querying. Recipe-ID selections from bulk-add forms are normalized/deduped/filtered via `cookbookUtils.normalizeRecipeIdSelection()` (also unit-tested).
- **CSRF:** CSRF protection **is enforced** globally via `csrfProtectionExceptMultipart` in `src/app.js`; `POST` is not in `ignoredMethods` and `res.locals.csrfToken` is populated for every render. Every cookbook form, including the REW-19 visibility form, carries a real `_csrf` token and is rejected without one. (An earlier revision of this page stated CSRF was disabled repo-wide — that was correct when REW-62 shipped and is no longer true. Corrected 2026-09-14.)

### Sharing-specific (REW-19)

- **Draft-recipe leakage was the highest-risk item in this change.** The mitigations, in order of how much weight they carry:
  1. `GET /c/:id` and its recipe fetch use the anon-key client exclusively — the appearance of `createSupabaseClient(...)`, `req.accessToken`, or `req.cookies["sb-access-token"]` anywhere in that handler is a blocking review finding.
  2. The `cookbook_recipes` public SELECT policy requires **both** a public parent cookbook and a published recipe, so a direct anon-key PostgREST read cannot enumerate the count, UUIDs, or add-times of a Public cookbook's draft membership edges.
  3. An explicit `status = 'published'` predicate in the query, as defence in depth.
- **Existence disclosure:** Private, nonexistent, and malformed cookbook IDs return byte-identical 404s at `/c/:id` — no distinct flash, no redirect to login, no extra query on the private branch.
- **Fail-closed input:** `normalizeCookbookVisibility()` only returns `true` for the exact string `"public"`. Everything else is Private.
- **Rate limiting:** the visibility endpoint reuses the existing 30/minute-per-user `cookbookLimiter` shared by every other cookbook mutation. No route-level bypass was added.
- **RPC posture:** `search_cookbooks` is `STABLE` + `SECURITY INVOKER` + `SET search_path = public, pg_temp`, matching `search_recipes`. Under `SECURITY DEFINER` the function's own `is_public` filter would become the only thing standing between a visitor and every private cookbook in the database.
- **No cached visibility:** `/c/:id` and `/search` read `is_public` from Postgres on every request. Nothing memoizes it or stores it in the session, which is what makes revocation immediate.
- **No new redirect surface:** the share link is a fixed internal `/c/:id` path built from a database-stored UUID. Nothing user-supplied shapes it.

---

## Testing notes

- `src/utils/cookbookUtils.test.js` unit-tests `validateCookbookTitle()` and `normalizeRecipeIdSelection()` (blank/whitespace rejection, max-length boundary, dedup, malformed/non-string filtering, case-insensitive UUID matching). Part of `npm test` (120/120 passing as of this change).
- No request-level/integration tests exist for `cookbookRoutes.js`, consistent with every other Supabase-backed route file in this codebase (none have a live-Supabase-dependent test harness). Acceptance criteria in `docs/plans/rew-62-cookbooks.md` require manual verification against a running app — **that pipeline run explicitly skipped the QA stage**, so manual verification of the full acceptance-criteria list (including the "another user's session cannot view a cookbook via direct URL" RLS check) has not yet been confirmed against a live environment.

### REW-19

Automated coverage added with the change:
- `src/utils/cookbookUtils.test.js` — `normalizeCookbookVisibility()` fail-closed cases (`"public"` → true; `"private"`, `undefined`, `null`, `["public"]`, `"PUBLIC"`, `"true"`, numbers, objects → false).
- `src/routes/cookbookVisibilityRoutes.test.js` (new) — drives the exported handler with a fake query builder: the stored value flips correctly for both inputs, both the `id` and `user_id` filters are applied on every call, a malformed UUID never reaches the database, and an unknown `visibility` value fails closed to Private.
- `src/routes/publicRoutes.test.js` — `/c/:id` filters on both `id` and `is_public = true`, a null result renders the 404 path, and migration `019` literally contains an `is_public = true` predicate, declares `SECURITY INVOKER`, and contains no `MATERIALIZED VIEW`.
- `src/views/*` — render assertions for `views/cookbooks/public-view.ejs` (no edit/delete/add-recipes/remove strings, no mutation `<form>`, links go to `/r/<id>`, empty state renders for an empty recipe list), plus the pre-existing `recipeCard.test.js`, `recipeVisibility.test.js`, and `organizationCardGrid.test.js` against the edited templates.

Suite result: **355 tests, 353 passing.** The 2 failures are pre-existing environmental `EACCES /tmp/*.sock` unix-socket errors in `src/csrf.integration.test.js` on Windows, unrelated to this change.

**QA was not run for REW-19, and several acceptance criteria are unverified.** Nothing in this feature has been exercised against a live Supabase with migration `019` applied. Specifically unconfirmed: the `Host`-header-spoofing check on the rendered share URL (AC3), the "zero trace of a draft recipe at `/c/:id`" check for visitor, other user, and owner (AC5), the all-private empty state (AC6), the direct PostgREST anon/cross-user reads of a Private cookbook's rows and a Public cookbook's draft membership edges (AC11), the "toggling visibility changes no recipe's status and no membership" invariant (AC12), and rate limiting on the visibility endpoint (AC14). These need a manual pass before the feature is treated as verified.

---

## Related documentation

- [API Overview](README.md)
- Plans: `docs/plans/rew-62-cookbooks.md`, `docs/plans/rew-19-cookbook-sharing.md`
- `database/README.md` — `cookbooks` / `cookbook_recipes` tables, the `search_cookbooks()` RPC, RLS policies, indexes
- Release notes: `docs/RELEASE_NOTES_REW-62.md`, `docs/RELEASE_NOTES_REW-19.md`
- Follow-up: [REW-91](https://wanderingnerds.atlassian.net/browse/REW-91) — cookbook-level cloning ("save this whole cookbook"), explicitly out of scope here

---

## Changelog

| Date | Change |
|------|--------|
| 2026-09-08 | Page created documenting REW-62 (new feature — no prior version to reconcile). |
| 2026-09-14 | REW-19 cookbook sharing: added `POST /cookbooks/:id/visibility`, the public `GET /c/:id` surface, the `GET /search` Cookbooks section, owner-facing share UI, and sharing-specific security notes. Corrected the stale "CSRF is disabled repo-wide" claim in Security — CSRF is enforced. Reviewer-approved; QA not run. |
