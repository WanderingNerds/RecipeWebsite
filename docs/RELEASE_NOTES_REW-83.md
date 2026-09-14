# Release Notes: REW-83 - Remove Redundant View Button from All Recipe Cards

**Date:** 2026-09-13  
**Jira:** [REW-83](https://wanderingnerds.atlassian.net/browse/REW-83)  
**Branch:** `REW-83-remove-redundant-view-button`

## Summary

Recipe cards no longer show a redundant **View** action. Recipe titles remain the primary navigation link, and all page-specific actions are preserved.

## User impact

- My Recipes, cookbook detail, meal-plan detail, cookbook index, and meal-plan index cards no longer display a View button.
- Browse, Search, and Liked Recipes already used title-only recipe navigation and remain unchanged.
- Public titles continue to open `/r/:id`; private and organization-detail titles continue to open `/recipes/:id`.
- Cookbook and meal-plan titles continue to open `/cookbooks/:id` and `/meal-plans/:id` respectively.
- Add to Meal Plan, Favorite, Edit, Delete, and Remove actions remain available where applicable.
- Cookbook Rename and meal-plan Edit actions remain available on their index cards.

## Technical impact

- Removed five redundant links: private recipe summary, cookbook detail, meal-plan detail, cookbook index, and meal-plan index.
- Extended rendered-template regressions to explicitly cover all eight applicable surfaces, their title destinations, and preserved actions.
- Reviewer verdict: **Approved. No blockers.**
- No CSS, JavaScript, route, authentication, architecture, dependency, or configuration changes were required.

## Database and API changes

None. No schema, migration, storage, RLS, endpoint, request, response, or authentication behavior changed.

## Validation

- Focused view tests: **11 passed, 0 failed, 0 skipped**.
- Full Node suite: **236 passed, 0 failed, 0 skipped**.
- `git diff --check`: **passed**.
- Source and rendered-template acceptance explicitly covered all eight surfaces and their preserved controls.
- A source-wide `views/**/*.ejs` audit found zero visible View actions or text.
- Static layout assessment passed with no empty action rows or layout concerns.

Interactive desktop/mobile browser QA is still **pending** because this workspace has no browser engine or browser-automation tool. Actual rendering, title navigation, pointer/touch interaction, card alignment, wrapping, and authenticated live actions are not claimed as passed. The Jira issue must remain open until that acceptance work is completed.

## Deployment

Standard application deployment only. No migrations, environment variables, package changes, configuration changes, or manual deployment steps are required.

## Related documentation

- [Implementation plan](plans/rew-83-remove-redundant-view-button.md)
- [Acceptance / QA record](qa/rew-83-remove-redundant-view-button.md)
