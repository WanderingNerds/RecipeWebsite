# Release Notes: REW-67 - Add “Add to Meal Plan” Action to Recipe Cards

**Date:** 2026-09-13  
**Jira:** [REW-67](https://wanderingnerds.atlassian.net/browse/REW-67)  
**Branch:** `REW-67-add-meal-plan-action-to-recipe-cards`

## Summary

The existing “+ Meal Plan” workflow is now consistently available from Search, Browse, My Recipes, Liked Recipes, and cookbook detail cards. My Recipes and cookbook detail gained the existing delegated modal trigger, and Liked Recipes now uses the canonical public recipe-card partial instead of duplicate markup.

## User impact

- Authenticated users can begin the existing add/remove or create-and-add meal-plan flow from every supported recipe-card list without first opening the recipe detail page.
- Guest actions retain the existing login-prompt behavior.
- My Recipes retains View, Edit, Delete, favorite state, filters, CSRF input, confirmation, and draft/published presentation.
- Liked Recipes retains its heading, count, ordering, public links, metadata, and author display.
- Cookbook recipe cards retain View and protected Remove controls, including CSRF, `returnTo`, and confirmation behavior.

## Technical impact

- Added the existing delegated meal-plan trigger to the private branch of `recipe-summary-card.ejs`; the action row now wraps at narrow widths.
- Replaced Liked Recipes' duplicate card markup with `recipe-card.ejs`.
- Added the authenticated delegated trigger and wrapping action group to cookbook recipe cards.
- Expanded render regressions for Search, Browse, My Recipes, Liked Recipes, and cookbook detail.
- Reused the existing shared modal, browser client, and authenticated JSON API. No new workflow or mutation path was introduced.

## Database and API changes

None. Existing authentication, ownership, recipe-visibility, UUID-validation, rate-limiting, and Supabase RLS controls were not changed.

## Validation

- Focused card tests: 9 passed, 0 failed.
- Final full suite: 234 total; 232 passed, 2 skipped because the sandbox forbids local HTTP listeners, 0 failed.
- Re-review approved with no findings; the original approval is recorded in Jira comment `10245`.
- JavaScript syntax and diff-whitespace checks passed.

The following environment-dependent checks remain pending and are not claimed as passed:

- Live authenticated membership add/remove against Supabase/RLS.
- Inline create-and-add against a live account.
- Cross-account ownership and inaccessible-draft enforcement against live RLS.
- Browser URL/list-state preservation, modal focus/keyboard dismissal, and desktop/mobile wrapping or clipping.

## Deployment

Standard application deployment only. No migrations, environment variables, package changes, configuration changes, or manual deployment steps are required.

## Related documentation

- [Implementation plan](plans/rew-67-add-meal-plan-action-to-recipe-cards.md)
- [Acceptance / QA record](qa/rew-67-add-meal-plan-action-to-recipe-cards.md)
