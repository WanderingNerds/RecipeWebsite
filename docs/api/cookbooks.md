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

**Widened in REW-88** to feed the shared standardized recipe card. The URL, middleware (`requireAuth`), auth rules, and redirect behavior are unchanged; only the shape of the data handed to the template changed. See the REW-88 section below.

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

**Middleware:** `requireAuth`, then route-level `csrfProtection`, then the existing `cookbookLimiter` (30 requests/minute per user — no new limiter was added), in that order. The route-level `csrfProtection` is re-applied (REW-105) because the global `csrfProtectionExceptMultipart` wrapper skips token validation for any `multipart/form-data` body and this handler reads no body fields, so a forged cross-site multipart POST would otherwise reach it and delete the victim's own cookbook. CSRF runs *ahead of* the limiter so a forged request cannot burn the victim's 30/minute quota. The delete form posts `application/x-www-form-urlencoded` with a hidden `_csrf`, so the fix is transparent to it; a multipart POST is rejected with 403 even if it carries a valid `_csrf` part, because the route has no Multer stage. Pinned by `src/routes/cookbookDeleteRoutes.test.js`.

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

**Middleware:** `requireAuth`, then route-level `csrfProtection`, then the existing `cookbookLimiter`, in that order. The route-level check was added in REW-102: the global `csrfProtectionExceptMultipart` wrapper skips token validation for any `multipart/form-data` body and this handler reads no body fields, so a forged cross-site multipart POST would otherwise upsert a `cookbook_recipes` row on the victim's behalf. Additive and reversible rather than destructive, but its already-protected JSON twin `POST /api/cookbooks/:id/recipes/:recipeId` carries the same check, so this is consistency rather than new policy. The "+ Add to &lt;cookbook&gt;" form posts urlencoded with a hidden `_csrf`, so the fix is transparent to it. Pinned by a chain-shape assertion in `src/routes/cookbookRoutes.test.js`.

### `POST /cookbooks/:id/recipes/:recipeId/remove`

Removes a recipe from a cookbook (deletes the `cookbook_recipes` row only — **the recipe itself is never deleted or modified**, and it remains in any other cookbooks it belonged to). Used by both the cookbook detail page and the recipe view page's "Save to Cookbook(s)" widget.

- Accepts an optional `returnTo` form field: `returnTo=recipe` redirects back to `/recipes/:recipeId`; anything else (including omitted) redirects back to `/cookbooks/:id`, so both call sites can send the user back to where they clicked "Remove."
- **No route-level `csrfProtection`, and this is a known fragility, not a decision.** The route survives the multipart bypass only because `req.body.returnTo` is the first statement in its `try` and throws a `TypeError` on the unparsed body. With `req.body === {}` — or after anyone rewrites the read as `req.body?.returnTo` — the delete would run for a forged cross-site POST, exactly as it did on the meal-plan equivalent before REW-102. Recorded as the REW-99 tripwire in the [route-level CSRF audit](README.md#rew-99-regression-tripwire-read-this-before-touching-the-wrapper); whoever works [REW-99](https://wanderingnerds.atlassian.net/browse/REW-99) must add the route-level check here in the same change.

---

## JSON API (REW-86) — `src/routes/cookbookApiRoutes.js`, mounted at `/api/cookbooks`

A separate, additive JSON surface backing the `+ Cookbook` action on recipe cards. It does **not**
replace any route above; the recipe detail page's "Save to Cookbook(s)" widget still uses the
form-based routes, which are unchanged.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cookbooks?recipeId=<uuid>` | List the caller's cookbooks (`id`, `title`) with a `containsRecipe` flag per cookbook |
| POST | `/api/cookbooks` | Quick-create a cookbook (`{ title }`, same `validateCookbookTitle()` rules) |
| POST | `/api/cookbooks/:id/recipes/:recipeId` | Add an owned recipe to an owned cookbook, duplicate-safe |
| DELETE | `/api/cookbooks/:id/recipes/:recipeId` | Remove the membership row only |

- **Auth:** `requireApiAuth` on every route — JSON `401`, never a login redirect. There is no
  anonymous read case here; the public cookbook read stays at `GET /c/:id`.
- **CSRF:** re-applied at the route level on every mutation (`requireApiAuth` → `csrfProtection` →
  limiter), because the global `csrfProtectionExceptMultipart` skips multipart bodies. `GET /` is
  not CSRF-checked, by design, since it changes nothing.
- **Rate limit:** a dedicated `cookbookApiLimiter`, 30 mutations/minute keyed on `req.user.id` —
  separate from `cookbookLimiter` on the form routes, mirroring `mealPlanApiLimiter`.
- **Authorization:** identical rules to `POST /cookbooks/:id/recipes/:recipeId` — the cookbook must
  be the caller's and so must the recipe. Owner-only is the correct rule for the My Recipes surface
  this powers; widening to other users' Public recipes remains REW-59's call. Not-found and
  not-owned return the same `404`.
- **Idempotency:** `upsert(..., { onConflict: "cookbook_id,recipe_id", ignoreDuplicates: true })`,
  so a double click is a no-op rather than a primary-key error.
- **Client:** `views/partials/cookbook-modal.ejs` (included once in the layout, gated on `user`) and
  `public/js/cookbooks.js` (external file — CSP is `script-src 'self'`; fetches inherit the
  `x-csrf-token` header from the `main.js` wrapper; titles render via `textContent`).

Covered by `src/routes/cookbookApiRoutes.test.js` (15 cases). See
[My Recipes Recipe Card](my-recipes-card.md) for the full contract and response table.
**Branch-only: implemented and reviewed on `REW-86-standardize-my-recipes-card`, QA not run, not
yet merged. REW-59 has its own cookbook JSON API on its branch — whoever merges second must
reconcile the two rather than shipping both.**

---

## Standardized cookbook card (REW-88) — `GET /cookbooks/:id`

The cookbook detail page stopped hand-rolling its own recipe card and now renders the shared
`views/partials/recipe-summary-card.ejs` with `surface: 'cookbook'`. Two route-level changes feed
it. **Neither is a breaking change**: no route was added or renamed, no middleware changed, and no
JSON response shape was touched.

1. **`COOKBOOK_CARD_COLUMNS`** widens the nested `recipes(...)` select with `user_id`,
   `original_author`, and the embedded `recipe_categories(categories(id, name, slug, icon))` /
   `recipe_tags(tags(id, name, slug))` relations, mirroring `FAVORITE_CARD_COLUMNS` in
   `src/routes/index.js` — both surfaces render the same partial, so both must feed it the same
   shape. `getCookbookRecipes` is now exported, flattens the junction rows into flat
   `categories` / `tags`, keeps its defensive drop of a null `recipes` embed, and keeps the junction
   row's `created_at DESC` (added-to-cookbook) ordering. One query; a failed read returns `[]`.
2. **`GET /:id` was extracted into an exported `handleCookbookView(req, res, { createClient })`**
   with an injectable Supabase client factory, following the `handleCookbookVisibilityUpdate`
   precedent, so the data contract is unit-testable without a live Supabase. It stamps `isLiked` per
   recipe from a **single** batched `recipe_likes` query filtered by `.eq("user_id", req.user.id)`
   and `.in("recipe_id", ids)` on the request-scoped client, skips that query entirely for an empty
   cookbook, and logs-and-continues on failure (hearts render unfavorited) rather than failing the
   page. The mounted route still runs behind `requireAuth`.

Net cost: one cookbook read, one recipe read, one likes read, regardless of how many recipes the
cookbook holds.

`user_id` is fetched solely so the card can compute `isOwner` and decide whether to draw Edit and
Delete. It is never rendered into the HTML, and it is never the authorization check — ownership is
enforced independently by `/recipes/:id/edit`, `/:id/update`, and `/:id/delete`.

**No migration.** Migration `001` already grants SELECT on own rows and on any published row, all
columns; `005`/`006` grant owner SELECT on the junction tables (which is what makes chips readable
on the owner's Private recipes); `013` adds published-recipe SELECT for `anon`/`authenticated` plus
the matching `categories`/`tags` lookups.

Covered by `src/routes/cookbookRoutes.test.js` (new, 10 cases). The full card contract, the shared
partial's four-surface local-variable interface, the design decisions, and the open follow-ups are
documented in [Cookbook Recipe Card](cookbook-card.md).

**Branch-only: implemented and reviewer-approved on `REW-88-standardize-cookbook-recipe-card` with
no blocking issues. QA was deliberately skipped, and the branch is unmerged and unpushed.** A manual
smoke test against a live Supabase is specifically outstanding — `getCookbookRecipes` is the repo's
first three-level PostgREST embed and returns `[]` on error, which renders as the empty state with
no flash.

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

> **Updated by REW-88:** the per-recipe Private/Public pills referred to below now live in
> `views/partials/recipe-summary-card.ejs` rather than inline in `views/cookbooks/view.ejs`, and are
> rendered **only to the recipe's owner**. The cookbook-level control described here is unchanged,
> and the distinction it was designed to make — a labelled cookbook control that cannot be confused
> with a per-recipe pill — is now asserted against rendered output rather than template source.

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
- **CSRF:** CSRF protection **is enforced** globally via `csrfProtectionExceptMultipart` in `src/app.js`; `POST` is not in `ignoredMethods` and `res.locals.csrfToken` is populated for every render. Every cookbook form, including the REW-19 visibility form, carries a real `_csrf` token and is rejected without one. (An earlier revision of this page stated CSRF was disabled repo-wide — that was correct when REW-62 shipped and is no longer true. Corrected 2026-09-14.) **Two routes on this surface additionally re-apply `csrfProtection` at the route level, ahead of `cookbookLimiter`:** `POST /cookbooks/:id/delete` (REW-105) and `POST /cookbooks/:id/recipes/:recipeId` (REW-102). The global wrapper skips multipart bodies and neither handler reads a body field, so both were forgeable cross-site until the route-level check was added. Placing CSRF before the limiter also means forged requests consume none of the victim's quota. **Still open on this surface:** `POST /cookbooks/:id/visibility` and `POST /cookbooks/:id/recipes/:recipeId/remove` are safe against the bypass only because a property access on an `undefined` body throws — the first would fail closed to Private and silently un-share the cookbook, the second would delete the membership row. Both are recorded as the REW-99 tripwire in the [route-level CSRF audit](README.md#rew-99-regression-tripwire-read-this-before-touching-the-wrapper).

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
- [Cookbook Recipe Card](cookbook-card.md) — the standardized card on `/cookbooks/:id`, the shared partial's four-surface contract, and the widened read behind it (REW-88)
- Plans: `docs/plans/rew-62-cookbooks.md`, `docs/plans/rew-19-cookbook-sharing.md`, `docs/plans/rew-88-standardize-cookbook-card.md`
- `database/README.md` — `cookbooks` / `cookbook_recipes` tables, the `search_cookbooks()` RPC, RLS policies, indexes
- Release notes: `docs/RELEASE_NOTES_REW-62.md`, `docs/RELEASE_NOTES_REW-19.md`
- Follow-up: [REW-91](https://wanderingnerds.atlassian.net/browse/REW-91) — cookbook-level cloning ("save this whole cookbook"), explicitly out of scope here

---

## Changelog

| Date | Change |
|------|--------|
| 2026-09-08 | Page created documenting REW-62 (new feature — no prior version to reconcile). |
| 2026-09-14 | REW-19 cookbook sharing: added `POST /cookbooks/:id/visibility`, the public `GET /c/:id` surface, the `GET /search` Cookbooks section, owner-facing share UI, and sharing-specific security notes. Corrected the stale "CSRF is disabled repo-wide" claim in Security — CSRF is enforced. Reviewer-approved; QA not run. |
| 2026-09-15 | REW-86: added the `/api/cookbooks` JSON API section (list-with-membership, quick-create, duplicate-safe add, remove) backing the `+ Cookbook` card action, plus its modal/JS client. No change to any existing `/cookbooks*` route, and no migration. Reviewer-approved; QA not run; branch not merged. |
| 2026-09-20 | REW-105: `POST /cookbooks/:id/delete` now runs `requireAuth` → route-level `csrfProtection` → `cookbookLimiter` → handler, closing the multipart CSRF bypass on a destructive route (the global wrapper skips multipart bodies and this handler reads none). CSRF is placed ahead of the limiter so forged requests burn no quota. No handler, ownership-filter, view, or schema change; pinned by `src/routes/cookbookDeleteRoutes.test.js`. |
| 2026-09-20 | REW-102: `POST /cookbooks/:id/recipes/:recipeId` now runs `requireAuth` → route-level `csrfProtection` → `cookbookLimiter` → handler, matching its already-protected JSON twin. Documented the REW-99 tripwire on `POST /cookbooks/:id/visibility` and `POST /cookbooks/:id/recipes/:recipeId/remove`, both of which are safe only because a property access on an unparsed body throws. No handler, validator, view, limiter or schema change; pinned by a chain assertion in `src/routes/cookbookRoutes.test.js`. QA stage skipped — manual verification outstanding. |
| 2026-09-15 | REW-88: `GET /cookbooks/:id` now renders the shared standardized recipe card. Documented the widened `getCookbookRecipes` select, the flattened categories/tags, the exported `handleCookbookView` and its batched `isLiked` query, and noted that the per-recipe status pill moved into the shared partial and is now owner-only. No new route, no migration. Reviewer-approved; **QA deliberately skipped**; branch unmerged. |
