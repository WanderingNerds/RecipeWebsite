# Jira Comment for REW-52

*POSTED — this comment was added to REW-52 (comment id 10134) and the issue was transitioned to Done by the orchestrating session, which had working Atlassian Rovo MCP access even though this documentation subagent did not. The Confluence page was also updated with the "REW-52: Required Prep Time / Total Time" section (page 10485762, version 5). This file is retained as a record of the drafted content.*

---

## Documentation Complete — Reviewed and Merged to Branch (QA skipped this run)

Prep Time and Total Time are now required fields on the recipe create/edit forms. This has been implemented, code-reviewed (approved, no blocking issues), and documented. Note: this pipeline run explicitly excluded the QA stage by operator instruction, so this is **not** a QA-verified sign-off — treat it as reviewed/merged-to-branch, pending a QA pass if one is still required before production release.

**What changed:**
- `views/recipes/new.ejs` and `views/recipes/edit.ejs`: Prep Time and Total Time now show a red `*`; blank submission is blocked client-side with an inline red-border/"Required" message per field (`public/js/recipe-form.js`, `public/css/styles.css`), clearing live as each field is filled in.
- `src/routes/recipeRoutes.js`: `POST /recipes` and `POST /recipes/:id/update` now reject blank `prepTime`/`cookTime` server-side, as defense-in-depth alongside the existing Title/Instructions check.
- Applies uniformly to "Save as draft" and "Publish recipe" — no draft exemption.

**Naming decision — "Cook Time" relabeled to "Total Time", no migration:** the app never had a real "Total Time" concept — only `prep_time`/`cook_time` exist anywhere in the schema, routes, or views. Rather than add a new `total_time` column, this change relabels the existing Cook Time field to display as "Total Time" on the create/edit forms only. The underlying `name="cookTime"` field and `cook_time` database column are unchanged, avoiding a migration and avoiding rewrites of every other read site. Both templates carry an inline comment flagging this so a future edit doesn't "helpfully" rename it.

**Known non-blocking follow-ups (flagged by Reviewer, not fixed in this pass):**
1. Both forms' helper text ("Only a title and instructions are required...") is now stale since Prep Time/Total Time are also required — copy nit, not fixed here.
2. `views/recipes/view.ejs` and `views/recipes/public-view.ejs` still display this field as "Cook Time" even though the create/edit forms now call it "Total Time" — a naming inconsistency worth a fast-follow ticket.

**Explicitly out of scope:** the Import Recipe flow (`views/recipes/import.ejs`, `public/js/import.js`, `src/routes/importRoutes.js`) is untouched and can still save a recipe with blank Prep/Cook time.

**Testing:**
Manual verification per the plan's acceptance criteria (blank/partial/filled submissions on both forms, live per-field error clearing, draft vs. publish, server-side bypass via direct POST). `npm test` run as a regression smoke check. Reviewer approved with no blocking issues. **No QA verification was performed this run (excluded by operator instruction).**

**Documentation updated:**
- `docs/api/recipe-required-times.md` (new) — full behavior/request-response documentation.
- `docs/api/README.md` — endpoint table and detailed-docs list updated.
- `database/README.md` — note added on the required-field enforcement and the display-only Total Time rename.
- `README.md` — feature bullet added under Recipe Management.
- `docs/RELEASE_NOTES_REW-52.md` — full release notes.
- Confluence: [REW-9, REW-10 & REW-46: Manual Recipe Entry, Recipe Search, and Recipe Author Default](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/10485762/REW-9+REW-10+REW-46+Manual+Recipe+Entry+Recipe+Search+and+Recipe+Author+Default) — **drafted, not yet posted; Confluence write access was unavailable this session.** Section content is ready in `docs/confluence/REW-52-required-prep-total-time.md` for the next agent/human with Atlassian access to paste in.

**Deployment:**
No special configuration required. No migrations, no new environment variables, no security middleware changes.

---
