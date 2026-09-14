## Jira issue
[REW-77 — Require Cook Time During Recipe Import](https://wanderingnerds.atlassian.net/browse/REW-77) (Bug, Medium priority, To Do at planning time)

## Confluence page
[REW-77: Require Cook Time During Recipe Import - Bug Fix Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28573697/REW-77+Require+Cook+Time+During+Recipe+Import+-+Bug+Fix+Plan) (child of the Recipe space's Bug Fixes page)

## As-shipped status

Implemented on `REW-77-require-cook-time-during-recipe-import`, approved on re-review after the REW-79 native-validation blocker was fixed, and passed automated acceptance on 2026-09-13. The delivered implementation follows the scope below, with one review-driven addition: the import form captures Cook Time's non-bubbling native `invalid` event so both save actions reveal the same custom inline error before the intercepted submit handler runs.

Targeted REW-77 tests passed 7/7. The full suite completed 192 tests: 190 passed, 0 failed, and 2 existing CSRF integration tests were skipped because the sandbox forbids local HTTP listeners. `git diff --check` passed. An authenticated browser smoke test remains recommended and was not performed.

## Summary
The import review flow currently presents Cook Time as optional and the import save endpoint converts a blank value to `null`, even though the manual create/edit workflow already treats the same underlying `cookTime`/`cook_time` value as required. Update the import form and its client-side save validation to give a clear, accessible inline prompt, and add authoritative server-side validation so neither draft nor publish actions can persist a blank or missing Cook Time.

## Open questions / assumptions
- Jira explicitly calls the import field **Cook Time**, while the manual create/edit form displays the same field as **Total Time** after REW-52. Keep the import label as “Cook Time” to match REW-77 and the existing import UI; match the edit workflow's required marker, inline `Required` state, whitespace handling, focus behavior, and server-side enforcement rather than copying its display label.
- Apply the requirement to both “Save as Draft” and “Publish Recipe.” The Jira wording says a recipe cannot be saved blank and gives no draft exemption.
- A missing parsed Cook Time should not block the preview from opening. The review screen is where the user is prompted to supply it before saving, preserving the existing opportunity to repair incomplete extraction.
- Prep Time remains optional in the import flow; REW-77 only requires Cook Time. Title and Instructions behavior remains unchanged.
- The import endpoint currently relies on the application-wide JSON CSRF protection configured in `src/app.js`; keep that behavior unchanged.

## Tasks
1. [x] Update the Cook Time group in `views/recipes/import.ejs` to mirror the edit form's required-field semantics: add the visible required marker, `required`, `aria-required`, and `aria-describedby` attributes, and an adjacent hidden `field-error-message` with a unique ID. Reuse the existing `.form-group.has-error` and `.field-error-message` styles rather than adding ticket-specific CSS.
2. [x] Extend `public/js/import.js` with a small Cook Time error-state helper consistent with `public/js/recipe-form.js`. When parsed data has no Cook Time, show the inline error as soon as the review preview is displayed and focus Cook Time (instead of Title) so the user is clearly prompted. On save, reject whitespace-only Cook Time before disabling buttons or calling `/recipes/import/save`; set `aria-invalid`, show the inline error, and focus the field. Clear its error state as soon as the user enters a non-whitespace value. Keep native `required` as progressive enhancement, but do not rely on it as the sole control because the form submission is intercepted in JavaScript. Capture the native `invalid` event so blank submissions from either button use the custom inline state.
3. [x] Add the authoritative check to `POST /recipes/import/save` in `src/routes/importRoutes.js` before creating a Supabase client or performing the duplicate-title query. Treat missing, empty, and whitespace-only `cookTime` as invalid and return HTTP 400 JSON with the field-specific message `Cook Time is required`. Keep the existing trim-to-column mapping after validation.
4. [x] Add targeted regression tests. Coverage executes the save handler through a narrow dependency-injection seam and uses a DOM harness for client behavior. It verifies missing, empty, and whitespace-only rejection before client creation; trimmed draft/publish persistence; required/accessibility markup; both submitters' invalid paths; focus; and live error clearing.
5. [x] Run targeted tests, the full `npm test` suite, and `git diff --check`. Automated acceptance passed. Manual authenticated browser exercise was unavailable in this environment and remains recommended before deployment.

## Affected files
- `views/recipes/import.ejs` — mark Cook Time required and add accessible inline error markup matching Edit Recipe.
- `public/js/import.js` — surface missing parsed Cook Time, prevent blank submission, focus the field, and clear its error state on valid input.
- `src/routes/importRoutes.js` — reject missing/blank Cook Time before any database work; expose only a minimal validation seam if needed for unit testing.
- `src/routes/importRoutes.test.js` (new, or the repository's closest equivalent targeted test) — verify server-side required Cook Time validation and valid-value acceptance.
- `src/views/importRecipe.test.js` (new, or the closest existing view/source test location) — verify required/accessibility markup and client validation contract.
- `database/README.md` — update the current REW-52 note that explicitly says imports may save blank times; state that REW-77 now requires `cook_time` for imports while `prep_time` remains optional there.

## Database changes
No migration is needed. `recipes.cook_time` already exists as nullable `TEXT`; this ticket adds application-layer enforcement for new import saves. Retaining nullability avoids an unrelated backfill and preserves compatibility with historical rows. No table, column, index, trigger, or RLS policy changes are required.

## Security considerations
- Client validation is only UX. The route-level whitespace-aware check must execute before duplicate lookup or insert so direct requests cannot bypass the requirement or perform unnecessary database work.
- Preserve `requireAuth` and the existing global JSON CSRF handling for `/recipes/import/save`; do not add or weaken an exception.
- Continue trimming the value before persistence. EJS escapes rendered content, and the change introduces no new HTML injection surface.
- File upload parsing, MIME/magic-number validation, the import rate limiter, URL sanitization, and ownership (`user_id` from the authenticated user) remain unchanged.

## Acceptance criteria
- [x] The import review form visibly marks Cook Time as required and exposes an accessible inline `Required` message tied to the input.
- [x] If parsing produces no Cook Time, the review screen opens, clearly shows the Cook Time error, and focuses the Cook Time input so the user can repair it.
- [x] “Save as Draft” and “Publish Recipe” make no save request while Cook Time is missing, empty, or whitespace-only; the inline error remains visible and the field receives focus.
- [x] Entering a non-whitespace Cook Time clears the field's error styling/message and updates `aria-invalid` without requiring another submit.
- [x] With a valid Cook Time, both draft and publish imports save normally and persist the trimmed value in `recipes.cook_time`.
- [x] A direct authenticated, CSRF-valid `POST /recipes/import/save` with omitted, empty, or whitespace-only `cookTime` returns HTTP 400 with `Cook Time is required` before database client creation.
- [x] Existing Title, Instructions, duplicate-title, source URL, author-default, and parsing behavior is unchanged by the scoped diff.
- [x] No database migration is introduced; historical nullable Cook Time rows are unaffected.
- [x] Targeted tests pass and the full `npm test` suite has no failures. Two existing listener-dependent tests were skipped by the sandbox.
