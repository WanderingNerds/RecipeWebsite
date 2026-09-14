# REW-83 Acceptance / QA Results

Date: 2026-09-13  
Branch: `REW-83-remove-redundant-view-button`  
Ticket: [REW-83 — Remove Redundant View Button from All Recipe Cards](https://wanderingnerds.atlassian.net/browse/REW-83)

## Result

Automated and source-level acceptance: **PASS**. No ticket-blocking defect was found in the implemented templates or tests.

Interactive browser acceptance: **PENDING**. This workspace has no browser engine or browser-automation tool, so actual desktop/mobile rendering, pointer interaction, and navigation were not executed. This limitation is the only remaining acceptance blocker.

## Automated validation

- `node --test src/views/recipeCard.test.js`: **11 passed, 0 failed, 0 skipped**.
- `npm test`: **236 passed, 0 failed, 0 skipped**. No sandbox listener restriction occurred in this run, so there were no environment-driven skips to explain.
- `git diff --check`: **passed**.
- Source-wide visible-action audit (`rg` across all `views/**/*.ejs` for rendered `View` anchors/buttons and then for any `View` text): **passed; no matches**.

The focused tests render the affected EJS templates with representative recipe data, including a long escaped title, multiple categories/tags, optional metadata, guest/authenticated states, and cookbook/meal-plan removal forms.

## Acceptance evidence

- **Browse:** passed by rendered-template test and source inspection. It uses the public summary-card branch, has no recipe-level `View`, links the title to `/r/:id`, and retains one Add to Meal Plan trigger with guest/authenticated behavior.
- **My Recipes:** passed by rendered-template test. It has no recipe-level `View`, links the title to `/recipes/:id`, and retains one Add to Meal Plan trigger, Favorite state, Edit, Delete, the delete confirmation, and the CSRF hidden input. Category/tag filters and draft behavior remain covered.
- **Search:** passed by rendered-template test and source inspection. It uses the public recipe-card partial, has no recipe-level `View`, links the title to `/r/:id`, and retains one Add to Meal Plan trigger with guest/authenticated behavior.
- **Liked Recipes:** passed by rendered-template test and source inspection. It uses the public recipe-card partial, has no recipe-level `View`, links the title to `/r/:id`, and retains one Add to Meal Plan trigger. Its heading, result count, author, time, and serving content remain covered.
- **Cookbook detail:** passed by rendered-template test. Recipe cards have no recipe-level `View`, link titles to `/recipes/:id`, and retain one Add to Meal Plan trigger plus the POST Remove form, CSRF hidden input, `returnTo=cookbook`, and confirmation prompt.
- **Meal-plan detail:** passed by rendered-template test. Recipe cards have no recipe-level `View`, link titles to `/recipes/:id`, and retain the POST Remove form, CSRF hidden input, and confirmation prompt.
- **Cookbook index:** passed by rendered-template test and source inspection. It has no `View` action, its title remains linked to `/cookbooks/:id`, and Rename remains linked to `/cookbooks/:id/edit`.
- **Meal-plan index:** passed by rendered-template test and source inspection. It has no `View` action, its title remains linked to `/meal-plans/:id`, and Edit remains linked to `/meal-plans/:id/edit`.
- **Whole-site audit:** passed by source inspection. No EJS template contains a rendered `View` anchor/button or any remaining `View` text. Non-UI occurrences are limited to route comments, app configuration comments, and negative test assertions/descriptions.
- **Change scope:** passed by diff inspection. The application diff removes the five redundant links from the private summary card, cookbook detail, meal-plan detail, cookbook index, and meal-plan index. No routes, mutation methods, authentication checks, JavaScript hooks, or CSS were changed.

## Desktop/mobile layout assessment

Static layout review found no regression:

- Recipe collections continue to use responsive grids: `.recipe-grid` uses `repeat(auto-fit, minmax(280px, 1fr))` and switches to one column at 480px; `.organization-card-grid` uses capped tracks and also switches to one fluid column at 480px.
- Cards remain flex columns, with action rows anchored using `margin-top: auto`, so cards in a row retain aligned actions across sparse and longer content.
- My Recipes and cookbook action rows retain `flex-wrap: wrap`; the shared summary-card CSS constrains long titles and badges with `min-width: 0` and `overflow-wrap: anywhere`.
- Removing an action does not leave an empty action row: Browse, Search, Liked Recipes, My Recipes, and cookbook detail retain action controls; meal-plan detail retains Remove; cookbook and meal-plan indexes retain Rename and Edit respectively.
- The focused rendering fixture exercises a long title, multiple badges, and populated metadata. Existing tests also exercise missing optional fields and zero/one/multiple tags.

This is a structural/static assessment only. A real browser should still be used at representative desktop and mobile widths to confirm visual card-height alignment, wrapping, tap targets, and that each title navigates to the expected detail page.

## Remaining manual checks

- Render all eight surfaces in a browser at desktop and mobile widths, with one-card and multi-card collections.
- Confirm long-title and sparse-content cards have no clipping, avoidable whitespace, or uneven action alignment.
- Activate titles and confirm public recipes reach `/r/:id`, private/organization-detail recipes reach `/recipes/:id`, cookbooks reach `/cookbooks/:id`, and meal plans reach `/meal-plans/:id`.
- Confirm Favorite, Edit, Delete, Add to Meal Plan, and Remove interactions still behave correctly against an authenticated live backend.
