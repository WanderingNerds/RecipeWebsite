# Confluence update for REW-52 — drafted content, not yet posted

**Target page:** [REW-9, REW-10 & REW-46: Manual Recipe Entry, Recipe Search, and Recipe Author Default](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/10485762/REW-9+REW-10+REW-46+Manual+Recipe+Entry+Recipe+Search+and+Recipe+Author+Default)

**Status:** Posted to Confluence (page 10485762, version 5) by the orchestrating session, which had working Atlassian Rovo MCP access even though this documentation subagent did not. This file is retained as a record of the drafted content; the live page also has its overview status table updated to list REW-52 as Done.

Add this as a new `##`-level section titled **"REW-52: Required Prep Time / Total Time"** on the existing page:

---

## REW-52: Required Prep Time / Total Time

**Status:** Complete — implemented, code-reviewed (approved, no blocking issues). QA stage was intentionally excluded for this pipeline run by operator instruction; not yet QA-verified.

**Jira:** [REW-52](https://wanderingnerds.atlassian.net/browse/REW-52)

The manual "New Recipe" (`views/recipes/new.ejs`) and "Edit Recipe" (`views/recipes/edit.ejs`) forms now require both the Prep Time and Total Time fields before a recipe can be saved, as either a draft or published. A red `*` marks both fields; submitting with either blank shows an inline red-border/"Required" error under the field and blocks the save (client-side, `public/js/recipe-form.js`), re-checked server-side (`POST /recipes`, `POST /recipes/:id/update` in `src/routes/recipeRoutes.js`) as defense-in-depth. The error clears live, per field, as soon as a value is typed.

**Naming note — read this before editing the form fields.** "Total Time" is a **display-only relabel of the existing "Cook Time" field**. The app has never had a real `total_time` concept in its database schema, routes, or views — only `prep_time`/`cook_time` exist. No new column or migration was added; the underlying `name="cookTime"` attribute and `cook_time` database column are unchanged, and both view templates carry an inline comment flagging this so it isn't accidentally "corrected" later. As a result, there is a known, non-blocking naming inconsistency: the recipe detail pages (`views/recipes/view.ejs`, `views/recipes/public-view.ejs`) still label this same field "Cook Time." A fast-follow ticket to align the labels across the app is recommended but not yet filed.

**Out of scope:** the Import Recipe flow (`views/recipes/import.ejs`, `POST /recipes/import/save`) is unaffected and can still save a recipe with blank Prep/Cook time.

**Known non-blocking follow-ups (flagged by Reviewer):**
1. Both forms' helper text ("Only a title and instructions are required...") is now stale since Prep/Total Time are also required — copy nit, not fixed in this change.
2. Cook Time / Total Time label inconsistency between the edit form and the recipe detail views (see Naming note above).

**Documentation:** `docs/api/recipe-required-times.md`, `docs/RELEASE_NOTES_REW-52.md`.

---

*Once posted, also update this page's overview/status table (if one exists) to reflect REW-52 as shipped, alongside the existing REW-9/REW-10/REW-46 entries.*
