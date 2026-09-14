## Jira issue

[REW-76 — Add Recipe to Meal Plan During Add/Import Workflow](https://wanderingnerds.atlassian.net/browse/REW-76)

## Confluence page

[REW-76: Add Recipe to Existing Meal Plan During Create/Import - Feature Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28704769/REW-76+Add+Recipe+to+Existing+Meal+Plan+During+Create+Import+-+Feature+Plan)

[Release: REW-76 - Add Recipe to Meal Plan During Add/Import Workflow](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28803074/Release+REW-76+-+Add+Recipe+to+Meal+Plan+During+Add+Import+Workflow)

## Summary

Add an optional existing-meal-plan selector to both manual recipe creation and recipe import. After the recipe is successfully saved, the server will add its new ID to the selected, user-owned meal plan through the existing `meal_plan_recipes` membership model. This reduces clicks without changing meal-plan creation, date ranges, schema, display, ordering, or any existing meal-plan workflow; recipe saving remains successful if the optional membership write fails.

## Final implementation status

Implemented and approved in review. Both recipe-creation paths now load the authenticated user's meal plans, offer a single optional selector with date-range context, and attempt assignment only after the recipe has been saved. The shared `assignRecipeToMealPlan` helper validates UUID input, confirms ownership, and performs an idempotent upsert into `meal_plan_recipes`. A missing selection is skipped; malformed, stale, foreign, lookup-failing, or write-failing selections return a non-fatal failure so the saved recipe remains available and the user sees a partial-success warning.

The import save response includes a structured `mealPlanAssignment` result. Import success and warning messages are stored as flash messages before the browser returns to `/recipes`, aligning the import and manual-create user experience.

Review completed with **APPROVED** and no remaining findings.

## Open questions / assumptions

- The user's corrected scope is authoritative where the Jira description mentions choosing a scheduled date/day: current meal-plan membership has no per-recipe scheduled-day field, and this ticket must not add one. The selector identifies one existing plan only; the plan's existing start/end dates may be shown as context but are not edited.
- The selection is optional and limited to one plan. An empty selection means save/import exactly as today.
- Only plans owned by the authenticated user are offered and accepted. A missing, malformed, stale, or foreign plan ID must never prevent recipe creation; it produces a partial-success warning after the recipe is saved.
- No inline meal-plan creation is included. When the user has no plans, the form should explain that none exist and may link to the existing `/meal-plans/new` page without interrupting recipe entry.
- For manual creation, use flash messaging and the existing redirect to `/recipes`. For import, return `success: true` with a distinct optional assignment result/message and let `public/js/import.js` redirect as it does today. Do not report the recipe save as failed after its insert succeeds.

## Tasks

1. Extract or add a small shared server-side helper for this workflow that validates an optional meal-plan UUID, verifies the plan belongs to the authenticated user, and idempotently inserts `{ meal_plan_id, recipe_id }` using the existing composite-key upsert behavior. Return a structured success/skipped/failure result so both creation paths handle partial success consistently; do not call the application's own JSON API over HTTP.
2. Update `GET /recipes/new` to fetch the current user's existing meal plans with the request-scoped Supabase client, ordered consistently with the meal-plan feature, and pass a safe empty list if none exist. Add an optional single-select control to the manual form, including plan title and existing date range for identification.
3. Update `POST /recipes` to accept the optional plan ID. Preserve the existing recipe insert, image, category, tag, status, and redirect behavior. Only after the recipe exists, invoke the shared membership helper; append a success detail when assignment succeeds or an explicit warning when it fails, while retaining the saved recipe and redirecting to `/recipes`.
4. Update `GET /recipes/import` to fetch and render the same owner-scoped list. Add the optional selector to the review/save portion of the import form and include its value in the JSON payload sent by `public/js/import.js`.
5. Update `POST /recipes/import/save` to accept the optional plan ID and, only after the recipe insert succeeds, run the same membership helper. Keep the HTTP response successful when assignment fails, returning enough structured information for the browser to communicate full versus partial success accurately.
6. Add focused automated coverage for optional omission, successful assignment, malformed/foreign/stale plan IDs, duplicate-safe assignment, and membership-insert failure in both manual and import save flows. Verify that every failure after recipe insertion still reports/preserves recipe success, and add view/client assertions for the selector and import payload.
7. Run focused tests, the complete `npm test` suite, and `git diff --check`. Manually verify manual draft/publish and imported draft/publish with no plans, no selection, a valid selection, and a simulated assignment failure.

## Affected files

- `src/routes/recipeRoutes.js` — load owner-scoped meal plans for the new-recipe form and perform optional post-save assignment without changing recipe creation semantics.
- `src/routes/importRoutes.js` — load owner-scoped meal plans for import and perform the same optional post-insert assignment in the JSON save route.
- `src/utils/mealPlanAssignment.js` — recommended shared ownership-validation and idempotent membership helper for both recipe workflows.
- `src/utils/mealPlanAssignment.test.js` — focused unit coverage for omitted/invalid/foreign plan IDs, successful and duplicate-safe upserts, and database failure results.
- `views/recipes/new.ejs` — optional existing-meal-plan selector and no-plans guidance on manual creation.
- `views/recipes/import.ejs` — matching optional selector in the import review form.
- `public/js/import.js` — include the selected plan ID in the save payload and preserve full/partial-success messaging during redirect.
- `src/routes/recipeRoutes.test.js` — recommended request-level coverage for manual-create assignment and partial-success behavior (new if route coverage is introduced).
- `src/routes/importRoutes.test.js` — recommended request-level coverage for import-save assignment and partial-success JSON behavior (new if route coverage is introduced).
- `src/views/recipeCreateMealPlan.test.js` — recommended lightweight rendered-template/client contract coverage if the repository's view-source test style is preferable to a browser harness.

### Files actually changed

- `src/utils/mealPlanAssignment.js` — added the shared validation, ownership lookup, and duplicate-safe membership upsert helper.
- `src/routes/recipeRoutes.js` — loads plans for manual creation and performs optional post-save assignment with flash feedback.
- `src/routes/importRoutes.js` — loads plans for import and returns the structured assignment result after save.
- `views/recipes/new.ejs` and `views/recipes/import.ejs` — added the optional selector and no-plans guidance.
- `public/js/import.js` — sends the selected plan ID and redirects through the standard flash-message path.
- `src/utils/mealPlanAssignment.test.js` — covers skipped, invalid, foreign/stale, successful/idempotent, database-error, and exception outcomes.
- `src/routes/recipeMealPlanRoutes.test.js` — covers both manual and import route behavior, including preserved recipe success and partial-success warnings.
- `src/views/recipeCreateMealPlan.test.js` — covers selector markup, no-plans links, import payload, and redirect behavior.

## Database changes

No migration, table, column, index, trigger, or RLS change is needed. Continue using the existing `meal_plans` and `meal_plan_recipes` tables, composite `(meal_plan_id, recipe_id)` key, and owner/recipe-visibility RLS policies. Do not add a planned date/day field or alter `planned_servings`.

## API changes

- `POST /recipes` accepts an optional `mealPlanId` form field. The existing redirect contract remains unchanged.
- `POST /recipes/import/save` accepts an optional `mealPlanId` JSON field and returns `mealPlanAssignment` with `status` of `skipped`, `assigned`, or `failed`; assigned results also include `mealPlanTitle`.
- Assignment failure after recipe persistence is intentionally not an HTTP recipe-save failure.

## Deployment and configuration

No new environment variables, dependencies, migrations, or manual deployment steps are required.

## Validation and QA record

- Focused REW-76 automated suite: **20/20 passed**.
- Complete `npm test`: **205 total, 203 passed, 0 failed, 2 skipped**. The two skips are limited to tests that require local HTTP listeners, which the sandbox forbids.
- `git diff --check`: **passed**.
- Reviewer result: **APPROVED**, with no remaining findings.
- Manual authenticated browser and live-database QA: **not performed**. Draft/publish behavior against a real account and confirmation on the live meal-plan detail page remain manual follow-up checks.

## Security considerations

- Require the existing authenticated recipe/import routes and use `createSupabaseClient(req.accessToken)` so all reads and membership writes remain RLS-enforced.
- Treat the submitted plan ID as untrusted: accept only an empty value or a valid UUID, and explicitly scope plan lookup to `.eq("user_id", req.user.id)` before inserting membership. Return the same failure behavior for nonexistent and foreign plan IDs so ownership is not leaked.
- Derive `recipe_id` only from the newly inserted recipe row; never accept it from the client in these workflows.
- Keep the membership upsert idempotent with the existing composite conflict target. Do not modify, delete, or re-date a selected plan.
- Preserve existing CSRF handling on the multipart manual form and JSON import requests. The global CSRF limitation remains pre-existing and outside this ticket.
- Avoid logging recipe/form contents or plan details on assignment errors; log safe operational context and show a generic partial-success warning.
- The assignment is intentionally non-transactional per product requirement: recipe durability takes priority, and a membership failure must not roll back or delete the new recipe.

## Acceptance criteria

- [x] The manual Add New Recipe form and the import review form each show an optional selector populated from an owner-scoped query.
- [x] Each selector allows at most one plan, defaults to no selection, and does not offer or create a new meal plan inline.
- [x] A user with no meal plans can still save/import normally and sees no-plans guidance with a link to meal-plan creation.
- [x] Saving manually with no plan selected skips membership work and preserves existing recipe creation behavior.
- [x] Importing with no plan selected skips membership work and preserves existing recipe creation behavior.
- [x] With a valid plan selected, manual creation saves the recipe and performs one duplicate-safe membership upsert.
- [x] With a valid plan selected, import saves the recipe and performs one duplicate-safe membership upsert.
- [ ] Confirm through authenticated live-database QA that the existing meal-plan detail page shows the assigned recipe without another action.
- [x] Malformed, stale, nonexistent, or foreign plan IDs fail assignment without disclosing plan existence.
- [x] Validation or membership insertion failure after recipe creation/import preserves recipe success and produces a partial-success warning.
- [x] Existing recipe processing and meal-plan workflows were left unchanged; the complete automated suite had no failures.
- [x] No database migration or change to scheduling, date ranges, `planned_servings`, meal-plan display, or sorting was introduced.
- [x] Focused tests, the complete available test suite, and `git diff --check` passed; the manual QA gap is recorded above.
