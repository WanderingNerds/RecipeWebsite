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
| GET | `/recipes` | List user's recipes (with optional category/tag filtering) |
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
| GET | `/auth/resend-confirmation` | Resend confirmation email page (REW-41) |
| POST | `/auth/resend-confirmation` | Process resend confirmation request (REW-41) |

---

## Detailed Documentation

- [Recipe Scaling API](recipe-scaling.md) - Real-time ingredient scaling
- [Recipe Import - OCR/PDF Parsing](recipe-import-ocr-parsing.md) - Text extraction and parsing from PDFs and images
- [Recipe Author Default](recipe-author-default.md) - Account-name defaulting on recipe create/import (REW-46)
- [Required Prep Time / Total Time](recipe-required-times.md) - Required-field enforcement and the Cook Time → Total Time display rename (REW-52)
- [Categories and Tags](../CATEGORIES_AND_TAGS.md) - Full categories/tags documentation
- [Email Confirmation Flow](email-confirmation.md) - Email verification and callback handling (REW-41)

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
