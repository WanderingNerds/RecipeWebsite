# My Recipes Recipe Card (REW-86)

**Feature:** REW-86 — Standardize My Recipes Recipe Card Content & Actions
**Component:** `views/partials/recipe-summary-card.ejs`, `views/recipes/index.ejs`, `views/partials/cookbook-modal.ejs`, `views/layouts/main.ejs`, `public/js/cookbooks.js`, `public/css/styles.css`, `src/routes/recipeRoutes.js`, `src/routes/cookbookApiRoutes.js`, `src/routes/index.js`, `src/middleware/authMiddleware.js`
**Last Updated:** 2026-09-15
**Status:** implemented and reviewer-approved on branch `REW-86-standardize-my-recipes-card`. **QA was not run for this change** and the branch is not merged.

---

## Overview

`views/partials/recipe-summary-card.ejs` is the single card template for both My Recipes
(`isPublic: false`) and Browse (`isPublic: true`). REW-86 defines what an **owner** card on
My Recipes contains and completes the missing pieces: a card-level Private/Public control, a
`+ Cookbook` action, an inert Share placeholder, and `Label: value` metadata.

The public/Browse branch of the partial gains **none** of the owner controls. Everything added
here sits behind `isPublic === false`, including for a signed-in owner looking at their own
recipe on `/browse`.

### Card contents (owner surface, `/recipes`)

| Element | Notes |
|---------|-------|
| Thumbnail | Links to `/recipes/:id` when present |
| Title | Clickable link to `/recipes/:id`, escaped |
| Favorite heart | `.like-btn` (REW-21/REW-55). Disabled with an explanatory title when `status !== 'published'`, because `POST /api/likes/:recipeId` only accepts published recipes |
| Visibility control | Owner-only form posting to `POST /recipes/:id/visibility` — see below |
| Author | `By {author}`; `Adapted from {original_author}` on clones (REW-84) |
| Categories / tags | Clickable filter links on the owner surface, plain badges on Browse |
| Metadata | `Prep Time:`, `Cook Time:`, `Servings:`, `Difficulty:` — each omitted entirely when the field is empty |
| `+ Meal Plan` | Existing shared modal (REW-63) |
| `+ Cookbook` | New shared modal backed by `/api/cookbooks` — see below |
| Share | **Inert placeholder.** `<button type="button" disabled aria-disabled="true">` with a "Sharing is coming soon" title. No `href`, no handler, no endpoint. Real sharing behavior belongs to [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18) |
| Edit | Link to `/recipes/:id/edit` |
| Delete | Existing confirm-guarded form post to `/recipes/:id/delete` |

`views/recipes/index.ejs` now passes the active `selectedCategory` / `selectedTags` into the
partial so the visibility form can round-trip the current filter (see "No open redirect" below).

---

## `POST /recipes/:id/visibility` (new)

Flips a single recipe between Private (`draft`) and Public (`published`) directly from its card.
Owner-only. The full edit form still owns form-level visibility — `handleRecipeUpdate` is
untouched by this change.

**Middleware order:** `requireAuth` → `csrfProtection` → `visibilityLimiter` → handler.

- `csrfProtection` is re-applied at the route level rather than relying on the global
  `csrfProtectionExceptMultipart` in `src/app.js`. That wrapper skips token validation for *any*
  `multipart/form-data` body, so a forged cross-site multipart POST would otherwise reach the
  handler unchecked. Same precedent as `POST /recipes/:id/clone`. The card posts urlencoded with
  a hidden `_csrf` field, so this is transparent to legitimate submissions.
- CSRF runs **before** the rate limiter so a forged cross-site request is rejected without
  consuming any of the victim's limiter quota.
- `visibilityLimiter`: **60 requests / 15 minutes per IP** (`src/routes/recipeRoutes.js`), shaped
  like the existing `addRecipeLimiter`. It exists because the global limiter in `app.js` is
  production-only.

**Request:** `application/x-www-form-urlencoded`

| Field | Values | Notes |
|-------|--------|-------|
| `_csrf` | token | Required |
| `visibility` | `private` \| `public` | REW-85 form convention. **Fails closed:** only the exact lowercase string `public` publishes |
| `category` | slug | Optional. Round-tripped to restore the active filter |
| `tags` | slug list | Optional. Round-tripped to restore the active filter |

**Behavior**

1. `:id` is screened against the file's UUID pattern before any query runs; a malformed ID is
   treated as not-found and never reaches Supabase.
2. `visibility` is normalized by `normalizeRecipeVisibility()` (`src/utils/recipeVisibility.js`).
   Missing, array-shaped (duplicated inputs), wrong-case, or otherwise unexpected values resolve
   to `draft`. A tampered submission can only ever land on Private.
3. The update is filtered on **both** `.eq("id", id)` and `.eq("user_id", req.user.id)` in
   application code, on top of the RLS UPDATE policy, then read back with
   `.select().maybeSingle()`.
4. A genuine database error and a not-found/not-owned result are logged as different events but
   produce an **identical** user-facing flash, so recipe ownership and existence are not
   probeable.

**Response:** redirect to the rebuilt list path with a flash. Success wording is Private/Public,
never draft/published: *"This recipe is now Public. Anyone can find it on Browse."* /
*"This recipe is now Private. Only you can see it."*

**Form POST + redirect, not AJAX.** This is deliberate: flipping a recipe to Private must also
disable the favorite heart on the same card, and a full re-render gets that consistency for free.
An AJAX toggle would have to re-derive heart and badge state client-side.

**No open redirect.** `buildRecipesListPath(body)` (exported from `recipeRoutes.js`) builds the
destination from a hard-coded `/recipes` literal plus, at most, the two whitelisted fields
`category` and `tags`, percent-encoded through `URLSearchParams`. Non-string values and values
over 300 characters are dropped rather than coerced. A caller-supplied return URL is never
accepted or echoed into a `Location` header.

**Side effects it deliberately does not have:** it never touches cookbook or meal-plan membership,
never deletes `recipe_likes` rows, and never modifies any other recipe. Reverting a favorited
recipe to Private leaves the existing like row in place (the pre-existing behavior documented in
`database/README.md`); the card simply re-renders with a disabled heart.

---

## Cookbook JSON API — `/api/cookbooks` (new file)

`src/routes/cookbookApiRoutes.js`, mounted at `/api/cookbooks` in `src/routes/index.js`. This is
the JSON surface behind the `+ Cookbook` modal; it does not replace the form-based
`/cookbooks/:id/recipes/:recipeId` routes used by the recipe detail page, which are unchanged.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cookbooks?recipeId=<uuid>` | List the caller's cookbooks (`id`, `title`), each flagged with `containsRecipe` for the given recipe |
| POST | `/api/cookbooks` | Quick-create a cookbook from the modal's inline mini-form (`{ title }`) |
| POST | `/api/cookbooks/:id/recipes/:recipeId` | Add an owned recipe to an owned cookbook |
| DELETE | `/api/cookbooks/:id/recipes/:recipeId` | Remove the membership row (never the recipe) |

**Middleware:** every route runs behind `requireApiAuth` and answers `401` JSON rather than
redirecting. Mutations additionally run `csrfProtection` → `cookbookApiLimiter`, in that order,
for the same reasons given for the visibility route. `GET /` carries no CSRF check **by design** —
it is non-mutating, and CSRF tokens protect state changes, not reads.

**Rate limit:** `cookbookApiLimiter` — **30 mutations / minute, keyed on `req.user.id`**, mirroring
`mealPlanApiLimiter`. Per-user keying is safe here because every route is behind auth.

**Authorization** reproduces the existing form route exactly: the cookbook must belong to the
caller (`getOwnedCookbook`, filtered by `id` + `user_id`), and so must the recipe (an explicit
`recipes` lookup filtered by `id` + `user_id`) — belt-and-suspenders alongside the
`cookbook_recipes` INSERT policy from migration `010`, which already requires ownership of both
sides. A nonexistent cookbook and someone else's cookbook return the same `404`. A failed recipe
lookup is reported exactly like a non-owned recipe.

**Owner-only, deliberately.** Adding *other* users' Public recipes to a cookbook is REW-59's
policy-widening call, not this endpoint's. Every card on My Recipes is owned by the viewer, so the
narrow rule is sufficient and requires no migration.

**Idempotent add:** `upsert(..., { onConflict: "cookbook_id,recipe_id", ignoreDuplicates: true })`,
so clicking Add twice (or a race between tabs) is a no-op rather than a composite-primary-key
error.

**Responses**

| Case | Status | Body |
|------|--------|------|
| List | 200 | `{ "cookbooks": [{ "id", "title", "containsRecipe" }] }` |
| Create | 201 | `{ "cookbook": { "id", "title", "containsRecipe": false } }` |
| Add / remove | 200 | `{ "added": true\|false, "cookbookId", "recipeId", "cookbookTitle" }` |
| Malformed UUID or invalid title | 400 | `{ "error": … }` — returned before any query |
| Not owned / not found | 404 | `{ "error": "Cookbook not found" }` or `{ "error": "Recipe not found" }` |
| No session / rejected token | 401 | `{ "error": "Authentication required" }` / `{ "error": "Invalid or expired session" }` |
| Rate limited | 429 | `{ "error": "Too many cookbook actions. Please slow down." }` |

The membership lookup on `GET /` is a single batched query (`.in("cookbook_id", …)`), not one
query per cookbook, matching the N+1 avoidance used elsewhere in the codebase. A membership-query
failure is logged and degrades to "no memberships" rather than failing the whole list.

### Client

- `views/partials/cookbook-modal.ejs` — static modal markup, included once in
  `views/layouts/main.ejs` gated on `user`, exactly like the meal-plan modal.
- `public/js/cookbooks.js` — click delegation for every `.cookbook-add-btn` on the page, list
  render, add/remove toggle, and "Create & Add Recipe" quick-create. It must remain an external
  file: helmet's CSP is `script-src 'self'`, so there are no inline handlers. State-changing
  fetches inherit the `x-csrf-token` header from the `window.fetch` wrapper in `public/js/main.js`
  — nothing here bypasses it. Cookbook titles are rendered with `textContent`, never `innerHTML`.
- A signed-out visitor's `+ Cookbook` button carries `.cookbook-add-btn-guest` and prompts for
  login instead of opening the modal; a `401` from the list endpoint closes the modal and does the
  same.

---

## Shared `requireApiAuth` (`src/middleware/authMiddleware.js`)

`likeRoutes.js`, `mealPlanApiRoutes.js`, and `cookbookApiRoutes.js` each carried a verbatim copy of
the same JSON-returning auth middleware. REW-86 extracts it into
`createRequireApiAuth({ logLabel, authClient })` and has all three consume it.

This is a refactor with **no behavior change**: the `401` bodies are unchanged
(`{ "error": "Authentication required" }` with no token,
`{ "error": "Invalid or expired session" }` for a rejected one) because client code branches on
them, the returned middleware is still named `requireApiAuth`, and each mount point keeps its own
log label so production logs stay distinguishable. The auth client is injectable for the same
reason `createRequireAdmin`'s is — so the token paths can be unit tested without a live Supabase.

---

## Database

**No migration.** Every read and write on this card touches the signed-in user's own rows and is
already permitted by existing RLS:

- The visibility toggle updates an owned `recipes` row — migration `001`'s owner UPDATE policy,
  plus the route's own `user_id` filter.
- `+ Cookbook` inserts an owned recipe into an owned cookbook — the narrowest case migration
  `010`'s INSERT policy already allows.
- Favorite, meal-plan add, Edit, and Delete reuse existing policies unchanged.

---

## Testing notes

Added with this change:

- `src/routes/recipeVisibilityToggle.test.js` (new, 11 cases) — fail-closed normalization for
  missing / `["public"]` / `"PUBLIC"` / nonsense values; both the `id` and `user_id` filters
  applied on every call; a non-UUID id short-circuits before any client call; a missing or
  non-owned row flashes an error, mutates nothing, and is logged differently from a database
  failure while reading identically to the user; Private/Public flash wording; filter round-trip;
  `buildRecipesListPath` rejects non-string and oversize values; and the route is asserted to be
  mounted behind `requireAuth`, `csrfProtection`, and a rate limiter.
- `src/routes/cookbookApiRoutes.test.js` (new, 15 cases) — middleware composition per route
  (including that `GET /` is intentionally not CSRF-checked), JSON `401`s, malformed-ID
  short-circuits, owner scoping on list/add/remove, identical 404s for not-found vs. not-owned,
  duplicate-safe add, a genuine write failure surfacing as `500` rather than a false success, and
  quick-create stamping the caller's id.
- `src/middleware/authMiddleware.test.js` (new) — `requireApiAuth` answers with JSON rather than a
  redirect, attaches the verified user and the caller's own token, logs unexpected failures under
  the caller's label, and keeps the function name route files assert on.
- `src/views/recipeCard.test.js` (updated) — owner vs. Browse rendering of the new controls.

Suite result at hand-off: **485 tests, 483 passing.** The 2 failures are pre-existing
environmental `EACCES /tmp/*.sock` unix-socket errors in `src/csrf.integration.test.js` on
Windows, unrelated to this change and tracked as
[REW-98](https://wanderingnerds.atlassian.net/browse/REW-98).

**QA was not run for REW-86.** Reviewer approved after three rounds, but no browser pass and no
live-Supabase verification were performed, so the plan's acceptance criteria — the end-to-end
Make Public / Make Private round trip, `/browse` and `/r/:id` visibility after a flip, the
`+ Cookbook` double-click no-op against real data, keyboard/focus behavior, and 375px wrapping —
remain unverified.

---

## Known gaps and follow-ups

- [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18) — real Share behavior. The button
  shipped here is intentionally inert and exposes no URL.
- [REW-99](https://wanderingnerds.atlassian.net/browse/REW-99) — `csrfProtectionExceptMultipart`
  exempts **every** multipart POST repo-wide, not just the Multer routes that need it. Both new
  surfaces work around it by re-applying `csrfProtection` at the route level; the central fix was
  deliberately deferred rather than attempted inside this ticket.
- [REW-98](https://wanderingnerds.atlassian.net/browse/REW-98) — the two Windows unix-socket test
  failures.
- [REW-59](https://wanderingnerds.atlassian.net/browse/REW-59) — still In Progress on its own
  branch with its own edits to `views/partials/recipe-summary-card.ejs` and its own cookbook JSON
  API and modal. **A merge conflict on the card partial is expected, and a duplicate cookbook API
  or modal is probable.** Whoever merges second must reconcile them rather than keeping both.
- [REW-82](https://wanderingnerds.atlassian.net/browse/REW-82) — cross-surface card sizing. REW-86
  deliberately did not chase pixel parity; the new controls wrap using existing
  `.recipe-summary-actions` rules.

---

## Related documentation

- [API Overview](README.md)
- [Recipe Visibility](recipe-visibility.md) — the Private/Public mapping and fail-closed rule this
  endpoint reuses
- [Cookbooks API](cookbooks.md) — the form-based `/cookbooks*` routes and RLS model
- [Recipe Likes API](recipe-likes.md) — the favorite heart and its published-only restriction
- [Browse Recipes](browse-recipes.md) — the public branch of the same shared partial
- Plan: `docs/plans/rew-86-standardize-my-recipes-card.md`
- Release notes: `docs/RELEASE_NOTES_REW-86.md`
