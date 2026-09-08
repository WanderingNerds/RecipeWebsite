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

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/recipes` | List user's recipes (with optional category/tag filtering); each recipe includes a server-rendered favorite/like state, batch-fetched from `recipe_likes` (REW-55) |
| GET | `/recipes/new` | Get form data for creating a recipe (Author field pre-filled with account display name, REW-46; Prep Time and Total Time/`cookTime` are required, REW-52) |
| POST | `/recipes` | Create a new recipe (Author defaults server-side to account display name if blank/missing, REW-46; rejects blank `prepTime`/`cookTime`, REW-52) |
| GET | `/recipes/:id` | View a single recipe |
| GET | `/recipes/:id/edit` | Get form data for editing a recipe (Prep Time and Total Time/`cookTime` are required, REW-52) |
| POST | `/recipes/:id/update` | Update a recipe (rejects blank `prepTime`/`cookTime`, REW-52) |
| POST | `/recipes/:id/delete` | Delete a recipe |
| GET | `/recipes/:id/scale` | Get scaled ingredient data (JSON) |

### Recipe Import (REW-12)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/recipes/import` | Render import page with upload form (Author field pre-filled with account display name, REW-46) |
| POST | `/recipes/import/parse` | Parse uploaded file, return JSON preview |
| POST | `/recipes/import/save` | Save imported recipe after user confirmation (accepts `author`, defaults server-side to account display name if blank/missing, REW-46) |

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

All `/cookbooks*` routes require auth and are private to the owner (no sharing — see REW-19, out of scope). Mutation endpoints share a 30-requests/minute-per-user rate limit. See [Cookbooks API](cookbooks.md) for full details, including the recipe-view integration and RLS enforcement.

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
| GET | `/auth/logout` | Log out |
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
- [Recipe Import - OCR/PDF Parsing](recipe-import-ocr-parsing.md) - Text extraction and parsing from PDFs and images
- [Recipe Author Default](recipe-author-default.md) - Account-name defaulting on recipe create/import (REW-46)
- [Required Prep Time / Total Time](recipe-required-times.md) - Required-field enforcement and the Cook Time → Total Time display rename (REW-52)
- [Recipe Likes API](recipe-likes.md) - `/api/likes/:recipeId` endpoints, the My Recipes favorite control, and the draft-recipe restriction (REW-21, REW-55)
- [Cookbooks API](cookbooks.md) - `/cookbooks*` endpoints, RLS-enforced privacy, and the recipe view "Save to Cookbook(s)" integration (REW-62)
- [Meal Plans API](meal-plans.md) - `/meal-plans*` and `/api/meal-plans*` endpoints, the shared "Add to Meal Plan" modal, and the own-or-published recipe visibility rule (REW-63)
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

- **General:** 100 requests per 15 minutes per IP
- **File Uploads:** 10 uploads per 15 minutes per IP
- **Recipe Imports:** 5 imports per 15 minutes per user

When rate limited, requests receive:
```json
{
  "message": "Too many requests. Please try again later."
}
```

---

## CSRF Protection

All POST/PUT/DELETE requests require a CSRF token. For form submissions, include:

```html
<input type="hidden" name="_csrf" value="<%= csrfToken %>">
```

For AJAX requests, the token should be included in the request body or headers.
