# Jira Comment for REW-77

REW-77 is implemented, final-review approved, and documented. Recipe imports now require Cook Time for both draft and publish actions, provide accessible inline feedback and focus when the value is missing, clear that state on valid input, and reject missing/empty/whitespace Cook Time server-side before Supabase access. Valid values are trimmed before persistence; Prep Time remains optional for imports.

The REW-79 native-validation blocker is resolved and Done. Targeted REW-77 tests passed 7/7. Full `npm test` completed 192 tests: 190 passed, 0 failed, and 2 existing CSRF integration tests skipped because the sandbox forbids local listeners. `git diff --check` passed. Automated acceptance criteria passed. An authenticated browser smoke remains recommended and was not performed.

- Plan: https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28573697/REW-77+Require+Cook+Time+During+Recipe+Import+-+Bug+Fix+Plan
- Release notes: https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28573728/Release+REW-77+-+Require+Cook+Time+During+Recipe+Import
