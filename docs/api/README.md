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
| POST | `/recipes` | Create a new recipe (Author defaults server-side to account display name if blank/missing, REW-46; rejects blank `prepTime`/`cookTime`, REW-52) |
| GET | `/recipes/:id` | View a single recipe |
| GET | `/recipes/:id/edit` | Get form data for editing a recipe (Prep Time and Total Time/`cookTime` are required, REW-52) |
| POST | `/recipes/:id/update` | Update a recipe (rejects blank `prepTime`/`cookTime`, REW-52) |
| POST | `/recipes/:id/delete` | Delete a recipe |
| POST | `/recipes/:id/clone` | Add another user's Public recipe as a new Private, independently owned recipe (REW-84) |
| GET | `/recipes/:id/scale` | Get scaled ingredient data (JSON) |

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
| POST | `/api/likes/:recipeId` | Like a recipe (requires auth; recipe must be `status = 'published'`, otherwise `404`) |
| DELETE | `/api/likes/:recipeId` | Unlike a recipe (requires auth) |
| GET | `/recipes/liked` | Display the current user's liked (published) recipes |

Favorite/like controls (`.like-btn`) call these endpoints from the recipe detail page (REW-21) and, as of REW-55, from each card on the My Recipes page (`/recipes`) as well. See [Recipe Likes API](recipe-likes.md) for full details, including why draft recipe cards render a disabled heart.

### Cookbooks (REW-62)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cookbooks` | List the current user's cookbooks with a per-cookbook recipe count |
| GET | `/cookbooks/new` | Render the create-cookbook form |
| POST | `/cookbooks` | Create a cookbook (title required, trimmed, max 200 chars) |
| GET | `/cookbooks/:id` | View a cookbook and all recipes currently in it |
| GET | `/cookbooks/:id/edit` | Render the rename form |
| POST | `/cookbooks/:id/update` | Rename a cookbook |
| POST | `/cookbooks/:id/delete` | Delete a cookbook (never deletes the recipes in it) |
| GET | `/cookbooks/:id/add-recipes` | Render a checklist of the owner's recipes (draft + published) to add to a cookbook |
| POST | `/cookbooks/:id/add-recipes` | Bulk-add selected recipes to a cookbook |
| POST | `/cookbooks/:id/recipes/:recipeId` | Add a single recipe to a cookbook (used by the recipe view's "Save to Cookbook(s)" widget) |
| POST | `/cookbooks/:id/recipes/:recipeId/remove` | Remove a recipe from a cookbook (never deletes the recipe itself) |
| POST | `/cookbooks/:id/visibility` | Switch a cookbook between Private and Public (`visibility=private\|public`, fails closed to Private) — REW-19 |

All `/cookbooks*` routes require auth and act only on the caller's own cookbooks. Mutation endpoints share a 30-requests/minute-per-user rate limit. See [Cookbooks API](cookbooks.md) for full details, including the recipe-view integration and RLS enforcement.

### Public cookbook sharing (REW-19)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/c/:id` | Public, unauthenticated read-only view of a **Public** cookbook and its published recipes. Private, nonexistent, and malformed IDs all return an identical 404 |
| GET | `/search?q=…` | Recipe search, extended with a capped secondary "Cookbooks" section (up to 5 Public cookbooks, page 1 only) |

Both run exclusively on the anon-key Supabase client, so a draft recipe inside a shared cookbook is invisible at the database layer rather than filtered in application code. A cookbook's UUID is its share identifier — there is no share token. See [Cookbooks API](cookbooks.md) for the full contract.

### Meal Plans (REW-63)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/meal-plans` | List the current user's meal plans with a per-plan recipe count |
| GET | `/meal-plans/new` | Render the create-meal-plan form (title + start/end date) |
| POST | `/meal-plans` | Create a meal plan (title required; start/end date required, `end >= start`) |
| GET | `/meal-plans/:id` | View a meal plan and all recipes currently in it |
| GET | `/meal-plans/:id/edit` | Render the rename/re-date form |
| POST | `/meal-plans/:id/update` | Rename and/or re-date a meal plan |
| POST | `/meal-plans/:id/delete` | Delete a meal plan (never deletes the recipes in it) |
| GET | `/meal-plans/:id/add-recipes` | Render a checklist of the owner's own recipes (draft + published) to bulk-add to a plan |
| POST | `/meal-plans/:id/add-recipes` | Bulk-add selected (owner's own) recipes to a meal plan |
| POST | `/meal-plans/:id/recipes/:recipeId/remove` | Remove a recipe from a meal plan (never deletes the recipe itself) |
| GET | `/api/meal-plans?recipeId=` | JSON: list the current user's meal plans, optionally flagging membership for `recipeId` |
| POST | `/api/meal-plans` | JSON: quick-create a meal plan (backs the "Add to Meal Plan" modal) |
| POST | `/api/meal-plans/:id/recipes/:recipeId` | JSON: add a recipe to a meal plan — allows the caller's own recipe (any status) or **any published recipe**, not owner-only |
| DELETE | `/api/meal-plans/:id/recipes/:recipeId` | JSON: remove a recipe from a meal plan |

All `/meal-plans*` page routes require auth and redirect to login if unauthenticated, consistent with `/cookbooks*`. All `/api/meal-plans*` routes require auth and return JSON `401` if unauthenticated, consistent with `/api/likes*` (there is no anonymous-GET case for meal plans). Mutation endpoints on both surfaces share a 30-requests/minute-per-user rate limit. Meal plans are private to their owner (RLS-enforced, no sharing), unlike Cookbooks' owner-only recipe rule — a meal plan can contain the owner's own recipes (any status) *or* any other user's published recipes, mirroring `recipe_likes`' visibility rule. See [Meal Plans API](meal-plans.md) for full details, including the RLS enforcement and two non-blocking reviewer-flagged follow-ups.

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
- [Recipe Visibility](recipe-visibility.md) - Private/Public mapping, fail-closed inputs, cloning, and public read enforcement (REW-85)
- [Add Recipe / Cloning](recipe-cloning.md) - authenticated copy contract, immutable attribution, copied fields and relationship isolation (REW-84)
- [Recipe Author Default](recipe-author-default.md) - Account-name defaulting on recipe create/import (REW-46)
- [Required Prep Time / Total Time](recipe-required-times.md) - Required-field enforcement and the Cook Time → Total Time display rename (REW-52)
- [Recipe Likes API](recipe-likes.md) - `/api/likes/:recipeId` endpoints, the My Recipes favorite control, and the draft-recipe restriction (REW-21, REW-55)
- [Cookbooks API](cookbooks.md) - `/cookbooks*` endpoints, RLS-enforced privacy, the recipe view "Save to Cookbook(s)" integration (REW-62), and Private/Public cookbook sharing via `POST /cookbooks/:id/visibility` and the public `GET /c/:id` (REW-19)
- [Meal Plans API](meal-plans.md) - `/meal-plans*` and `/api/meal-plans*` endpoints, the shared "Add to Meal Plan" modal, and the own-or-published recipe visibility rule (REW-63)
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

Limits are keyed by client IP, not by user account — `express-rate-limit`'s default key is
the client IP. Users behind the same NAT share a budget. Per-user keying was considered and
rejected for the import limiter: it would let one IP multiply its budget by creating accounts.

The general limiter is only registered when `NODE_ENV === 'production'`, so local development
and the test suite are not rate-limited. The two route-level limiters are always active.

**Upload size caps:** recipe imports accept a single file up to **4MB**, deliberately below
Vercel's hard 4.5MB request-body cap so oversize uploads return this app's JSON `413` rather than
an opaque platform error — see
[Recipe Import Limits & Error Contract](recipe-import-limits.md). Recipe photo uploads
(`recipeRoutes.js`) are still configured at 5MB, which is *above* that platform cap and therefore
cannot fully work in production; tracked as REW-94.

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
