# Required Prep Time / Total Time (REW-52)

**Feature:** REW-52 — Require Prep Time and Total Time before saving a recipe
**Component:** `views/recipes/new.ejs`, `views/recipes/edit.ejs`, `public/js/recipe-form.js`, `public/css/styles.css`, `src/routes/recipeRoutes.js`
**Last Updated:** 2026-09-03

---

## Overview

QA found that the "New Recipe" and "Edit Recipe" forms allowed saving a recipe with Prep Time and/or Cook Time left blank. Both fields are now required, matching the existing Title/Instructions required-field pattern:

- A red `*` marker is shown next to each label.
- Submitting the form with either field blank is blocked client-side: the field's `.form-group` gets a red border/label and an inline "Required" message, and the browser never sends the request.
- The error clears live, per field, as soon as the user types a non-blank value into that field (independent of the other field's state).
- The same requirement is enforced server-side in both `POST /recipes` and `POST /recipes/:id/update` as defense-in-depth (client-side JS can be bypassed).
- The requirement applies uniformly to both "Save as draft" and "Publish recipe" — there is no draft exemption, consistent with how Title/Instructions are already enforced.

This is an application-layer (view + client JS + route handler) change only. No database migration.

---

## Naming decision: "Cook Time" is now displayed as "Total Time" — no new column

The app has never had a `total_time` concept — only `prep_time` and `cook_time` exist end-to-end in the schema, routes, and views (`database/migrations/001_create_recipes_table.sql` defines both as nullable `TEXT`). The OCR/PDF importer (`src/utils/recipeImporter.js`) does parse a `totalTime` value out of source text, but it was already dead data — never persisted, never rendered, never saved by `POST /recipes/import/save`.

Rather than introduce a new `total_time` column (which would require a migration, a new form field, and updates to the importer's discarded value), this change **relabels the existing "Cook Time" field to display as "Total Time"** on the create/edit forms only:

- The visible `<label>` text is now "Total Time".
- The underlying `name="cookTime"` request field and the `cook_time` database column are **unchanged**.
- `views/recipes/new.ejs` and `views/recipes/edit.ejs` both carry an inline comment next to the field noting this intentionally, so a future edit doesn't "helpfully" rename the `name` attribute and break the route/DB mapping.

**Known naming inconsistency (non-blocking, flagged by Reviewer):** `views/recipes/view.ejs` and `views/recipes/public-view.ejs` still label this same data as "Cook Time" when displaying a saved recipe — only the create/edit form labels changed. A recipe's detail page and its edit form will show different labels for the same value until a fast-follow ticket aligns them. `views/partials/recipe-card.ejs` and `src/routes/importRoutes.js` were also left untouched, per the plan's scope (see "Out of scope" below).

---

## Affected endpoints

### `GET /recipes/new` / `GET /recipes/:id/edit`

**Auth:** Required (`requireAuth`)

No change to the route contract or response shape. The rendered forms now include required-field markup (`*` markers, `id`, `aria-required`, `aria-describedby`, and a `.field-error-message` span) on the Prep Time and Total Time (`cookTime`) inputs, plus a `class="recipe-form"` hook on the `<form>` tag for the new client-side validation script.

### `POST /recipes` (create recipe)

**Auth:** Required (`requireAuth`)

**Request body fields:** `prepTime`, `cookTime` (both now required, in addition to the pre-existing `title`/`instructions` requirement)

**Behavior change:**
- Previous: `if (!title || !instructions) { ... }` — a recipe could be created with `prep_time`/`cook_time` both `null`.
- Now: `if (!title || !instructions || !prepTime?.trim() || !cookTime?.trim()) { ... }` — the same guard now also rejects a blank/whitespace-only `prepTime` or `cookTime`. On failure, the existing flash-message/redirect pattern is used (flash error, `redirect("/recipes/new")`); the flash text was updated to "Title, instructions, prep time, and total time are required."
- No change to the `recipeData` field mapping — `prep_time`/`cook_time` are still written from `prepTime`/`cookTime` exactly as before; they're now just guaranteed non-blank by the time that code runs.

Applies uniformly regardless of the `action` value (`draft` or `publish`) — no draft exemption.

### `POST /recipes/:id/update`

**Auth:** Required (`requireAuth`)

Identical extension to the same guard, redirecting back to `/recipes/:id/edit` on failure instead of `/recipes/new`. Same flash message text.

No change to response shape, status codes, or auth requirements on either route.

---

## Client-side validation (`public/js/recipe-form.js`)

A new `DOMContentLoaded` block (independent of the existing photo-preview logic) wires:

- **On form `submit`:** checks `prepTime`/`cookTime` for a blank (post-`.trim()`) value. Any blank field gets `has-error` added to its `.form-group` and `aria-invalid="true"`; the first invalid field (Prep Time before Total Time) receives focus and `event.preventDefault()` stops the submission.
- **On each field's `input` event:** if that field is now non-blank, its own error state clears immediately — independent of the other field, so fixing one does not clear the other.

This mirrors the CSS added in `public/css/styles.css` (`.form-group.has-error` — red label/border; `.field-error-message` — hidden by default, shown only when errored), using the existing `--error-color` CSS variable already used for the `*` markers.

---

## Out of scope

- **Import Recipe flow** (`views/recipes/import.ejs`, `public/js/import.js`, `src/routes/importRoutes.js`, `POST /recipes/import/save`) is unaffected — imported recipes can still save with blank Prep/Cook time. The ticket's finding targeted the primary Add/Edit Recipe form only.
- **No `NOT NULL` database constraint added.** Existing rows likely contain `NULL` prep/cook times, and adding `NOT NULL` would need a backfill plus would break the still-optional Import flow. Enforcement is application-layer only, matching how the pre-existing `title`/`instructions` `NOT NULL` constraint was never retroactively required for this kind of change.
- **Stale helper text (non-blocking, flagged by Reviewer, not fixed in this change):** both forms still show "Only a title and instructions are required — everything else is optional" (`new.ejs`) / "Only title and instructions are required" (`edit.ejs`). This copy is now inaccurate since Prep Time and Total Time are also required. Recommend a copy fix in a fast-follow.
- **Server-side failure path does not preserve other field values (pre-existing gap, not introduced by this change).** If the server-side check fires (bypassing the client JS), the handler flashes an error and redirects to a fresh form, losing any other filled-in fields. Normal browser usage never hits this path, since the client-side check blocks submission first.

---

## Related Documentation

- [API Overview](README.md) — all API endpoints
- [Recipe Author Default](recipe-author-default.md)
- Plan: `docs/plans/rew-52-require-prep-total-time.md`
- Confluence: [REW-9, REW-10 & REW-46: Manual Recipe Entry, Recipe Search, and Recipe Author Default](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/10485762/REW-9+REW-10+REW-46+Manual+Recipe+Entry+Recipe+Search+and+Recipe+Author+Default) — see the "REW-52: Required Prep Time / Total Time" section

---

## Changelog

| Date | Change |
|------|--------|
| 2026-09-03 | Initial documentation for REW-52 |
