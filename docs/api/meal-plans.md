# Meal Plans (REW-63, REW-69)

**Feature:** REW-63 — Create and Manage Meal Plans; REW-69 — Add Meal Plan Sharing
**Component:** `src/routes/mealPlanRoutes.js`, `src/routes/mealPlanApiRoutes.js`, `src/routes/publicRoutes.js` (REW-69 public surface), `src/utils/mealPlanUtils.js`, `views/meal-plans/*.ejs`, `views/partials/meal-plan-modal.ejs`, `public/js/meal-plans.js`, `public/js/meal-plan-share.js`, `database/migrations/011_create_meal_plans_table.sql`, `database/migrations/012_create_meal_plan_recipes_table.sql`, `database/migrations/020_add_meal_plan_sharing.sql`
**Also covers:** REW-26 — Grocery list generation (`src/utils/groceryList.js`, `views/meal-plans/grocery-list.ejs`); REW-89 — Standardized meal plan recipe cards (see [Meal Plan Recipe Card](meal-plan-card.md))
**Last Updated:** 2026-09-15

---

## Overview

A meal plan is a private, per-user named collection of recipes scoped to a required start/end date range — in contrast to [Cookbooks](cookbooks.md) (REW-62), which are open-ended, undated collections. A meal plan belongs to exactly one user, requires a title and a valid date range (`end_date >= start_date`), and can hold any number of recipes; a single recipe can belong to any number of meal plans (and independently, any number of cookbooks — the two features don't interact). Users can create, rename/re-date, and delete meal plans (deleting a plan never deletes its recipes), and can add/remove recipes from a plan independently of the recipe's own draft/published lifecycle.

Meal plans are **private by default**, enforced at the database (RLS) layer rather than by hiding links in the UI. As of **REW-69**, an owner can additionally flip one plan at a time to **Public**, which makes it readable by anyone at `GET /m/:id`. Private remains the default for every new plan and for every plan that existed before migration `020`.

Unlike Public cookbooks, a Public meal plan is **link-only**: it is never surfaced in site search. See "Public surfaces (REW-69)" below for why.

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

Meal plan detail: title, date range, and all recipes currently in it (most recently added first). As of REW-69 the render locals also include `appUrl: getAppUrl()` (`src/utils/authUtils.js`), used to build the share URL — never `req.headers.host` or `X-Forwarded-Host`. Ownership is checked via `getOwnedMealPlan()` (`.eq("user_id", ...)` filter, belt-and-suspenders with the RLS policy itself) — a plan that doesn't exist, or belongs to another user, renders identically as "Meal plan not found" and redirects to `/meal-plans`, never leaking whether the ID exists.

**Widened in REW-89 (no contract change).** The URL, middleware, auth, redirects and not-found behavior are all unchanged; only the shape of the data handed to the template changed. `GET /:id` was extracted into an exported `handleMealPlanView(req, res, { createClient } = {})` with an injectable Supabase client factory — following the `handleMealPlanVisibilityUpdate` precedent in the same file — so the data contract can be unit-tested without a live Supabase. `getMealPlanRecipes()` is now exported and selects `MEAL_PLAN_CARD_COLUMNS`, which adds `user_id` and `original_author` plus the embedded `recipe_categories(categories(...))` / `recipe_tags(tags(...))` relations, flattened into plain `categories` / `tags` arrays. The handler then stamps an `isLiked` flag per recipe from **one** batched `recipe_likes` query filtered to `req.user.id` and `.in()` the page's recipe ids — none at all for an empty plan, and a failure is logged and degrades to hearts rendering unfavorited rather than failing the page. Net: one plan read, one recipe read, one likes read, regardless of plan size. `getMealPlanRecipeIngredients()` (the grocery-list query, below) was deliberately left narrow and untouched. See [Meal Plan Recipe Card](meal-plan-card.md) for the card contract and the shared partial's five-surface local-variable interface.

### `GET /meal-plans/:id/grocery-list` (REW-26)

Read-only printable grocery list for an owned meal plan, rendered from `views/meal-plans/grocery-list.ejs`. **Nothing is persisted** — the list is derived on every request, so it always reflects the plan and its recipes as they are right now. There is no corresponding POST/PUT/DELETE, and the entry point on the plan detail page is a plain `GET` link (no form, no `_csrf` field), shown only when the plan has recipes.

- **Ownership:** identical to `GET /meal-plans/:id` — `requireAuth`, `UUID_PATTERN` validation on `:id`, then `getOwnedMealPlan()`. A nonexistent plan, another user's plan, and a malformed ID all produce the same "Meal plan not found" flash and redirect to `/meal-plans`.
- **Data:** a local helper (`getMealPlanRecipeIngredients()`) selects `recipe_id, created_at, recipes(id, title, ingredients)` for the plan with the caller's RLS-scoped client. It is deliberately separate from `getMealPlanRecipes()`, which feeds the card grid and must not start shipping full ingredient text on every plan detail render.
- **Unreadable memberships:** a row whose `recipes` join comes back `null` — the recipe was deleted, or it belonged to another user and has since been switched Public → Private (REW-85) — is skipped in application code (never worked around with a privileged client) and counted. The page shows only a count ("1 recipe in this meal plan could not be included"); the missing recipe's title and owner are never revealed.
- **Aggregation:** `src/utils/groceryList.js` (pure, unit-tested) parses each recipe's free-text `recipes.ingredients` with `parseIngredients()`, drops section headings ("For the sauce:") and blank lines, merges the same ingredient across recipes, and assigns each item to a fixed server-side aisle taxonomy (Produce, Meat & Seafood, Dairy & Eggs, Bakery, Frozen, Canned & Jarred, Dry Goods & Pasta, Baking, Spices & Seasonings, Condiments & Sauces, Beverages, Other), rendered in that walk-the-store order with empty categories omitted. This taxonomy is **not** the `categories` table, which classifies recipes (Breakfast/Dinner) — a different concept.
- **Amounts are only combined when the measurements are genuinely compatible:** volumes summed in millilitres, weights in grams, and counts summed per identical unit. Ranges ("2-3 cloves"), approximate units ("a pinch"), and lines with no parseable quantity are never folded into a number — they are listed side by side on the same line, so the shopper sees two honest amounts rather than one invented one. An item whose source line had no usable amount at all is flagged so the view can say "(check recipe)".
- **Serving scaling is out of scope:** quantities are used exactly as written (factor 1). `meal_plan_recipes.planned_servings` remains **unwritten and unread** by every route in this feature. That column has no UPDATE RLS policy on `meal_plan_recipes`, so making it user-editable needs its own ticket and its own migration.
- **No schema change:** REW-26 added no migration. It reads `meal_plans`, `meal_plan_recipes`, and `recipes.ingredients` through the existing RLS policies only.

### `GET /meal-plans/:id/edit`

Renders the rename/re-date form (`views/meal-plans/edit.ejs`) for an owned plan.

### `POST /meal-plans/:id/update`

Renames and/or re-dates a meal plan. Same title/date-range validation as create. Ownership is enforced by an explicit `.eq("user_id", req.user.id)` filter on the update, in addition to the RLS UPDATE policy.

### `POST /meal-plans/:id/visibility` (REW-69)

Switches a meal plan between Private and Public. Owner-only.

**Middleware:** `requireAuth`, then the existing `mealPlanLimiter` (30 requests/minute per user — no new limiter was added). Global CSRF protection applies; the form must carry a valid `_csrf` token.

**Request:** `application/x-www-form-urlencoded`

| Field | Values | Notes |
|-------|--------|-------|
| `_csrf` | token | Required. There is no CSRF exemption for this route |
| `visibility` | `private` \| `public` | Follows the REW-85 recipe-visibility form convention. **Fails closed:** only the exact lowercase string `public` produces a Public meal plan |

`visibility` is normalized by `normalizeMealPlanVisibility()` (`src/utils/mealPlanUtils.js`, alongside the exported frozen `MEAL_PLAN_VISIBILITY` constant) into the boolean stored in `meal_plans.is_public`. A missing field, an array (duplicated form inputs), a differently-cased value such as `PUBLIC`, the string `true`, `"published"`, a number, or an object all resolve to Private. A malformed or forged submission therefore cannot accidentally share a plan. The route does **not** accept a raw `isPublic=true|false`.

**Behavior:**
- `:id` is screened against the file's `UUID_PATTERN` before any query runs; a malformed ID flashes "Meal plan not found" and redirects to `/meal-plans` without touching the database.
- The update is filtered on **both** `.eq("id", id)` and `.eq("user_id", req.user.id)` in application code, in addition to the RLS UPDATE policy — the belt-and-suspenders convention used by the rename and delete handlers. A non-existent plan and someone else's plan produce the same user-facing failure, so neither can be probed for.
- A genuine database error and a not-found/not-owned result (`data === null`, `error === null`) are logged differently — only the former is logged as a database failure — but produce an identical flash message.

**Response:** redirect to `/meal-plans/:id` with a flash message using Private/Public wording, never draft/published: *"This meal plan is now Public. Anyone with the link can view it."* or *"This meal plan is now Private. Its share link no longer works."*

**Side effects it deliberately does not have:** it never writes `recipes.status`, never adds or removes `meal_plan_recipes` rows, never alters `start_date`/`end_date`, and never touches any other meal plan.

The handler is exported as `handleMealPlanVisibilityUpdate(req, res, { createClient })` with an injectable Supabase client factory — the first named export in `mealPlanRoutes.js` — following the `handleCookbookVisibilityUpdate` precedent, so it can be unit-tested with a fake query builder.

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

As of REW-89 the form that posts here lives inside the shared card partial rather than in `views/meal-plans/view.ejs`, and is rendered only when the caller passes a `mealPlanId` local. Nothing changed server-side: the route keeps `requireAuth`, `mealPlanLimiter`, both UUID guards, and its plan-ownership check, and the form still carries its own `_csrf` hidden field. Unlike the cookbook equivalent it sends **no** `returnTo` field, because this route always redirects to `/meal-plans/:id`.

---

## Public surface (REW-69) — `src/routes/publicRoutes.js`

This route is **unauthenticated**. Every query on it runs on the module-level **anon-key** Supabase client exported from `src/config/supabase.js` — never `createSupabaseClient(req.accessToken)`, never `req.cookies["sb-access-token"]`, and never any owner-scoped client, even when the person viewing is the plan's own owner. That is not a stylistic preference: under the anon key `auth.uid()` is null, so the `recipes` SELECT policy from migration `001` (owner **or** `status = 'published'`) can only ever return published recipes. Private-recipe privacy in a shared plan is therefore structural, not a filter a future edit could forget.

The route is covered by the production-only `generalLimiter` in `src/app.js`, like every other public GET. `publicRoutes` is already mounted at `/` in `src/routes/index.js`, so no registration change was needed.

### `GET /m/:id`

Read-only public view of a Public meal plan. The plan's own UUID is the share identifier — there is no share token, slug, or `meal_plan_shares` table, matching the existing precedent at `GET /r/:id` (recipes) and `GET /c/:id` (cookbooks).

**Auth:** none. Results are identical whether or not the visitor is signed in, and identical for the owner.

**Behavior:**
1. `:id` is screened against the file's UUID pattern; a malformed ID short-circuits to the not-found render without a query.
2. The plan is fetched with `.eq("id", id).eq("is_public", true)`, selecting only `id, title, start_date, end_date`. `user_id` is deliberately **not** selected — it has no business being handed to the template.
3. Its recipes are fetched by the module-local `getPublicMealPlanRecipes(mealPlanId)` helper from `meal_plan_recipes`, with an **inner-join embed** (`recipes!inner(id, title, author, prep_time, cook_time, servings, difficulty, thumbnail_url, created_at)`) plus an explicit `.eq("recipes.status", "published")`. The inner join drops membership rows whose recipe is RLS-invisible instead of returning them with a null embed; any null embed that still slips through (a delete racing the query) is filtered out defensively. Ordering is by the membership row's `created_at` descending, matching the owner view's `getMealPlanRecipes()`. A query error is logged and returns `[]` rather than failing the page.
4. Renders `views/meal-plans/public-view.ejs` with `{ title, mealPlan, recipes }`.

**Responses:**

| Case | Response |
|------|----------|
| Public plan exists | 200, read-only page: title, formatted start–end date range, visible recipe count, published-recipe cards linking to `/r/:id` |
| Public plan with no published recipes | 200, neutral empty state ("This meal plan doesn't include any Public recipes yet.") — deliberately no "n hidden" counter |
| Plan is Private | **404**, `views/error.ejs`, message "That meal plan doesn't exist or isn't shared." |
| Plan does not exist | **404**, identical status, template, and message |
| `:id` is malformed | **404**, identical status, template, and message |

The three 404 cases are intentionally indistinguishable — same status, same template, same string, and **no second query on the not-found branch** that could be timed — so a Private plan's existence can never be probed.

**The page is read-only for everyone, including the owner.** There is no `isOwner` branch, no `<form>`, no `_csrf`, and no mutation affordance anywhere in the template — no edit, rename, re-date, delete, add-recipe, remove-from-plan, or grocery-list control. That is why the handler never needs to construct an owner-scoped client. Signed-out visitors additionally see a sign-up call to action.

### Deliberate divergence from cookbook sharing: no search discoverability

REW-19 made a Public cookbook both linkable **and** discoverable via the `search_cookbooks` RPC on `/search`. REW-69 deliberately does **not** do the equivalent for meal plans:

- No `search_meal_plans` RPC, no `tsvector` column, no GIN/trigram index, no partial index.
- No change to `GET /search` or `views/recipes/search.ejs`.

A meal plan is a time-boxed personal schedule ("Week of Sept 20"), not browsable content. Indexing strangers' meal plans into a recipe search would be noise for searchers and a privacy surprise for owners, and the ticket asks only that another person can easily see what meals are planned. If discoverability is wanted later, it is a straightforward follow-up modeled on `search_cookbooks` — but it needs its own ticket and its own privacy decision.

---

## Owner-facing UI (REW-69)

- **`views/meal-plans/view.ejs`** — a labelled plan-level visibility control (`.meal-plan-visibility-control`) in the existing header action row: a Private/Public state badge plus a "Make Public"/"Make Private" submit, posting `_csrf` and a `visibility` hidden field. It is deliberately structured as a labelled control with its own `.meal-plan-visibility-*` classes rather than reusing the per-recipe `badge-draft`/`badge-published` pills on the cards below, so "this plan is Public" cannot be misread as "this recipe is Public."
- When the plan is Public, a `.meal-plan-share-panel` shows the full URL `<APP_URL>/m/<id>` in a readonly input with a **Copy link** button and an `aria-live` feedback span (`data-meal-plan-share*` hooks).
- **Share URL origin comes from `getAppUrl()`** (`src/utils/authUtils.js`, the REW-57 helper), passed in by the route as the `appUrl` local — never from `req.headers.host` or `X-Forwarded-Host`. This string exists to be copied and re-shared by a human, so a header-derived origin would be a ready-made phishing vector. Both new locals are `typeof`-guarded (`mealPlan.is_public && typeof appUrl !== 'undefined' && appUrl`) so `src/views/recipeCard.test.js` and `src/views/groceryList.test.js`, which render this template directly with fixed fixtures, keep passing.
- **`public/js/meal-plan-share.js`** — the Copy-link handler only, loaded with a page-local `<script src>` tag at the bottom of the view (not added to `views/layouts/main.ejs`). Uses `navigator.clipboard.writeText` with a visible confirmation and a select-the-text fallback when the Clipboard API is missing, blocked, or the page is not a secure context. CSP is `script-src 'self'`; there are no inline handlers, no inline script bodies, and no CSP changes. It is a deliberate ~45-line near-copy of `public/js/cookbook-share.js` rather than a generalization, to avoid editing a file whose contents three `cookbookSharing.test.js` assertions pin.
- **`views/meal-plans/index.ejs`** — a small Public marker next to the existing recipe-count badge on shared plans, so an owner can see at a glance which plans are out in the world. Guarded on falsy/absent `is_public` so plans created before migration `020` render without `undefined`.
- **`public/css/styles.css`** — `.meal-plan-visibility-*` and `.meal-plan-share-*` classes, grouped with their `.cookbook-*` equivalents so the visual language is identical.

---

## JSON API (`src/routes/mealPlanApiRoutes.js`, mounted at `/api/meal-plans`)

Backs the shared "Add to Meal Plan" modal (`views/partials/meal-plan-modal.ejs`, `public/js/meal-plans.js`), which is included once in the main layout and opened from a `.meal-plan-add-btn` on a recipe card, the owner's recipe view page (`/recipes/:id`), or the public recipe page (`/r/:id`) — for **any authenticated viewer**, not just the recipe's owner (unlike Cookbooks' "Save to Cookbook(s)" widget, which is owner-only).

Every route in this file requires auth via a local `requireApiAuth` helper (duplicated from `likeRoutes.js`'s helper, per this repo's per-route-file convention) that returns a JSON `401` rather than redirecting — **there is no anonymous-GET case here**, unlike `likeRoutes.js`. REW-69 did not change that: this JSON API is entirely owner-scoped, and the public read of a shared plan lives only at `GET /m/:id` in `publicRoutes.js`. Making a plan Public grants no access to any `/api/meal-plans/*` route.

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
- **Privacy is structural, not just UI-level:** a Private meal plan has no RLS policy under which a non-owner can read it, so a direct API/URL guess at another user's `/meal-plans/:id` (or `/api/meal-plans/:id/...`) returns nothing from Supabase regardless of route code. REW-69's additional SELECT policy is scoped strictly to `is_public = true` rows and changes nothing for Private plans.
- **Rate limiting:** 30 mutation requests/minute per user on both the page routes (`mealPlanLimiter`) and the JSON API (`mealPlanApiLimiter`).
- **Input validation:** title required/trimmed/capped at 200 characters (`validateMealPlanTitle()`, unit-tested); date range required, must be real calendar dates, `end >= start` (`validateDateRange()`, unit-tested) — both enforced in `mealPlanUtils.js` and via DB `CHECK` constraints as defense in depth. Route/query UUIDs are validated against a pattern before any query runs.
- **CSRF:** CSRF protection **is enforced** globally via `csrfProtectionExceptMultipart` in `src/app.js`; `POST` is not in `ignoredMethods` and `res.locals.csrfToken` is populated for every render. Every meal plan form, including the REW-69 visibility form, carries a real `_csrf` token and is rejected without one. (An earlier revision of this page stated CSRF was disabled repo-wide — that was correct when REW-63 shipped and is no longer true. Corrected 2026-09-14.)

### Sharing-specific (REW-69)

- **Private-recipe leakage was the highest-risk item in this change.** A meal plan can contain the owner's Private (draft) recipes, because REW-63 deliberately made plan membership independent of publish status. The mitigations, in order of how much weight they carry:
  1. `GET /m/:id` and `getPublicMealPlanRecipes()` use the anon-key client exclusively — the appearance of `createSupabaseClient(...)`, `req.accessToken`, or `req.cookies["sb-access-token"]` anywhere in either is a blocking review finding, and `src/routes/publicRoutes.test.js` asserts against it at the source level.
  2. The `meal_plan_recipes` public SELECT policy requires **both** a Public parent plan and a `published` recipe, so a direct anon-key PostgREST read cannot enumerate the count, UUIDs, add-times, or `planned_servings` of a Public plan's Private membership edges. This is the REW-92 lesson already applied to `cookbook_recipes` in migration `019`.
  3. An explicit `.eq("recipes.status", "published")` predicate in the query, as defence in depth.
  - Deliberate consequence: a Public plan whose recipes are all Private renders as an empty plan to visitors. That is correct, and it has its own neutral empty state.
- **Other users' recipes on a shared plan.** `meal_plan_recipes` rows can point at *other users'* published recipes (REW-63's divergence from cookbooks). Those are already world-readable at `/r/:id`, so surfacing them exposes nothing new — but it means a shared plan is not "the owner's recipes," which is why per-card `recipe.author` attribution matters here.
- **Existence disclosure:** Private, nonexistent, and malformed plan IDs return byte-identical 404s at `/m/:id` — no distinct flash, no redirect to login, no extra query on the private branch.
- **Fail-closed input:** `normalizeMealPlanVisibility()` returns `true` only for the exact string `"public"`. Everything else is Private.
- **Rate limiting:** the visibility endpoint reuses the existing 30/minute-per-user `mealPlanLimiter` shared by every other meal plan mutation. No route-level bypass was added.
- **No cached visibility:** `/m/:id` reads `is_public` from Postgres on every request. Nothing memoizes it, stores it in the session, or precomputes it into a view, which is what makes revocation immediate.
- **No new redirect surface:** the share link is a fixed internal `/m/:id` path built from a database-stored UUID. Nothing user-supplied shapes it.
- **Owner-only surfaces stay owner-only:** `/meal-plans/:id`, `/edit`, `/add-recipes`, `/grocery-list`, and every `/api/meal-plans/*` route keep `requireAuth` and their owner scoping. Public grants read access to `/m/:id` only.

#### Accepted residual exposure (documented, not a defect)

For a **Public** plan, a direct anon PostgREST read of `meal_plans` can see that row's `user_id`, `created_at`, and `updated_at` alongside the title and dates the page already shows — so a determined reader can correlate several of one owner's *Public* plans to the same owner UUID. This was raised by the Reviewer and accepted by design: it is identical to the pre-existing posture for published `recipes` and Public `cookbooks`, whose `user_id` is likewise anon-readable, and **no Private plan is exposed by it**. The route handler itself never selects `user_id`. Tightening this would mean column-level grants, which would be a new app-wide convention and belongs in its own ticket.

---

## Known issues (non-blocking, reviewer-flagged)

The Reviewer approved this change with **no blocking issues**, but flagged two non-blocking "should fix"/nit items during code review, tracked here as known follow-ups:

1. **Implicit vs. explicit recipe-visibility check in `mealPlanApiRoutes.js`.** `POST /api/meal-plans/:id/recipes/:recipeId` determines whether a recipe is addable by querying `recipes` with the caller's RLS-scoped client and checking for a returned row, relying on `recipes`' own RLS SELECT policy (own-or-published) rather than an explicit `.or("user_id.eq.<id>,status.eq.published")` filter in the query itself (the pattern `mealPlanRoutes.js`'s bulk-add route uses for ownership). Functionally correct and backed by the `meal_plan_recipes` RLS INSERT policy regardless, but less self-documenting. Suggested fix: make the filter explicit in a follow-up PR.
2. **Unchecked `fetch` response in the create-then-add flow (`public/js/meal-plans.js`, `handleCreateMealPlan`).** After a new meal plan is created via `POST /api/meal-plans`, the code immediately calls `POST /api/meal-plans/:id/recipes/:recipeId` to add the current recipe to it, but does not check that second response's `ok`/status before proceeding to `resetNewMealPlanForm()`/`loadMealPlans()`. If the add call fails (e.g. rate limit, network blip), the user sees the new plan appear without an error, and the plan may not actually contain the recipe — silently misleading, though not destructive (the plan still exists and can be retried from the list). Suggested fix: check the response and surface `showMealPlanErrorToast()` on failure, consistent with every other mutation in this file.

Neither item blocks this release; both are recommended for a small, low-risk follow-up PR.

---

## Testing notes

- `src/utils/mealPlanUtils.test.js` unit-tests `validateMealPlanTitle()` and `validateDateRange()` (blank/whitespace title rejection, max-length boundary, missing dates, unparseable/invalid calendar dates such as `2024-02-30`, end-before-start rejection). Part of `npm test` (**135/135 passing** as of this change). Recipe-ID selection normalization for the bulk picker is covered by the existing `cookbookUtils.test.js` suite, since `mealPlanRoutes.js` reuses `normalizeRecipeIdSelection()` directly rather than duplicating it.
- `src/utils/groceryList.test.js` (REW-26) unit-tests the aisle taxonomy and aggregation: categorisation per aisle and the "Other" fallback, longest-keyword-wins matching, cross-recipe merging, volume/weight/count combining, refusal to combine incompatible or range amounts, "to taste" and unparseable passthrough, section-heading exclusion, empty/null/whitespace ingredient text, fixed category order, alphabetical item order, determinism, and recipe provenance. `src/views/groceryList.test.js` renders the new view with `ejs.renderFile` (same pattern as `recipeCard.test.js`) and asserts store-ordered headings, escaping of `<script>` payloads in ingredient/recipe/plan names, the empty state, the skipped-recipe notice, the print button's `data-grocery-print` hook with no inline handler, and the plain-GET Grocery List link on the plan detail page.
- No request-level/integration tests exist for `mealPlanRoutes.js`/`mealPlanApiRoutes.js`, consistent with every other Supabase-backed route file in this codebase (no live-Supabase test harness exists anywhere).
- **QA was intentionally skipped for this pipeline run** (explicit orchestrator instruction, not a QA rejection or omission). The acceptance-criteria checklist in `docs/plans/REW-63-create-and-manage-meal-plans.md` (19 items, including the "another user's session cannot view a meal plan via direct URL/ID" RLS check and the "cannot add another user's draft recipe" RLS check) has not been manually/QA-verified against a running app.

### REW-69

Automated coverage added with the change:

- `src/utils/mealPlanUtils.test.js` (extended) — `normalizeMealPlanVisibility()` fail-closed cases (`"public"` → true; `"private"`, `undefined`, `null`, `""`, `"PUBLIC"`, `"Public"`, `"true"`, `"published"`, `["public"]`, `{}`, `42` → false).
- `src/routes/mealPlanVisibilityRoutes.test.js` (new) — drives the exported handler with a fake query builder: the stored value flips in both directions against table `meal_plans`; both the `id` and `user_id` filters are applied on every call; malformed IDs never open a query and redirect to `/meal-plans`; an unknown/absent `visibility` fails closed to Private; a not-found row flashes identically to the non-owned case and is not logged as a DB error while a real error is; the success flash uses Private/Public and never matches `/draft|published/i`; and the route is registered for POST at `/:id/visibility` with a three-layer chain including `requireAuth`.
- `src/routes/publicRoutes.test.js` (extended) — `/m/:id` filters on `id` and `is_public = true`, queries only `meal_plans` on the not-found branch, and renders the 404 path; Private, nonexistent, and malformed IDs produce one identical payload; source-level assertions that neither the handler nor `getPublicMealPlanRecipes` contains `createSupabaseClient`/`req.accessToken`/`sb-access-token` and that the fetcher contains `recipes!inner` and `.eq("recipes.status", "published")`; plus migration-content assertions against `020` (column definition present, exactly two `CREATE POLICY` statements, `AND EXISTS` with no `OR EXISTS`, no `MATERIALIZED VIEW`, no `DROP`/`ALTER POLICY` in executable SQL, and nothing touching `recipes`).
- `src/views/mealPlanSharing.test.js` (new) — the shared page renders identically for `null`/owner/other-user `user` locals and contains no mutation link, no `<form`, no `_csrf`, and no `isOwner`/`accessToken`/`csrfToken`; title, date range, and card metadata are HTML-escaped; cards link to `/r/<id>`; the empty state renders and matches nothing like `/hidden|private recipe|draft|not shown/i`; the owner view posts `private|public` with a real CSRF token, shows the share link only while Public, still renders when `appUrl` is omitted, and loads `/js/meal-plan-share.js` as an external file with no inline handler.
- `src/views/organizationCardGrid.test.js` (extended) — `views/meal-plans/public-view.ejs` added to the pinned `organizationViews` list.

**Reviewer verdict: Approved, no blocking issues.** The residual `user_id` exposure on Public plans documented above was the Reviewer's one explicit note, accepted by design.

**QA was deliberately skipped for REW-69 as well, and several acceptance criteria are unverified.** Nothing in this feature has been exercised against a live Supabase with migration `020` applied. Specifically unconfirmed against `docs/plans/meal-plan-sharing.md`: **AC3** (share URL origin unaffected by a spoofed `Host`/`X-Forwarded-Host`, and the Copy button actually working), **AC5** (zero trace of a Private recipe at `/m/:id` for visitor, other user, and owner), **AC6** (all-private empty state), **AC11** (direct PostgREST anon/cross-user reads of a Private plan's rows and a Public plan's Private membership edges), **AC12** (an other-user recipe switched back to Private disappears cleanly), **AC13** (toggling visibility changes no recipe status, membership, or dates), and **AC16** (30/min rate limiting on the visibility endpoint). The remaining criteria are supported by code review and the automated suite but have had no manual browser pass.

### REW-89

Automated coverage added with the change:

- `src/routes/mealPlanRoutes.test.js` (new, 11 cases) — drives the exported `handleMealPlanView` and `getMealPlanRecipes` with a fake injected client, no live Supabase: the select asks for every column the standardized card needs and no body fields; junction embeds flatten to plain `categories`/`tags`, and missing links flatten to `[]` rather than `undefined`; ordering stays newest-added-first; a membership row whose `recipes` embed is null is dropped; a failed recipe read yields an empty plan rather than throwing; `isLiked` comes from exactly one `recipe_likes` query filtered to the caller; an empty plan issues no likes query at all; a likes error still renders the page with every heart unfavorited; the page stays plan-owner scoped and still passes its share-link locals; and a non-UUID `:id` and a plan the caller does not own both redirect with the same "Meal plan not found" flash.
- `src/views/recipeCard.test.js` (updated) — six REW-89 cases replacing the previous thin meal-plan test, including the distinguishing assertion that this surface renders **zero** `+ Meal Plan` triggers while each of the other four still renders exactly one per card.
- `src/views/mealPlanSharing.test.js` (updated) — the "plan-level control reads as distinct from the per-recipe badges" assertion moved from a template-source check to a rendered-output check, because the per-recipe pill literal now lives in the shared partial. Mirrors what REW-88 did to `cookbookSharing.test.js`; strengthened, not loosened.

Suite result at hand-off: **526 tests, 524 passing, 2 failing** — both pre-existing, environmental `listen EACCES` unix-socket failures in `src/csrf.integration.test.js` on Windows (REW-98). No new failures.

**Reviewer verdict: approved on round 1, no blocking issues.** Three non-blocking follow-ups were recorded rather than implemented: extracting the now-triplicated card query/flatten/likes code into `src/utils/recipeCardQuery.js`; two now-vacuous loop entries in `src/views/recipeVisibility.test.js`; and the `/m/:id` vs `/meal-plans/:id` `+ Meal Plan` inconsistency, which needs a Product decision.

**The QA stage was deliberately excluded from this pipeline run** (Planner → Developer → Reviewer → Documentation). The reviewer ran the full suite, but no dedicated QA pass against the acceptance criteria and no browser or live-Supabase verification were performed. Unverified: a plan containing your own Public recipe, your own Private recipe and another user's Public recipe; mobile/desktop wrapping of the five-control action row; heart persistence across reload; `+ Cookbook` adding; Remove leaving the recipe intact; Delete confirming first. Do not describe REW-89 as QA-verified.

---

## Related documentation

- [API Overview](README.md)
- [Meal Plan Recipe Card](meal-plan-card.md) — the standardized card on `/meal-plans/:id`, the shared partial's full five-surface local-variable contract (including the new `mealPlanId` local), and the widened `GET /meal-plans/:id` read with its batched favorite state (REW-89)
- [Cookbooks API](cookbooks.md) — the structural precedent this feature extends/diverges from, including REW-19 cookbook sharing
- Plans: `docs/plans/REW-63-create-and-manage-meal-plans.md`, `docs/plans/meal-plan-sharing.md` (REW-69), `docs/plans/rew-89-standardize-meal-plan-recipe-card.md`
- `database/README.md` — `meal_plans` / `meal_plan_recipes` tables, RLS policies, indexes, migration `020`
- Release notes: `docs/RELEASE_NOTES_REW-63.md`, `docs/RELEASE_NOTES_REW-69.md`, `docs/RELEASE_NOTES_REW-89.md`
- Out of scope, possible follow-ups: search discoverability of Public meal plans; a grocery list on the shared page; copying a shared plan into your own account (the meal-plan analogue of [REW-91](https://wanderingnerds.atlassian.net/browse/REW-91))

---

## Changelog

| Date | Change |
|------|--------|
| 2026-09-15 | REW-89 standardized meal plan recipe cards: `GET /meal-plans/:id` widened to feed the shared card partial (extracted `handleMealPlanView`, exported `getMealPlanRecipes`, `MEAL_PLAN_CARD_COLUMNS`, batched `isLiked`), and the Remove form moved into the partial. No migration, no route added or renamed, no JSON shape change. Reviewer-approved; **QA stage excluded from the run**. |
| 2026-09-14 | REW-69 meal plan sharing: added `POST /meal-plans/:id/visibility`, the public `GET /m/:id` surface, owner-facing share UI, and sharing-specific security notes including the accepted `user_id` exposure on Public plans. Deliberately no search discoverability. Corrected the stale "CSRF is disabled repo-wide" claim in Security — CSRF is enforced. Reviewer-approved; QA not run. |
| 2026-09-14 | Added `GET /meal-plans/:id/grocery-list` (REW-26) — read-only printable grocery list. No schema change; `planned_servings` still unused. |
| 2026-09-08 | Page created documenting REW-63 (new feature — no prior version to reconcile). |
