# Recipe Author Default (REW-46)

**Feature:** REW-46 — Default recipe author to logged-in account name
**Component:** `src/utils/userUtils.js`, `src/routes/recipeRoutes.js`, `src/routes/importRoutes.js`
**Last Updated:** 2026-08-30

---

## Overview

When a logged-in user creates a recipe — either through the manual "New Recipe" form or the Import Recipe flow — the `Author` field defaults to that user's account display name instead of arriving blank. The field remains fully editable; a user can still attribute a recipe to someone else (e.g. "Grandma's recipe").

Before this change, the manual New Recipe form pre-filled Author client-side only, so a blank/cleared submission (or a direct API call bypassing the form) still saved `author = NULL`. The Import Recipe flow had no Author field at all, so every imported recipe saved `author = NULL` regardless of who was logged in.

This is an application-layer fix only — no database schema or migration changes. `recipes.author` was already a nullable `TEXT` column.

---

## Shared helper: `getAccountDisplayName(user)`

**Location:** `src/utils/userUtils.js`

```js
export function getAccountDisplayName(user) {
  const name = user?.user_metadata?.name;
  if (typeof name === "string" && name.trim()) {
    return name.trim();
  }
  return user?.email || null;
}
```

| Input | Output |
|---|---|
| `user.user_metadata.name` set (non-whitespace) | trimmed name |
| `user.user_metadata.name` absent, empty, or whitespace-only | `user.email` |
| `user` is `null`/`undefined`, or has neither name nor email | `null` |

This is the single source of truth for "account display name" and is used both to pre-fill the Author field in views and to enforce the default server-side on save. It replaces a previously-duplicated inline expression (`user.user_metadata?.name || user.email`) that lived only in `views/recipes/new.ejs`.

Unit tests: `src/utils/userUtils.test.js` (6 cases — name set, name absent, `user_metadata` absent entirely, whitespace-only name, null/undefined user, user with neither name nor email).

Note: `views/partials/navbar.ejs` still has its own inline copy of this same fallback expression for the "Hello, {name}" greeting. Consolidating it onto the shared helper was considered (plan task 10) but skipped — it would require adding a new global `res.locals` field to the app-wide locals middleware in `src/app.js`, which is a broader change than this ticket's scope. Tracked as a known, non-blocking inconsistency, not a functional gap (both expressions currently produce the same value).

---

## Affected endpoints

### `GET /recipes/new`

**Auth:** Required (`requireAuth`)

No change to the route contract. The rendered view now receives an additional local, `accountDisplayName` (string or `null`), computed via `getAccountDisplayName(req.user)`, which the Author input's `value` attribute uses to pre-fill.

### `POST /recipes` (create recipe)

**Auth:** Required (`requireAuth`)

**Request body field:** `author` (optional, string)

**Behavior change:**
- Previous: `author` was saved as submitted (trimmed) or `null` if blank — relied entirely on the client having pre-filled it.
- Now: if the submitted `author` is blank/missing after trimming, the server falls back to `getAccountDisplayName(req.user)` before saving. Only if the account has neither a registered name nor an email (a theoretical edge case, since Supabase accounts always have an email) does `author` save as `null`.
- A user-supplied non-blank `author` value is always saved as submitted — the default is a fallback, not an override.

No change to response shape, status codes, or auth requirements.

### `GET /recipes/import`

**Auth:** Required (`requireAuth`)

Same pattern as `GET /recipes/new`: the view now receives `accountDisplayName` and uses it to pre-fill a new Author field (see below).

### `POST /recipes/import/save`

**Auth:** Required (`requireAuth`)

**Request body field:** `author` (new, optional, string) — previously not accepted/used at all.

**Behavior change:**
- Previous: `author` was never read from the request body; every imported recipe saved `author = NULL`.
- Now: same fallback logic as `POST /recipes` — submitted trimmed value if present, else `getAccountDisplayName(req.user)`, else `null`.

No change to response shape or status codes.

---

## Import Recipe UI change

`views/recipes/import.ejs` gained a new "Author" field (`id="importAuthor"`, `name="author"`) in the import review form's meta grid, alongside Prep Time / Cook Time / Servings / Source URL, pre-filled from `accountDisplayName`. `public/js/import.js` reads this field and includes `author: importAuthor.value.trim()` in the JSON payload posted to `POST /recipes/import/save`. It is independent of the parsed-file preview — `displayPreview()` does not overwrite it.

**Known cosmetic follow-up (non-blocking, flagged in code review):** the meta grid uses a fixed 4-column layout (`.form-grid-meta-4`); with 5 fields now present, "Source URL" wraps alone onto a second row at desktop widths, leaving empty grid cells. No functional impact — not filed as a ticket.

---

## Out of scope

- `GET /recipes/:id/edit` and `POST /recipes/:id/update` are unaffected — editing an existing recipe's `author` (including a pre-existing `null`) behaves exactly as before this change.
- No `maxlength`/server-side length cap was added to `author` in either create/import route (pre-existing gap, flagged during planning and again during review as a suggestion, not a blocker).

---

## Related Documentation

- [API Overview](README.md) — all API endpoints
- [Recipe Import - OCR/PDF Parsing](recipe-import-ocr-parsing.md)
- Confluence: [REW-9, REW-10 & REW-46: Manual Recipe Entry, Recipe Search, and Recipe Author Default](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/10485762/REW-9+REW-10+REW-46+Manual+Recipe+Entry+Recipe+Search+and+Recipe+Author+Default)

---

## Changelog

| Date | Change |
|------|--------|
| 2026-08-30 | Initial documentation for REW-46 |
