# REW-77: Require Cook Time During Recipe Import

**Status:** Implemented; final review approved; automated acceptance passed  
**Jira:** [REW-77](https://wanderingnerds.atlassian.net/browse/REW-77)  
**Plan:** [REW-77 Bug Fix Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28573697/REW-77+Require+Cook+Time+During+Recipe+Import+-+Bug+Fix+Plan)

## What shipped

The recipe import review form now requires Cook Time for both draft and publish actions. Missing parsed Cook Time does not prevent preview; instead, preview displays the accessible inline `Required` state and focuses the field. Blank and whitespace-only submissions are blocked, and valid input clears the error live.

`POST /recipes/import/save` independently enforces the requirement before Supabase client creation, duplicate-title lookup, or insertion. Invalid requests return HTTP 400 with `Cook Time is required`; valid values are trimmed before storage.

## Decisions and compatibility

- The import field remains labeled “Cook Time” to match REW-77 and the existing import UI.
- Prep Time remains optional for imports.
- The requirement applies equally to Save as Draft and Publish Recipe.
- Native `required` semantics are retained, with a captured `invalid` event ensuring both save actions expose the custom inline state.
- `recipes.cook_time` remains nullable `TEXT`; no migration or historical-row backfill was introduced.
- Existing authentication, JSON CSRF, import parsing, source URL sanitization, duplicate-title, and ownership behavior is unchanged.

## Review and testing

The first review identified REW-79: native constraint validation could prevent the custom submit handler from revealing the inline state. The final implementation captures the non-bubbling `invalid` event and adds behavior-level route and DOM coverage. Re-review approved with no remaining findings.

- Targeted REW-77 tests: 7 passed, 0 failed, 0 skipped.
- Full `npm test`: 192 total, 190 passed, 0 failed, 2 skipped because the sandbox forbids local listeners required by existing CSRF integration tests.
- `git diff --check`: passed.
- Authenticated browser smoke: recommended, not performed in this environment.

## Deployment

No migration, environment variable, dependency, or Vercel change is required.
