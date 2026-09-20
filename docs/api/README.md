# API Documentation

This directory contains documentation for the RecipeWebsite API endpoints.

## Authentication

All API endpoints require authentication unless otherwise noted. Authentication is handled via Supabase Auth with session cookies.

**Unauthenticated requests receive:**
```json
{
  "error": "Authentication required"
}
```

---

## Endpoints Overview

### Recipes

`GET /browse?page=1` is a public HTML listing requiring no authentication. Its cards share the My Recipes metadata layout (REW-59); see [Browse Recipes](browse-recipes.md) for pagination, rendering and migration requirements.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/recipes` | List user's recipes (with optional category/tag filtering); each recipe includes a server-rendered favorite/like state, batch-fetched from `recipe_likes` (REW-55) |
| GET | `/recipes/new` | Get form data for creating a recipe (Author field pre-filled with account display name, REW-46; Prep Time and Total Time/`cookTime` are required, REW-52) |
| POST | `/recipes` | Create a new recipe (Author defaults server-side to account display name if blank/missing, REW-46; rejects blank `prepTime`/`cookTime`, REW-52; optional `photo` upload, max **4MB**, max **10 uploads per 15 minutes per IP** — REW-94) |
| GET | `/recipes/:id` | View a single recipe |
| GET | `/recipes/:id/edit` | Get form data for editing a recipe (Prep Time and Total Time/`cookTime` are required, REW-52) |
| POST | `/recipes/:id/update` | Update a recipe (rejects blank `prepTime`/`cookTime`, REW-52; optional `photo` upload under the same 4MB cap — REW-94) |
| POST | `/recipes/:id/visibility` | Flip one recipe between Private and Public from its My Recipes card (`visibility=private\|public`, fails closed to Private) — REW-86 |
| POST | `/recipes/:id/delete` | Delete a recipe (urlencoded form post behind `requireAuth` and route-level `csrfProtection`, in that order; no per-route limiter — REW-101) |
| POST | `/recipes/:id/clone` | Add another user's Public recipe as a new Private, independently owned recipe (REW-84) |
| GET | `/recipes/:id/scale` | Get scaled ingredient data (JSON) |

`POST /recipes/:id/visibility` is a urlencoded form post behind `requireAuth`, route-level `csrfProtection`, and a 60-per-15-minutes-per-IP limiter, in that order. It answers with a flash and a redirect to a server-rebuilt `/recipes` path — never a caller-supplied URL. See [My Recipes Recipe Card](my-recipes-card.md). **Branch-only: implemented and reviewed on `REW-86-standardize-my-recipes-card`, QA not run, not yet merged.**

`POST /recipes/:id/delete` is a urlencoded form post behind `requireAuth` and route-level `csrfProtection`, in that order, with no per-route limiter (REW-101). The handler reads no body fields — only `req.params.id` and the caller's identity — which is exactly why it needed its own CSRF check: the global wrapper skips `multipart/form-data` bodies, so a forged cross-site multipart POST used to reach the handler and run the delete. It is the target of five delete forms (the recipe detail page, My Recipes, My Favorites, the Cookbook card and the Meal Plan card), all of which already carry the hidden `_csrf`. A request without a valid token — missing, tampered, issued for another session, or carried inside a multipart body, which nothing on this route parses — now gets the 403 error page before the handler runs. Success and failure redirects are unchanged. See the [Route-level CSRF audit](#route-level-csrf-audit-rew-101--rew-105--rew-102) below. **Merged to `main` in PR #62 (commit `f8673b1`).** QA was skipped on that run, so the five-surface manual delete pass (recipe detail page, My Recipes, My Favorites, a Cookbook page, a Meal Plan page) is still outstanding.

`POST /recipes` and `POST /recipes/:id/update` are multipart form posts (`photo` field, optional, single file) behind `requireAuth`, the upload rate limiter, Multer, `handleRecipeImageUploadError`, and `csrfProtection`, in that order. Unlike the import endpoint they answer with a flash message and a redirect rather than JSON, because they are ordinary HTML form posts. See [Recipe Photo Upload](recipe-photo-upload.md) for the limits, the error contract, the redirect targets, and the client-side pre-check. **Branch-only: implemented and reviewed on `REW-94-recipe-image-upload-limit-vercel-cap`, not QA-verified, not yet merged.**

### Recipe Import (REW-12)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/recipes/import` | Render import page with upload form (Author field pre-filled with account display name, REW-46) |
| POST | `/recipes/import/parse` | Parse uploaded file, return JSON preview (single file, max **4MB**, max **25 parses per 15 minutes per IP** — REW-43) |
| POST | `/recipes/import/check-title` | Check whether the current user already has a recipe with a given title |
| POST | `/recipes/import/save` | Save imported recipe after user confirmation (requires non-blank `cookTime`; accepts fail-closed Private/Public visibility and server-defaulted `author`) |

`POST /recipes/import/parse` is a multipart upload (`file` field) behind `requireAuth`, the import rate limiter, Multer, and `csrfProtection`, in that order. Every rejection it can produce returns JSON, so the browser client never has to parse an HTML error page. See [Recipe Import Limits & Error Contract](recipe-import-limits.md) for the full status/body table and the reasoning behind the 4MB ceiling.

Image uploads on that endpoint are additionally capped at **40,000,000 decoded pixels** and downscaled to fit 2000x2000 before OCR (REW-95). The 4MB Multer limit bounds encoded bytes; this bounds the decompressed bitmap. An image over the cap returns the same `400` + `{ "error": "Could not process image. Please try a different image." }` as any other image failure — the response surface is unchanged, and no sharp internals are leaked. **Branch-only: implemented and reviewed on `REW-95-ocr-decoded-pixel-cap`, not QA-verified, not yet merged.** See [OCR/PDF Text Parsing](recipe-import-ocr-parsing.md#image-normalization-before-ocr-rew-95).

### Recipe Likes / Favorites (REW-21, REW-55)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/likes/:recipeId` | Get like status (if authenticated) and public like count for a recipe |
| POST | `/api/likes/:recipeId` | Like a recipe (requires auth; recipe must be `status = 'published'`, otherwise `404`; runs `requireApiAuth` → route-level `csrfProtection` → `likeLimiter`, in that order — REW-102) |
| DELETE | `/api/likes/:recipeId` | Unlike a recipe (requires auth) |
| GET | `/recipes/liked` | Display the current user's liked (published) recipes |

Favorite/like controls (`.like-btn`) call these endpoints from the recipe detail page (REW-21) and, as of REW-55, from each card on the My Recipes page (`/recipes`) as well. See [Recipe Likes API](recipe-likes.md) for full details, including why draft recipe cards render a disabled heart.

### Cookbooks (REW-62)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cookbooks` | List the current user's cookbooks with a per-cookbook recipe count |
| GET | `/cookbooks/new` | Render the create-cookbook form |
| POST | `/cookbooks` | Create a cookbook (title required, trimmed, max 200 chars) |
| GET | `/cookbooks/:id` | View a cookbook and all recipes currently in it, rendered with the standardized recipe card (REW-88) |
| GET | `/cookbooks/:id/edit` | Render the rename form |
| POST | `/cookbooks/:id/update` | Rename a cookbook |
| POST | `/cookbooks/:id/delete` | Delete a cookbook (never deletes the recipes in it; urlencoded form post behind `requireAuth`, route-level `csrfProtection`, then `cookbookLimiter`, in that order — REW-105) |
| GET | `/cookbooks/:id/add-recipes` | Render a checklist of the owner's recipes (draft + published) to add to a cookbook |
| POST | `/cookbooks/:id/add-recipes` | Bulk-add selected recipes to a cookbook |
| POST | `/cookbooks/:id/recipes/:recipeId` | Add a single recipe to a cookbook (used by the recipe view's "Save to Cookbook(s)" widget; urlencoded form post behind `requireAuth`, route-level `csrfProtection`, then `cookbookLimiter`, in that order — REW-102) |
| POST | `/cookbooks/:id/recipes/:recipeId/remove` | Remove a recipe from a cookbook (never deletes the recipe itself) |
| POST | `/cookbooks/:id/visibility` | Switch a cookbook between Private and Public (`visibility=private\|public`, fails closed to Private) — REW-19 |

All `/cookbooks*` routes require auth and act only on the caller's own cookbooks. Mutation endpoints share a 30-requests/minute-per-user rate limit. See [Cookbooks API](cookbooks.md) for full details, including the recipe-view integration and RLS enforcement.

`GET /cookbooks/:id` was widened in REW-88 to feed the shared standardized recipe card: the same URL, middleware, auth, and redirects, but more recipe columns (`user_id`, `original_author`, embedded categories/tags flattened into `categories`/`tags`) and a batched `isLiked` flag per recipe. No route was added or renamed and no JSON response shape changed. See [Cookbook Recipe Card](cookbook-card.md). **Branch-only: implemented and reviewed on `REW-88-standardize-cookbook-recipe-card`; QA was skipped, and the branch is unmerged.**

### Cookbooks JSON API (REW-86)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cookbooks?recipeId=` | JSON: list the caller's cookbooks, each flagged with `containsRecipe` for the given recipe |
| POST | `/api/cookbooks` | JSON: quick-create a cookbook (backs the "+ Cookbook" modal's inline mini-form) |
| POST | `/api/cookbooks/:id/recipes/:recipeId` | JSON: add the recipe to a cookbook — **owner-only on both sides**, duplicate-safe |
| DELETE | `/api/cookbooks/:id/recipes/:recipeId` | JSON: remove the membership row (never the recipe) |

`src/routes/cookbookApiRoutes.js`, mounted at `/api/cookbooks`. Every route requires auth and returns JSON `401` if unauthenticated, consistent with `/api/likes*` and `/api/meal-plans*`. Mutations run `requireApiAuth` → `csrfProtection` → a 30-per-minute-per-user limiter; `GET /` carries no CSRF check by design, since it changes nothing. Unlike `/api/meal-plans*`, this surface is **owner-only** — a user cannot add another user's Public recipe to their cookbook, matching the existing `cookbook_recipes` RLS policy. See [My Recipes Recipe Card](my-recipes-card.md). **Branch-only: implemented and reviewed on `REW-86-standardize-my-recipes-card`, QA not run, not yet merged.**

### Public cookbook sharing (REW-19)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/c/:id` | Public, unauthenticated read-only view of a **Public** cookbook and its published recipes. Private, nonexistent, and malformed IDs all return an identical 404 |
| GET | `/search?q=…` | Recipe search, extended with a capped secondary "Cookbooks" section (up to 5 Public cookbooks, page 1 only) |

Both run exclusively on the anon-key Supabase client, so a draft recipe inside a shared cookbook is invisible at the database layer rather than filtered in application code. A cookbook's UUID is its share identifier — there is no share token. See [Cookbooks API](cookbooks.md) for the full contract.

### Meal Plans (REW-63, REW-69)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/meal-plans` | List the current user's meal plans with a per-plan recipe count, marking Public plans |
| GET | `/meal-plans/new` | Render the create-meal-plan form (title + start/end date) |
| POST | `/meal-plans` | Create a meal plan (title required; start/end date required, `end >= start`) |
| GET | `/meal-plans/:id` | View a meal plan and all recipes currently in it, rendered with the standardized recipe card (REW-89) |
| GET | `/meal-plans/:id/edit` | Render the rename/re-date form |
| POST | `/meal-plans/:id/update` | Rename and/or re-date a meal plan |
| POST | `/meal-plans/:id/visibility` | Switch a meal plan between Private and Public (`visibility=private\|public`, fails closed to Private) — REW-69 |
| POST | `/meal-plans/:id/delete` | Delete a meal plan (never deletes the recipes in it; urlencoded form post behind `requireAuth`, route-level `csrfProtection`, then `mealPlanLimiter`, in that order — REW-105) |
| GET | `/meal-plans/:id/add-recipes` | Render a checklist of the owner's own recipes (draft + published) to bulk-add to a plan |
| POST | `/meal-plans/:id/add-recipes` | Bulk-add selected (owner's own) recipes to a meal plan |
| POST | `/meal-plans/:id/recipes/:recipeId/remove` | Remove a recipe from a meal plan (never deletes the recipe itself; urlencoded form post behind `requireAuth`, route-level `csrfProtection`, then `mealPlanLimiter`, in that order — REW-102) |
| GET | `/api/meal-plans?recipeId=` | JSON: list the current user's meal plans, optionally flagging membership for `recipeId` |
| POST | `/api/meal-plans` | JSON: quick-create a meal plan (backs the "Add to Meal Plan" modal) |
| POST | `/api/meal-plans/:id/recipes/:recipeId` | JSON: add a recipe to a meal plan — allows the caller's own recipe (any status) or **any published recipe**, not owner-only (runs `requireApiAuth` → route-level `csrfProtection` → `mealPlanApiLimiter`, in that order — REW-102) |
| DELETE | `/api/meal-plans/:id/recipes/:recipeId` | JSON: remove a recipe from a meal plan |

All `/meal-plans*` page routes require auth and redirect to login if unauthenticated, consistent with `/cookbooks*`. All `/api/meal-plans*` routes require auth and return JSON `401` if unauthenticated, consistent with `/api/likes*` (there is no anonymous-GET case on that surface). Mutation endpoints on both surfaces share a 30-requests/minute-per-user rate limit. Meal plans are private by default and RLS-enforced; as of REW-69 an owner can opt one plan at a time into a Public share link (see below). Unlike Cookbooks' owner-only recipe rule, a meal plan can contain the owner's own recipes (any status) *or* any other user's published recipes, mirroring `recipe_likes`' visibility rule. See [Meal Plans API](meal-plans.md) for full details, including the RLS enforcement and two non-blocking reviewer-flagged follow-ups.

`GET /meal-plans/:id` was widened in REW-89 to feed the shared standardized recipe card: the same URL, middleware, auth and redirects, but more recipe columns (`user_id`, `original_author`, embedded categories/tags flattened into `categories`/`tags`) and a batched `isLiked` flag per recipe. No route was added or renamed and no JSON response shape changed. Because meal plan membership is own-or-published, this is the first card surface where a recipe the viewer does not own is a normal case, so Edit/Delete owner-gating and the owner-only status pill are live protections rather than future-proofing. See [Meal Plan Recipe Card](meal-plan-card.md). **Branch-only: implemented and reviewed on `REW-89-standardize-meal-plan-recipe-card`; the QA stage was excluded from the run, and the change is uncommitted.**

### Public meal plan sharing (REW-69)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/m/:id` | Public, unauthenticated read-only view of a **Public** meal plan: title, date range, and its published recipes. Private, nonexistent, and malformed IDs all return an identical 404 |

Runs exclusively on the anon-key Supabase client, so a Private recipe inside a shared plan is invisible at the database layer rather than filtered in application code. A plan's UUID is its share identifier — there is no share token. **Unlike Public cookbooks, Public meal plans are link-only and are never surfaced in `/search`** — a time-boxed personal schedule is not browsable content. See [Meal Plans API](meal-plans.md) for the full contract.

### Help & Feedback (REW-70)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/help-feedback` | Render the authenticated form with account contact defaults |
| POST | `/help-feedback` | Validate and store one owner-bound submission, then redirect |

See [Help & Feedback](help-feedback.md) for validation, RLS, and pending live verification.

### Admin Help & Feedback Management (REW-71)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/login` | Render the separate administrator sign-in form |
| POST | `/admin/login` | Authenticate through an isolated Supabase client and verify the trusted admin claim |
| POST | `/admin/logout` | Bind/revoke the caller's token pair and clear local cookies |
| GET | `/admin/feedback` | List submissions newest-first with All, Unresolved, or Done filtering |
| GET | `/admin/feedback/:id` | Show escaped submission details, progress history, and assignable profiles |
| POST | `/admin/feedback/:id` | Validate and update status/assignment, then redirect |
| POST | `/admin/feedback/:id/comments` | Append an authenticated, timestamped progress comment, then redirect |

All management routes require `requireAdmin` and use the request-scoped access token so RLS remains active. See [Admin Help & Feedback](admin-feedback.md).

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | List all categories |

### Tags

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tags` | List user's tags |
| POST | `/api/tags` | Create a new tag |
| DELETE | `/api/tags/:id` | Delete a tag |

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/login` | Login page |
| POST | `/auth/login` | Process login |
| GET | `/auth/register` | Registration page |
| POST | `/auth/register` | Process registration |
| POST | `/auth/logout` | Log out with CSRF protection; the former GET route returns 404 |
| GET | `/auth/callback` | Email confirmation callback (REW-41) |
| GET | `/auth/forgot-password` | Centralized account-recovery page — email field, "Send Password Reset Email" / "Resend Confirmation Email" actions (REW-54) |
| POST | `/auth/forgot-password` | Send a Supabase password-reset email (enumeration-safe) (REW-54) |
| GET | `/auth/resend-confirmation` | **Changed in REW-54:** now `302` redirects to `/auth/forgot-password` (forwarding `?email=`) instead of rendering its own page |
| POST | `/auth/resend-confirmation` | Process resend confirmation request (REW-41; unchanged in REW-54) |
| GET | `/auth/reset-password` | Verify a password-reset link and render the "set a new password" form (REW-54) |
| POST | `/auth/reset-password` | Set the new password on the recovery-granted session; requires auth + `recovery-session` cookie (REW-54) |

---

## Detailed Documentation

- [Recipe Scaling API](recipe-scaling.md) - Real-time ingredient scaling
- [Recipe Import - OCR/PDF Parsing](recipe-import-ocr-parsing.md) - Text extraction and parsing from PDFs and images, plus the pre-OCR image normalization and decoded-pixel cap (REW-95)
- [Recipe Import Save API](recipe-import-save.md) - Authenticated draft/publish persistence and required Cook Time validation (REW-77)
- [Recipe Import Limits & Error Contract](recipe-import-limits.md) - Upload size cap, import rate limit, and the JSON error responses from `POST /recipes/import/parse` (REW-43)
- [Recipe Photo Upload](recipe-photo-upload.md) - Photo size cap, upload rate limit, the flash-and-redirect error contract on `POST /recipes` and `POST /recipes/:id/update`, and the client-side pre-check (REW-94)
- [Recipe Visibility](recipe-visibility.md) - Private/Public mapping, fail-closed inputs, cloning, and public read enforcement (REW-85), plus the card-level toggle `POST /recipes/:id/visibility` (REW-86)
- [My Recipes Recipe Card](my-recipes-card.md) - the owner card contract, the card-level visibility toggle, the `/api/cookbooks` JSON API behind "+ Cookbook", the inert Share placeholder, and the shared `requireApiAuth` extraction (REW-86)
- [Cookbook Recipe Card](cookbook-card.md) - the cookbook card surface, the `cookbookId` local, and the widened `GET /cookbooks/:id` read with its batched favorite state (REW-88)
- [Meal Plan Recipe Card](meal-plan-card.md) - the meal plan card surface, the shared card partial's **current five-surface** local-variable contract (including the new `mealPlanId` local and the `showMealPlanAdd` flag), the widened `GET /meal-plans/:id` read, and the mixed-ownership rules that make owner-gating load-bearing (REW-89)
- [Add Recipe / Cloning](recipe-cloning.md) - authenticated copy contract, immutable attribution, copied fields and relationship isolation (REW-84)
- [Recipe Author Default](recipe-author-default.md) - Account-name defaulting on recipe create/import (REW-46)
- [Required Prep Time / Total Time](recipe-required-times.md) - Required-field enforcement and the Cook Time → Total Time display rename (REW-52)
- [Recipe Likes API](recipe-likes.md) - `/api/likes/:recipeId` endpoints, the My Recipes favorite control, and the draft-recipe restriction (REW-21, REW-55)
- [Cookbooks API](cookbooks.md) - `/cookbooks*` endpoints, RLS-enforced privacy, the recipe view "Save to Cookbook(s)" integration (REW-62), and Private/Public cookbook sharing via `POST /cookbooks/:id/visibility` and the public `GET /c/:id` (REW-19)
- [Meal Plans API](meal-plans.md) - `/meal-plans*` and `/api/meal-plans*` endpoints, the shared "Add to Meal Plan" modal, and the own-or-published recipe visibility rule (REW-63), plus Private/Public meal plan sharing via `POST /meal-plans/:id/visibility` and the link-only public `GET /m/:id` (REW-69)
- [Help & Feedback](help-feedback.md) - authenticated form routes, validation, durable intake, and RLS boundaries (REW-70)
- [Admin Help & Feedback](admin-feedback.md) - isolated admin authentication, queue/detail workflow, provisioning, CSRF, and RLS boundaries (REW-71)
- [Categories and Tags](../CATEGORIES_AND_TAGS.md) - Full categories/tags documentation
- [Email Confirmation Flow](email-confirmation.md) - Email verification and callback handling (REW-41); also documents the Forgot Password / Account Recovery flow that supersedes the standalone resend page (REW-54)

---

## Response Formats

### Success Responses

Most endpoints return JSON for API calls or render HTML views for page requests.

**JSON success example:**
```json
{
  "success": true,
  "data": { ... }
}
```

### Error Responses

| Status | Description |
|--------|-------------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Authentication required |
| 403 | Forbidden - Access denied |
| 404 | Not Found - Resource doesn't exist |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |

**Error format:**
```json
{
  "error": "Description of what went wrong"
}
```

---

## Rate Limiting

The API includes rate limiting to prevent abuse:

| Limiter | Limit | Scope | Active in |
|---------|-------|-------|-----------|
| **General** (`src/app.js`) | 300 requests per 15 minutes per IP | Every request | Production only (`NODE_ENV === 'production'`) |
| **File Uploads** (`src/routes/recipeRoutes.js`) | 10 uploads per 15 minutes per IP | Recipe photo uploads | All environments |
| **Recipe Imports** (`src/routes/importRoutes.js`) | 25 imports per 15 minutes per IP | `POST /recipes/import/parse` | All environments |
| **Recipe Visibility** (`src/routes/recipeRoutes.js`) | 60 changes per 15 minutes per IP | `POST /recipes/:id/visibility` (REW-86) | All environments |
| **Cookbook API** (`src/routes/cookbookApiRoutes.js`) | 30 mutations per minute per **user** | `POST`/`DELETE` on `/api/cookbooks*` (REW-86) | All environments |

Limits are keyed by client IP, not by user account — `express-rate-limit`'s default key is
the client IP. Users behind the same NAT share a budget. Per-user keying was considered and
rejected for the import limiter: it would let one IP multiply its budget by creating accounts.

The general limiter is only registered when `NODE_ENV === 'production'`, so local development
and the test suite are not rate-limited. The route-level limiters are always active. The two
REW-86 limiters are keyed differently on purpose: the visibility form post is IP-keyed like the
other `recipeRoutes.js` limiters, while the cookbook JSON API is user-keyed because every route on
it already runs behind auth (the same choice `/api/meal-plans*` and `/api/likes*` make).

**Upload size caps:** recipe imports accept a single file up to **4MB**, deliberately below
Vercel's hard 4.5MB request-body cap so oversize uploads return this app's JSON `413` rather than
an opaque platform error — see
[Recipe Import Limits & Error Contract](recipe-import-limits.md). Recipe photo uploads
(`imageUpload` in `recipeRoutes.js`) accept a single file up to **4MB** for the same reason
(REW-94, on branch — reviewed, not QA-verified, not merged); a rejected photo is answered with a
flashed message on the recipe form rather than the generic error page. See
[Recipe Photo Upload](recipe-photo-upload.md).

Both caps are pinned below `VERCEL_MAX_REQUEST_BODY_BYTES` in `src/config/functionLimits.js`
(`4.5 * 1024 * 1024`) by tests, so neither can drift back above the platform limit without failing
the suite.

**Decoded-pixel cap (images, import path only).** Upload size caps bound encoded bytes, which says
nothing about how large an image decompresses. Imported images are additionally capped at 40MP
decoded and downscaled to 2000x2000 before OCR (REW-95, on branch — reviewed, not QA-verified, not
merged). The recipe **photo** upload path has no equivalent cap; tracked as REW-96.

When the recipe import limit is exceeded, requests receive `429` with:
```json
{
  "error": "Too many import attempts. Please try again in 15 minutes."
}
```

The general limiter responds with `429` and the body
`Too many requests from this IP, please try again later.` sent via `res.send(string)`,
so it is served as `Content-Type: text/html` rather than JSON.

---

## CSRF Protection

All unsafe non-multipart requests require a CSRF token. For form submissions, include:

```html
<input type="hidden" name="_csrf" value="<%= csrfToken %>">
```

Same-origin JavaScript requests receive the token through the shared fetch wrapper's `x-csrf-token` header. Multipart routes bypass the pre-parser middleware and apply the same CSRF validation after Multer exposes `_csrf`; cross-origin requests do not receive a token.

**Known gap (REW-99):** the global `csrfProtectionExceptMultipart` wrapper in `src/app.js` skips token validation for *any* `multipart/form-data` body, not just the Multer routes that need it. Newer state-changing routes therefore re-apply `csrfProtection` explicitly at the route level — `POST /recipes/:id/clone`, `POST /recipes/:id/visibility`, `POST /recipes/:id/delete` (REW-101), `POST /cookbooks/:id/delete` and `POST /meal-plans/:id/delete` (REW-105), `POST /meal-plans/:id/recipes/:recipeId/remove`, `POST /cookbooks/:id/recipes/:recipeId`, `POST /api/meal-plans/:id/recipes/:recipeId` and `POST /api/likes/:recipeId` (REW-102), and every `/api/cookbooks*` mutation do this — so a forged cross-site multipart POST cannot reach them unchecked. The central fix is tracked as [REW-99](https://wanderingnerds.atlassian.net/browse/REW-99) and was deliberately deferred rather than attempted inside a card-standardization ticket. On every one of these except `POST /recipes/:id/clone`, CSRF runs *before* the route's rate limiter, so a forged request cannot burn the victim's limiter quota — `POST /recipes/:id/delete` has no per-route limiter at all, and the others are `requireAuth`/`requireApiAuth` → `csrfProtection` → limiter → handler. The clone route is the exception: its chain is `requireAuth` → `addRecipeLimiter` → `csrfProtection`, so a forged request there does consume quota before being rejected — an ordering nit tracked under REW-99. REW-101 shipped to `main` in PR #62 (commit `f8673b1`); REW-105 followed in PR #63 (commit `28a0cf8`); REW-102 published the full audit below and closed the four remaining content-route holes it found. Three session-lifecycle routes (`POST /auth/logout`, `POST /admin/logout`, `POST /admin/login`) are still forgeable and are tracked as [REW-106](https://wanderingnerds.atlassian.net/browse/REW-106).

### Route-level CSRF audit (REW-101 / REW-105 / REW-102)

**This is the audit of record.** It replaces the REW-101-only version published here earlier, which
carried four claims that were wrong or went stale — each is listed under
[Corrections](#corrections-to-the-rew-101-audit) below, with the reason. The line-level working
(every handler, file and line) lives in `docs/plans/rew-102-recipe-delete-csrf-audit.md`; line
numbers are deliberately omitted here so this table does not rot on the next edit.

All **43 mutating handlers** in `src/routes/` are classified — 39 `router.post` plus 4
`router.delete`. There are no `put`/`patch` routes, no mutating `app.*` routes, and
`categoryRoutes.js` / `publicRoutes.js` contain no mutations. Three mechanics drive every verdict:

- The global `csrfProtectionExceptMultipart` wrapper (`src/app.js`) calls `next()` with **no token
  validation at all** when `req.is("multipart/form-data")`. A plain HTML form on any origin can issue
  such a POST with no JavaScript and no CORS preflight, because multipart is a CORS-safelisted
  content type. (Whether the victim's cookies ride along is a separate question — see
  [`SameSite=Lax`](#samesitelax--how-much-it-actually-blunts-corrected) below. The classification
  here is about what the *server* accepts, which is what this app controls.)
- Nothing on a non-upload route parses that body, and body-parser leaves `req.body`
  **`undefined`** — not `{}` — when no parser matched. So a handler that reads no body field mutates
  normally; a handler that reads `req.body.x` throws a `TypeError` that its own `catch` swallows
  before the write. **The second case is an accident of the skip path, not a control** — see the
  [REW-99 tripwire](#rew-99-regression-tripwire-read-this-before-touching-the-wrapper).
- `DELETE`-verb routes are not reachable by this vector at all: HTML forms emit only GET and POST,
  and a cross-origin `fetch` with method DELETE is preflighted and refused by the `cors` origin
  allow-list.

#### (a) Route-level `csrfProtection` in place — 15 routes, no action

| Route | Chain | Added by |
| --- | --- | --- |
| `POST /recipes` | requireAuth → uploadLimiter → Multer → `handleRecipeImageUploadError` → csrfProtection | REW-94 (CSRF **after** Multer is correct here) |
| `POST /recipes/:id/update` | same shape | REW-94 |
| `POST /recipes/import/parse` | requireAuth → importLimiter → Multer → error handler → csrfProtection | REW-43 |
| `POST /recipes/:id/clone` | requireAuth → addRecipeLimiter → csrfProtection | REW-84 — protected, but the limiter runs **before** CSRF, so a forged request still burns the victim's quota. Ordering nit, REW-99. |
| `POST /recipes/:id/visibility` | requireAuth → csrfProtection → visibilityLimiter | REW-86 (the reference ordering) |
| `POST /recipes/:id/delete` | requireAuth → csrfProtection | REW-101 |
| `POST /cookbooks/:id/delete` | requireAuth → csrfProtection → cookbookLimiter | REW-105 |
| `POST /meal-plans/:id/delete` | requireAuth → csrfProtection → mealPlanLimiter | REW-105 |
| `POST /meal-plans/:id/recipes/:recipeId/remove` | requireAuth → csrfProtection → mealPlanLimiter | **REW-102** — was the one live destructive hole |
| `POST /cookbooks/:id/recipes/:recipeId` | requireAuth → csrfProtection → cookbookLimiter | **REW-102** |
| `POST /api/meal-plans/:id/recipes/:recipeId` | requireApiAuth → csrfProtection → mealPlanApiLimiter | **REW-102** |
| `POST /api/likes/:recipeId` | requireApiAuth → csrfProtection → likeLimiter | **REW-102** |
| `POST /api/cookbooks` | requireApiAuth → csrfProtection → cookbookApiLimiter | REW-86 |
| `POST /api/cookbooks/:id/recipes/:recipeId` | same | REW-86 |
| `DELETE /api/cookbooks/:id/recipes/:recipeId` | same | REW-86 |

On every one of these except `POST /recipes/:id/clone` and the three Multer routes, CSRF runs
**before** the route's rate limiter, so a forged cross-site request is rejected without consuming any
of the victim's quota. That ordering is a security property, not style, and the co-located tests pin
it by comparing against the exact `csrfProtection` export rather than a function name.

#### (b) Still forgeable via the multipart bypass — 3 routes, all session-lifecycle

These read **zero** body fields before mutating (or mutate *because* reading one throws), so
`req.body === undefined` never stops them. REW-102 deliberately held them back: they span the admin
auth boundary, and the right UX for a tokenless logout is a product decision, not something to settle
inside an audit diff. Tracked as [REW-106](https://wanderingnerds.atlassian.net/browse/REW-106).

| Route | Chain today | Effect of a forged cross-site multipart POST | Severity |
| --- | --- | --- | --- |
| `POST /auth/logout` | (none) | `logoutUser` signs the Supabase session out and clears both auth cookies → forced logout | Low (nuisance / session DoS) |
| `POST /admin/logout` | (none) | Same, for an administrator session | Low |
| `POST /admin/login` | limiter | **`req.body.email` throws on the unparsed body; the outer `catch { return deny(); }` swallows the `TypeError`, and `deny()`'s first statement is `clearAuthCookies(res)`.** So the forged request logs out *any* signed-in user, not just an admin, and consumes the victim IP's 10-per-15-minutes admin-login budget. The thrown `TypeError` does not prevent a mutation here — it causes one. | Low |

#### (c) Not exploitable — 25 routes, grouped by *why* (the reasons are not equally durable)

**c1. A real validator gates the mutation — safe on purpose (7 routes).** Each hands `req.body` to a
validator that tolerates a missing or empty object and rejects it before any write:
`POST /help-feedback` (`validateHelpFeedback(body = {})`), `POST /admin/feedback/:id`
(`normalizeUpdate(body = {})` → empty `status` is not in `FEEDBACK_STATUSES`),
`POST /admin/feedback/:id/comments` (`req.body?.commentText` → invalid → redirect),
`POST /auth/reset-password/session` (`const body = req.body || {}`, then `type !== "recovery"` →
`401` **before any cookie is set**, plus a mandatory same-origin Origin/Referer check),
`POST /auth/reset-password` (requires the `recovery-session` marker cookie before the body is
touched), and `POST /auth/login` / `/register` / `/forgot-password` / `/resend-confirmation`
(`redirectIfAuthenticated` short-circuits a signed-in victim; a signed-out one has no session to
abuse, and the attacker cannot place credentials in an unparsed body).

**c2. Safe only because a property access on `undefined` throws — fragile, not a control
(14 routes).** Each reads `req.body.<field>` with no optional chaining inside a `try`, before the
write; the `TypeError` is swallowed by the handler's own `catch` and the user sees a flash or a 500:
`POST /cookbooks`, `/cookbooks/:id/update`, `/cookbooks/:id/add-recipes`,
`/cookbooks/:id/visibility`, `/cookbooks/:id/recipes/:recipeId/remove`; `POST /meal-plans`,
`/meal-plans/:id/update`, `/meal-plans/:id/add-recipes`, `/meal-plans/:id/visibility`;
`POST /api/meal-plans`; `POST /api/tags`; `POST /recipes/import/save`;
`POST /recipes/import/check-title` (also read-only, so not a mutation in substance). Most of these
have a c1-style validator behind the accident (`validateCookbookTitle`, `validateMealPlanTitle`,
`normalizeRecipeIdSelection`) — belt **and** braces. **Three do not**, and those are the tripwire
below.

**c3. Verb not reachable by the vector (4 routes).** `DELETE /api/tags/:id`,
`DELETE /api/likes/:recipeId`, `DELETE /api/meal-plans/:id/recipes/:recipeId` — and
`DELETE /api/cookbooks/:id/recipes/:recipeId`, which carries route-level CSRF anyway. These rely on
the global wrapper structurally, but are not forgeable this way. REW-102 deliberately did **not** add
`csrfProtection` to them: it would be unverifiable scope creep.

#### REW-99 regression tripwire (read this before touching the wrapper)

Three c2 routes are safe today **only** because a property access on `undefined` throws, and they
have **no validation gate behind that accident**. They fail closed the moment `req.body` becomes
`{}`, or the wrapper starts parsing multipart bodies, or somebody "tidies" the read to
`req.body?.x`. Whoever works [REW-99](https://wanderingnerds.atlassian.net/browse/REW-99) must add
route-level `csrfProtection` to all three in the same change:

| Route | What happens the moment `req.body` is `{}` |
| --- | --- |
| `POST /cookbooks/:id/visibility` (`cookbookRoutes.js:351` → `handleCookbookVisibilityUpdate`) | `normalizeCookbookVisibility(undefined)` is `value === "public"` → `false`. It **fails closed to Private with no validity check**, so the handler proceeds to `UPDATE cookbooks SET is_public = false` — silently un-sharing the victim's cookbook and breaking every share link they distributed. It can never force *Public*, so this is forced-state/availability, not disclosure. |
| `POST /meal-plans/:id/visibility` (`mealPlanRoutes.js:416`) | Identical, via `normalizeMealPlanVisibility`. |
| `POST /cookbooks/:id/recipes/:recipeId/remove` | `req.body.returnTo` is the **first** statement in the `try`, so today's `TypeError` lands before the delete. With `{}` it evaluates to `undefined`, falls through to the default redirect, and the `cookbook_recipes` delete runs — a destructive hole identical to the one REW-102 just closed on the meal-plan side. |

**Pre-registered test consequence:** `src/routes/cookbookVisibilityRoutes.test.js` and
`src/routes/mealPlanVisibilityRoutes.test.js` both assert `layer.route.stack.length === 3`. Adding
`csrfProtection` to the visibility pair makes them fail. They must be **upgraded** to assert the
exact `csrfProtection` export and its position (the pattern in `recipeVisibilityToggle.test.js`) —
never relaxed, skipped or deleted.

#### `SameSite=Lax` — how much it actually blunts (corrected)

Both auth cookies are set with an **explicit** `sameSite: "lax"` (`src/utils/authUtils.js:10-23`).
That matters more than earlier write-ups here implied, and the correction cuts both ways:

- **A cross-site `multipart/form-data` POST does not carry those cookies in a current browser.** Lax
  sends cookies on a top-level navigation only for *safe* methods, and the "Lax+POST" two-minute
  grace window applies only to cookies with no `SameSite` attribute — not to one set explicitly. So
  for every route that needs the victim's cookie **on the request**, real-world exploitation needs a
  same-site attacker origin (any subdomain counts as same-site), a browser not enforcing Lax, or a
  non-browser client already holding the cookies. The bare phrase "forged cross-site multipart POST"
  used throughout this page is shorthand for the attack *shape*; it is not a claim that a stock
  Chrome tab attaches the session.
- **It does not blunt the REW-106 routes at all.** `POST /auth/logout`, `POST /admin/logout` and
  `POST /admin/login` clear cookies on the **response**. They need no request cookie to do damage, so
  a plain cross-site tokenless POST still forces a logout — and on `/admin/login` still burns the
  victim IP's limiter quota. `SameSite` is irrelevant to that class.

None of this downgrades a severity or makes any route-level check optional. `SameSite` is a browser
behaviour this app does not control, it is defence in depth rather than the intended control, and the
route-level `csrfProtection` in table (a) is what actually enforces request authenticity.

#### Corrections to the REW-101 audit

1. **The four routes REW-102 fixed were still listed as open holes assigned to REW-99.** They are
   protected as of REW-102 and now appear in table (a).
2. **`POST /admin/login` was classified safe ("body read precedes the mutation").** It is not. The
   swallowed `TypeError` routes straight into `deny()`, whose first statement clears the auth
   cookies — the exception *causes* the mutation rather than preventing it. Now in (b), tracked as
   REW-106.
3. **The visibility pair and `POST /cookbooks/:id/recipes/:recipeId/remove` were rated "Incidental —
   body read precedes the mutation."** Right outcome, wrong reason: there is no validation behind the
   thrown exception. Recorded as the REW-99 tripwire above.
4. **`POST /auth/reset-password/session` was marked "not verified."** Verified safe:
   `req.body || {}` then a `type !== "recovery"` → `401` before any cookie is set.
5. **The "REW-101 is branch-only and unmerged" note was stale.** REW-101 merged to `main` in
   `f8673b1` (PR #62); REW-105 followed in `28a0cf8` (PR #63).

#### Residual risk after REW-102, stated plainly

The three REW-106 session-lifecycle routes remain forgeable (forced logout). The three tripwire
routes remain safe only by accident of body-parser's skip path. The global wrapper remains over-broad
until REW-99. `POST /recipes/:id/clone` still runs its limiter before CSRF. Manual verification of
REW-102 — and the five-surface delete pass still owed from REW-101 — has **not** been performed;
the QA stage was skipped on all three of these tickets.
