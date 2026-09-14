## Jira issue

[REW-83 — Remove Redundant View Button from All Recipe Cards](https://wanderingnerds.atlassian.net/browse/REW-83)

## Confluence page

[REW-83: Remove Redundant View Button from Recipe Cards — Implementation Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28409913/REW-83+Remove+Redundant+View+Button+from+Recipe+Cards+Implementation+Plan)

## Summary

Remove the redundant **View** action from every recipe-card surface while preserving clickable recipe titles, all page-specific actions (including the newly added REW-67 meal-plan actions), and consistent card sizing/alignment.

## Open questions / assumptions

- Per the clarified ticket scope, cookbook and meal-plan index card View actions are also redundant because their titles already link to the corresponding detail pages; remove those actions as well.
- Existing title destinations are authoritative: public recipe cards use `/r/:id`; authenticated personal and organization-detail recipe cards use `/recipes/:id`.
- Search and Liked Recipes use `views/partials/recipe-card.ejs`; Browse and My Recipes use `views/partials/recipe-summary-card.ejs`.
- No route, database, authentication, API, or JavaScript behavior change is required.
- Existing flex/wrap rules should continue to size the remaining controls. Change CSS only if focused responsive validation exposes whitespace, width, or alignment regressions.

## Tasks

1. Remove the private-card **View** link from `views/partials/recipe-summary-card.ejs`. Preserve the REW-67 Add to Meal Plan trigger, Favorite, Edit, Delete, filters, and the public branch.
2. Remove the recipe **View** link from `views/cookbooks/view.ejs`. Preserve the REW-67 Add to Meal Plan trigger, title navigation, and CSRF-protected Remove action.
3. Remove the recipe **View** link from `views/meal-plans/view.ejs`. Preserve title navigation and the CSRF-protected Remove action.
4. Remove the **View** links from `views/cookbooks/index.ejs` and `views/meal-plans/index.ejs`. Preserve title navigation and Rename/Edit actions.
5. Extend `src/views/recipeCard.test.js` to assert that every applicable rendered card surface has no View action; titles use the correct detail URL; and all remaining controls/forms remain present.
6. Keep the existing standardized grid/action layout. Adjust `public/css/styles.css` only if browser validation demonstrates a regression.
7. Run focused view tests, then the full Node test suite. Perform responsive acceptance checks on every card destination.

## Affected files

- `views/partials/recipe-summary-card.ejs` — remove private recipe View; retain Add to Meal Plan, Favorite, Edit, and CSRF-protected Delete.
- `views/cookbooks/view.ejs` — remove recipe View; retain Add to Meal Plan and CSRF-protected Remove.
- `views/meal-plans/view.ejs` — remove recipe View; retain CSRF-protected Remove.
- `views/cookbooks/index.ejs` — remove cookbook View; retain title navigation and Rename.
- `views/meal-plans/index.ejs` — remove meal-plan View; retain title navigation and Edit.
- `src/views/recipeCard.test.js` — update the existing REW-67 cookbook assertion, strengthen private-card assertions, and add meal-plan-detail coverage for no View, title href, and preserved actions.
- `public/css/styles.css` — validation-only/conditional; existing `.recipe-card-actions`, `.recipe-summary-actions`, flex, and wrapping contracts should remain unless visual QA finds a defect.

Recipe-card surface map:

- Browse (`views/recipes/browse.ejs` → public summary partial): already no View; title `/r/:id`; Add to Meal Plan retained.
- My Recipes (`views/recipes/index.ejs` → private summary partial): remove View; title `/recipes/:id`; retain Add to Meal Plan, Favorite, Edit, Delete.
- Search (`views/recipes/search.ejs` → recipe-card partial): already no View; title `/r/:id`; Add to Meal Plan retained.
- Liked Recipes (`views/recipes/liked.ejs` → recipe-card partial after REW-67): already no View; title `/r/:id`; Add to Meal Plan retained.
- Cookbook detail (`views/cookbooks/view.ejs`): remove View; title `/recipes/:id`; retain Add to Meal Plan and Remove.
- Meal-plan detail (`views/meal-plans/view.ejs`): remove View; title `/recipes/:id`; retain Remove.
- Cookbook and meal-plan indexes: remove redundant View actions; titles remain linked to organization details.

## Database changes

None. No migration, schema, storage, or RLS changes.

## Security considerations

No new security boundary. Preserve existing CSRF hidden inputs and POST forms for Delete and Remove actions, existing ownership/auth route protections, and data attributes/classes used by delegated Add to Meal Plan JavaScript. Do not replace mutation forms with links. No middleware, validation, upload, rate-limit, or route change is in scope.

## Acceptance criteria

- [ ] No recipe card displays a **View** action on Browse, My Recipes, Search, Liked Recipes, cookbook detail, or meal-plan detail.
- [ ] Recipe titles remain clickable and resolve to `/r/:id` on public cards and `/recipes/:id` on private/organization-detail cards.
- [ ] My Recipes retains one Add to Meal Plan trigger, Favorite, Edit, and CSRF-protected Delete per card.
- [ ] Browse, Search, and Liked Recipes retain one Add to Meal Plan trigger per card with correct guest/authenticated behavior.
- [ ] Cookbook-detail cards retain one Add to Meal Plan trigger and their CSRF-protected Remove action.
- [ ] Meal-plan-detail cards retain their CSRF-protected Remove action.
- [ ] Cookbook and meal-plan index cards display no View action; their linked titles and Rename/Edit actions remain.
- [ ] Cards remain consistently sized and aligned with no empty action row or avoidable whitespace at desktop and mobile widths, including sparse content, long titles, and one/multiple-card grids.
- [ ] Focused view tests and the full `npm test` suite pass.

## Implementation outcome

Implementation and renewed review are complete on `REW-83-remove-redundant-view-button`. The reviewer verdict is **Approved. No blockers.**

As shipped so far, five redundant View links were removed: private recipe summary, cookbook detail, meal-plan detail, cookbook index, and meal-plan index. Title navigation and all other controls were preserved. No CSS, JavaScript, route, API, database, migration, authentication, dependency, configuration, or architecture change was needed.

Automated and source-level acceptance passed: all eight surfaces are explicitly covered, focused view tests passed **11/11**, the full Node suite passed **236/236**, `git diff --check` passed, and a source-wide `views/**/*.ejs` audit found zero visible View actions or text. Static layout review also passed. Actual desktop/mobile browser rendering, navigation, pointer/touch interaction, responsive alignment/wrapping, and authenticated live actions remain pending because browser tooling is unavailable; those checks are not claimed as passed.

[Release notes](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28147721/Release+REW-83+-+Remove+Redundant+View+Button+from+All+Recipe+Cards)
