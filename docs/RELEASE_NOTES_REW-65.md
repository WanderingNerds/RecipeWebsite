# Release Notes: REW-65 - Add Recipe Organization Cards to Dashboard Quick Actions

**Date:** 2026-09-09  
**Jira Issue:** [REW-65](https://wanderingnerds.atlassian.net/browse/REW-65)  
**Branch:** `REW-65-dashboard-quick-action-cards`

## Summary

The dashboard Quick Actions area now gives authenticated users direct access to their four primary recipe-organization areas through consistent, fully clickable cards.

The authenticated global navbar now omits the duplicate My Recipes, Liked/Favorites, Cookbooks, and Meal Plans links, making Dashboard Quick Actions the primary entry point for those areas.

Recipe, Favorites, cookbook, and meal-plan content cards now keep the same capped width when a grid contains one item, a partial row, or many items instead of stretching sparse results across the page.

## User-facing changes

- **My Recipes** links to `/recipes`.
- **My Cookbooks** links to `/cookbooks`.
- **My Favorites** links to `/recipes/liked`.
- **My Meal Plans** links to `/meal-plans`.
- Each complete card is the link target and includes concise supporting text and a decorative icon.
- The grid and cards use the existing Potluck design tokens, reflow responsively, and provide hover and visible keyboard-focus behavior.
- The authenticated navbar retains Home, Browse, Dashboard, search, the user greeting, and Logout.
- Guest Home, Browse, search, Login, and Sign Up navigation is unchanged.
- Personal organization cards are start-aligned in `300px`–`22rem` tracks above `480px` and become one fluid column on smaller screens.
- Public Browse/Search grids and the Dashboard Quick Action cards are unchanged by the sizing follow-up.

## Technical impact

- `views/dashboard.ejs` replaces the Quick Actions placeholder with four semantic card-level anchors.
- `public/css/styles.css` adds dashboard-specific token-based grid/card styles and interaction states.
- `src/views/dashboard.test.js` adds three rendered-EJS regression tests.
- `views/partials/navbar.ejs` removes four duplicate authenticated navigation items.
- `src/views/navbar.test.js` adds two rendered-EJS regressions covering authenticated and guest navigation.
- `public/css/styles.css` adds the shared `.organization-card-grid` sizing contract.
- Six recipe, cookbook, and meal-plan index/detail templates adopt the shared grid class.
- `src/views/organizationCardGrid.test.js` adds two sizing-contract regressions.
- Existing authenticated routes and authorization behavior are unchanged.

## Database, API, configuration, and deployment

No database migrations, API changes, new dependencies, environment variables, or special deployment steps are required. This is a server-rendered navigation and styling change.

## Validation

- Code review: original cards, navbar follow-up, and destination-card sizing follow-up approved with no findings (Jira comments `10150`, `10154`, and `10158`).
- Final full automated suite: **152 passed, 0 failed**, independently run by the developer, reviewer, and coordinating agent.
- Three dashboard tests verify the four labels and exact hrefs, single-anchor full-card structure with no nested controls, and `aria-hidden` decorative icons.
- Two navbar tests verify the four authenticated links are absent, retained authenticated controls remain, and guest navigation is unchanged.
- The coordinating agent validated the structural behavior and confirmed routes/authentication remain unchanged.
- Two organization-grid contract tests verify all six templates share the capped desktop/tablet grid and fluid mobile override.

## Manual follow-up

A live authenticated-browser visual, toggle, keyboard, and destination sweep was unavailable. As a non-blocking follow-up, verify the dashboard grid and navbar behavior, plus one-card and multi-card organization destinations at desktop, tablet, and mobile widths. Confirm sparse destination grids remain capped above `480px`, mobile grids are fluid without overflow, and card content/actions remain visible and usable.

## Documentation

- `README.md` documents the dashboard shortcuts.
- `docs/plans/rew-65-dashboard-quick-action-cards.md` records the as-shipped state and verified acceptance criteria.
- The Confluence feature-plan page is updated to the shipped state.
- A dedicated Confluence release page records this release and its remaining manual follow-up.

## Breaking changes

None.
