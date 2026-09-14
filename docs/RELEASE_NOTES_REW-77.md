# Release Notes: REW-77 - Require Cook Time During Recipe Import

**Date:** 2026-09-13  
**Jira:** [REW-77](https://wanderingnerds.atlassian.net/browse/REW-77)  
**Branch:** `REW-77-require-cook-time-during-recipe-import`

Recipe imports now require Cook Time for both Save as Draft and Publish Recipe. When parsing does not supply a value, the review screen visibly marks the field, exposes an accessible inline `Required` message, and focuses Cook Time so the user can repair the import.

Blank and whitespace-only values are blocked in the browser. Entering a non-whitespace value clears the inline error state immediately. The save route independently rejects omitted, empty, or whitespace-only Cook Time with HTTP 400 and `Cook Time is required` before creating a Supabase client or performing recipe queries. Accepted values are trimmed before persistence.

Prep Time remains optional for imports. The import label remains “Cook Time,” and existing Title, Instructions, duplicate-title, source URL, author-default, parsing, authentication, and JSON CSRF behavior are unchanged.

No migration, dependency, environment variable, or deployment configuration change is required. `recipes.cook_time` remains nullable for historical compatibility; the requirement is application-layer enforcement for new imports.

Final re-review approved the implementation with no remaining findings after REW-79 corrected the native-validation event path and strengthened behavior-level coverage. Targeted REW-77 tests passed 7/7; the full suite completed 192 tests with 190 passed, 0 failed, and 2 existing listener-dependent CSRF tests skipped because the sandbox forbids local listeners. `git diff --check` passed. An authenticated browser smoke test remains recommended before deployment and was not performed.
