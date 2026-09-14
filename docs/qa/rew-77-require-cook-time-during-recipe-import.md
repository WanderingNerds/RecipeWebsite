# REW-77 Acceptance / QA Report

## Scope

Validated the acceptance criteria for [REW-77](https://wanderingnerds.atlassian.net/browse/REW-77) on branch `REW-77-require-cook-time-during-recipe-import`.

## Result

PASS for automated acceptance coverage.

- Imported Cook Time is marked required and is associated with an accessible inline error.
- Omitted, empty, and whitespace-only Cook Time values are rejected before any Supabase access.
- Both Save as Draft and Publish expose and focus the Cook Time error when native validation fails.
- Entering a non-whitespace Cook Time clears the inline error state.
- Both draft and publish persistence paths trim and save valid Cook Time values.
- Validation behavior matches the existing required-field pattern used by the recipe form.

## Commands and results

- `git diff --check`: passed.
- `node --test src/routes/importRoutes.test.js src/views/importRecipe.test.js`: 7 passed, 0 failed, 0 skipped.
- `npm test`: 192 total, 190 passed, 0 failed, 2 skipped.

The two skipped tests are unrelated existing CSRF integration tests that require local HTTP listeners, which the current sandbox forbids.

## Remaining manual check

An authenticated browser smoke test of the complete import UI remains recommended before deployment because this environment does not provide an authenticated browser session. Automated DOM behavior and route-handler coverage passed for every REW-77 acceptance path.
