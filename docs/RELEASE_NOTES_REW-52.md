# Release Notes: REW-52 - Require Prep Time and Total Time Before Saving a Recipe

**Date:** 2026-09-03
**Jira Issue:** [REW-52](https://wanderingnerds.atlassian.net/browse/REW-52)
**Branch:** `REW-52-require-prep-total-time`
**Pipeline:** Planner → Developer → Reviewer (approved, no blocking issues). QA stage was explicitly excluded for this run by operator instruction; this change has **not** been QA-verified. Reviewer approval is the completion gate for this release note.

---

## Summary

QA found that the "New Recipe" and "Edit Recipe" forms allowed saving a recipe with Prep Time and/or Cook Time left blank. Both fields are now required on both forms — matching the existing Title/Instructions pattern — with inline client-side validation (red border/label, "Required" message, live-clearing per field) and a server-side guard as defense-in-depth. No database migration was needed or added.

---

## User-Facing Changes

- The "New Recipe" and "Edit Recipe" forms now show a red `*` next to Prep Time and Total Time (the former "Cook Time" field, relabeled — see Technical Changes).
- Submitting either form with Prep Time and/or Total Time blank no longer saves the recipe: the affected field(s) get a red border/label and a "Required" message beneath them, and the page stays put.
- Typing a value into a previously-blank field clears its error immediately, independent of the other field.
- This applies to both "Save as draft" and "Publish recipe" — there is no draft exemption.
- The Import Recipe flow is unaffected and can still save with blank Prep/Cook time (explicitly out of scope for this ticket).

---

## Technical Changes

### Naming decision: "Cook Time" → "Total Time" (display only, no migration)

The app has no `total_time` concept anywhere in the schema, routes, or views — only `prep_time`/`cook_time` exist end-to-end. Rather than add a new `total_time` column, this change relabels the existing "Cook Time" field to display as "Total Time" on the create/edit forms only. The underlying `name="cookTime"` request field and `cook_time` database column are unchanged, avoiding a migration and avoiding changes to every other read site (`views/recipes/view.ejs`, `views/recipes/public-view.ejs`, `views/partials/recipe-card.ejs`, `src/routes/importRoutes.js`). Both forms carry an inline code comment flagging this intentionally so it isn't "corrected" by a future edit.

### `views/recipes/new.ejs` / `views/recipes/edit.ejs`
- `<form>` tag gets `class="recipe-form"` as a hook for the new client-side validation script.
- Prep Time label: "Prep Time" + red `*`; input gets `id="prepTime"`, `aria-required="true"`, `aria-describedby="prepTimeError"`, and a `<span class="field-error-message" id="prepTimeError">Required</span>`.
- Cook Time field: label changed to "Total Time" + red `*`; input gets `id="cookTime"` (name unchanged), same `aria-*`/error-span pattern as Prep Time.

### `public/css/styles.css`
- New `.field-error-message` (hidden by default, red text) and `.form-group.has-error` (red label/border) rules, reusing the existing `--error-color` variable already used for required-field `*` markers.

### `public/js/recipe-form.js`
- New `DOMContentLoaded` block, independent of the existing photo-preview logic: on `submit`, blocks the request and flags any blank Prep Time/Total Time field with `has-error` + `aria-invalid="true"`, focusing the first invalid field; on each field's `input` event, clears that field's own error state as soon as it becomes non-blank.

### `src/routes/recipeRoutes.js`
- `POST /` (create) and `POST /:id/update`: the existing `if (!title || !instructions)` guard now also requires `prepTime?.trim()` and `cookTime?.trim()`. Flash message updated to "Title, instructions, prep time, and total time are required." No change to the `recipeData`/`updateData` field mapping.

### Database
None. `prep_time`/`cook_time` were already nullable `TEXT` columns. No `NOT NULL` constraint was added (would require a backfill and would break the still-optional Import flow).

---

## Known Non-Blocking Follow-Ups (flagged by Reviewer, not fixed in this pass)

1. **Stale helper text.** Both forms' subheading copy ("Only a title and instructions are required — everything else is optional" on `new.ejs`; "Only title and instructions are required" on `edit.ejs`) is now inaccurate since Prep Time and Total Time are also required. Copy nit, not fixed in this change.
2. **Cook Time / Total Time naming inconsistency.** `views/recipes/view.ejs` and `views/recipes/public-view.ejs` still display this field as "Cook Time" even though the create/edit forms now call it "Total Time." Same underlying data, different label depending on which page you're on — worth a fast-follow ticket to align the labels.

---

## Breaking Changes

None. Existing recipes with a `null` `prep_time`/`cook_time` are unaffected on read; the new requirement only applies going forward, at save time.

---

## Deployment

No special deployment steps required. No database migrations, no new environment variables, no changes to security middleware (auth/CSRF/rate-limiting/upload validation are untouched).

---

## Testing

Manual verification per the plan's acceptance criteria (browser testing of blank/partial/filled submissions on both forms, live error-clearing, draft vs. publish, server-side bypass via direct POST). `npm test` run as a regression smoke check — no existing automated suite covers client-side DOM/JS in this repo.

**QA status:** This pipeline run explicitly excluded the QA stage by operator instruction. This change has been code-reviewed and approved with no blocking issues, but has **not** been QA-verified against the acceptance criteria in `docs/plans/rew-52-require-prep-total-time.md`. Recommend a QA pass before/alongside production deployment if that verification is still required by your release process.

---

## Documentation

- `docs/api/recipe-required-times.md` (new) — full request/response and behavior documentation.
- `docs/api/README.md` — endpoint table and detailed-docs list updated.
- `database/README.md` — note added on `prep_time`/`cook_time` required-field enforcement and the display-only "Total Time" rename.
- `README.md` — feature bullet added under Recipe Management.
- Confluence: [REW-9, REW-10 & REW-46: Manual Recipe Entry, Recipe Search, and Recipe Author Default](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/10485762/REW-9+REW-10+REW-46+Manual+Recipe+Entry+Recipe+Search+and+Recipe+Author+Default) — **could not be updated live this session; Atlassian MCP tools were unavailable** (see `docs/confluence/REW-52-required-prep-total-time.md` for the drafted section content, ready to paste in once access is available).
