## Jira issue

[REW-67 — Add “Add to Meal Plan” Action to Recipe Cards](https://wanderingnerds.atlassian.net/browse/REW-67)

## Confluence page

[REW-67 — Add “Add to Meal Plan” Action to Recipe Cards — Implementation Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28737545/REW-67+Add+Add+to+Meal+Plan+Action+to+Recipe+Cards+Implementation+Plan)

## Summary

Complete and standardize the existing card-level “+ Meal Plan” experience so a user can add a recipe to an existing plan, or create a plan and immediately add the recipe, without leaving the current recipe list. The meal-plan modal, browser script, JSON API, shared public/search cards, and individual-recipe controls already exist from REW-63; this ticket should reuse them. The implementation gap is consistency: the Liked Recipes page still carries a hand-built card with no meal-plan action, and the shared My Recipes card omits the action on its private variant. The change should consolidate Liked Recipes onto the appropriate shared card and expose the same delegated modal trigger on every supported recipe-card surface while preserving each surface’s current links, favorites, edit/delete controls, and the existing recipe-detail action.

## Open questions / assumptions

- “Standard recipe card” includes the card partials used by Search, Browse, and My Recipes, plus the recipe-card markup on Liked Recipes and cookbook detail pages. Liked Recipes should reuse `recipe-card.ejs`; cookbook detail should retain its cookbook-specific Remove form while gaining the shared meal-plan trigger.
- Authenticated users open the existing in-page modal. Guests retain the existing login-prompt behavior; choosing to log in may navigate to login, but merely activating the card action must not navigate away.
- Creating a plan is consistent with the established REW-63 modal workflow, so the existing inline title/start-date/end-date form remains available and automatically adds the selected recipe after creation.
- The current API supports add/remove membership toggling. Retaining “Remove” for plans that already contain the recipe is expected and avoids regressing the existing individual-recipe workflow.
- No new server route or data fetch is expected because delegated client-side handling reads the recipe ID from each card and loads membership on demand.

## Tasks

1. Update the private branch of `recipe-summary-card.ejs` so My Recipes cards include the same authenticated “+ Meal Plan” trigger as other supported card surfaces, alongside the existing View/Edit/Delete actions without nesting interactive controls or breaking narrow layouts.
2. Replace the duplicated card markup in `views/recipes/liked.ejs` with the shared `recipe-card.ejs` partial (or the project-selected standard public-card partial), preserving the page heading, empty state, recipe count, public recipe links, metadata, and author display while gaining the common meal-plan action and guest/authenticated behavior.
3. Keep `recipe-card.ejs`, the shared modal in `views/layouts/main.ejs`, `public/js/meal-plans.js`, and `src/routes/mealPlanApiRoutes.js` as the canonical integration. Change them only if implementation/testing reveals an accessibility, state, or error-handling defect required by REW-67; do not create a second modal or API path.
4. Expand render tests to assert that Search, Browse, My Recipes, Liked Recipes, and cookbook detail each render one meal-plan trigger per recipe with the correct `data-recipe-id`; authenticated triggers open the shared flow and guest triggers use the login-prompt class. Preserve existing assertions for private favorite/edit/delete controls, public-card navigation, and cookbook View/Remove form protections.
5. Add focused client-side coverage if feasible in the repository’s current test setup; otherwise perform browser acceptance checks for modal opening, existing-plan add/remove, inline create-and-add, error states, repeated use across multiple cards, keyboard dismissal, and no list-page navigation.
6. Run the full Node test suite and acceptance checks at desktop and narrow/mobile widths, recording any live Supabase/RLS validation that cannot be performed locally as pending rather than inferred.

## Affected files

- `views/partials/recipe-summary-card.ejs` — add the meal-plan trigger to the private/My Recipes action area while retaining all current actions.
- `views/recipes/liked.ejs` — remove duplicated recipe-card markup and render the shared card partial so the action stays consistent.
- `src/views/recipeCard.test.js` — extend shared-card/page render coverage for authenticated and guest meal-plan controls, recipe IDs, and preserved private actions.
- `views/cookbooks/view.ejs` — add the authenticated delegated trigger to cookbook recipe cards while preserving View, Remove, CSRF, `returnTo`, and confirmation behavior.
- `views/partials/recipe-card.ejs` — expected to remain the canonical Search/Liked card; modify only if a small shared-interface or accessibility adjustment is necessary.
- `public/css/styles.css` — expected to require no change because `.recipe-card-actions` and `.meal-plan-add-btn` styles already exist; adjust only if QA exposes action wrapping or focus/layout regressions.
- `public/js/meal-plans.js` — expected to remain unchanged; add or adjust behavior only if focused tests uncover a ticket-blocking issue in the existing delegated modal workflow.
- `views/partials/meal-plan-modal.ejs` and `src/routes/mealPlanApiRoutes.js` — existing workflow dependencies, not expected implementation targets unless acceptance testing finds a regression.

## Database changes

No migration, table, column, index, or RLS policy change is needed. REW-63 already supplies `meal_plans`, `meal_plan_recipes`, ownership policies, recipe-visibility enforcement, and the API used by the modal. Staging acceptance should still verify that an authenticated user can add their own recipe or another user’s published recipe, cannot add an inaccessible draft recipe, and cannot mutate another user’s plan.

## Security considerations

- Preserve `requireApiAuth`, UUID validation, owned-plan checks, recipe visibility checks, per-user rate limiting, and Supabase RLS in `mealPlanApiRoutes.js`; card markup must never be treated as authorization.
- Render recipe IDs through EJS attributes and keep all user-controlled text in escaped `<%= %>` expressions.
- Preserve the existing CSRF limitation documented for the fetch-based API: repository-wide CSRF protection is currently disabled. REW-67 should not claim to resolve it, but review must ensure this change does not introduce a new mutation path.
- Do not place buttons/forms inside recipe links. The meal-plan button must remain `type="button"`, and the private delete form/token/confirmation must remain intact.
- Ensure guests cannot accidentally call authenticated endpoints from the card; the guest class should continue to route through the login prompt, while the API still returns JSON 401 as defense in depth.
- Verify modal focus/keyboard behavior and status/error messaging. The existing modal lacks a full focus trap/return-focus implementation; treat any accessibility remediation beyond making the new card triggers operable as a separately scoped follow-up unless it blocks acceptance.

## Acceptance criteria

- [x] Search, Browse, My Recipes, Liked Recipes, and cookbook detail display an “Add to Meal Plan” action on every supported recipe card without requiring the recipe detail page to be opened.
- [ ] Each card action targets that card’s recipe ID, opens the existing modal in place for an authenticated user, and does not change the current page URL or lose list/filter/pagination state.
- [ ] The modal lists only the signed-in user’s existing meal plans and accurately indicates whether the selected recipe is already in each plan.
- [ ] Selecting Add places the recipe in the chosen plan; selecting Remove removes only that membership; success is reflected in the open modal without a full-page reload.
- [ ] A user can create a valid new meal plan in the modal and the selected recipe is immediately added to it; invalid title/date input is rejected without navigating away.
- [x] A guest card action follows the established login prompt behavior and does not attempt a meal-plan mutation before authentication (render tests and source inspection; live browser prompt remains pending).
- [x] My Recipes cards retain View, Edit, Delete, CSRF hidden field, delete confirmation, favorite state, filters, draft/published status, and private recipe links.
- [x] Browse, Search, and Liked cards retain their public recipe links and existing metadata; consolidating Liked Recipes does not change its heading, empty state, count, or recipe ordering.
- [x] Existing “Add to Meal Plan” actions on individual private and public recipe pages remain present and functional by source inspection and existing tests.
- [ ] Authorization remains enforced server-side: users cannot read or mutate another user’s meal plans and cannot add an inaccessible recipe, including another user’s draft.
- [ ] Card controls remain keyboard-operable, have an accessible name, and do not overlap or clip at narrow/mobile and desktop widths.
- [ ] Automated render tests and the full `npm test` suite pass; browser acceptance results and any unavailable live Supabase checks are recorded explicitly.

## As-shipped update

Implementation, review, and source-level acceptance are complete on branch `REW-67-add-meal-plan-action-to-recipe-cards`.

- `views/partials/recipe-summary-card.ejs` now renders the existing delegated meal-plan trigger in the private/My Recipes action group and allows the action row to wrap.
- `views/recipes/liked.ejs` now renders the canonical public `recipe-card.ejs` partial instead of maintaining duplicate card markup.
- `views/cookbooks/view.ejs` now renders the authenticated delegated trigger on every cookbook recipe card, with wrapping actions and preserved View/Remove/CSRF/`returnTo`/confirmation behavior.
- `src/views/recipeCard.test.js` now covers one correctly targeted meal-plan trigger per Search, Browse, My Recipes, Liked Recipes, and cookbook recipe card, including authenticated/guest behavior and preserved page/card controls.
- The existing modal, browser script, API routes, public card partial, stylesheets, and database schema did not require changes.

### Validation status

- Passed: focused render tests, 9/9.
- Passed: final full suite, 234 total: 232 passed, 2 sandbox-only HTTP-listener skips, 0 failed; re-review approved with no findings.
- Passed: JavaScript syntax and diff-whitespace checks.
- Pending: live authenticated add/remove and inline create-and-add against Supabase/RLS.
- Pending: cross-account plan ownership and inaccessible-draft enforcement against live RLS.
- Pending: browser URL/list-state preservation, focus/keyboard dismissal, and desktop/mobile wrapping or clipping checks.

No database, API, configuration, dependency, architecture, or deployment changes shipped. Detailed evidence is recorded in `docs/qa/rew-67-add-meal-plan-action-to-recipe-cards.md`.
