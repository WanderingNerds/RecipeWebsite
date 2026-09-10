# Release: REW-65 - Add Recipe Organization Cards to Dashboard Quick Actions

## Jira issue

[REW-65 — Add Recipe Organization Cards to Dashboard Quick Actions](https://wanderingnerds.atlassian.net/browse/REW-65)

## What shipped

The authenticated dashboard Quick Actions area now contains four consistent, fully clickable cards:

| Card | Destination |
| --- | --- |
| My Recipes | `/recipes` |
| My Cookbooks | `/cookbooks` |
| My Favorites | `/recipes/liked` |
| My Meal Plans | `/meal-plans` |

Each card is a single semantic anchor with no nested interactive controls. The cards reuse Potluck design tokens and share consistent sizing, spacing, typography, hover behavior, and visible focus behavior. The grid reflows responsively, and decorative SVG icons are hidden from assistive technology while visible text names each destination.

The authenticated global navbar no longer duplicates these four destinations: My Recipes (`/recipes`), Liked/Favorites (`/recipes/liked`), Cookbooks (`/cookbooks`), and Meal Plans (`/meal-plans`) are intentionally omitted. Home, Browse, Dashboard, search, greeting, and Logout remain for authenticated users; guest Login and Sign Up behavior is unchanged.

Content-card grids reached through those Quick Actions now share `.organization-card-grid`. Above `480px`, cards wrap in start-aligned tracks with a `300px` minimum and `22rem` cap, so one-card and partial rows do not stretch across the screen. At `480px` and below, they use one fluid column. This applies to recipe and Favorites lists, cookbook index/detail, and meal-plan index/detail; public Browse/Search and Dashboard Quick Actions are unchanged.

## Technical details

- `views/dashboard.ejs`: four card-level anchors and supporting content.
- `public/css/styles.css`: responsive Quick Actions grid, consistent card presentation, hover, and `:focus-visible` behavior.
- `src/views/dashboard.test.js`: three rendered-view regression tests.
- `views/partials/navbar.ejs`: removes four duplicate authenticated organization links.
- `src/views/navbar.test.js`: two rendered-view regressions for authenticated and guest navigation.
- `public/css/styles.css`: shared capped `.organization-card-grid` desktop/tablet tracks and fluid mobile override.
- Six organization destination templates: adopt the same grid class.
- `src/views/organizationCardGrid.test.js`: two contract regressions for template adoption and CSS behavior.
- No route, API, authentication, database, configuration, dependency, or deployment changes.

## Validation

The original card, navbar, and sizing follow-up reviews were approved with no findings (Jira comments `10150`, `10154`, and `10158`). The developer, reviewer, and coordinating agent independently ran the final `npm test`: **152 passed, 0 failed**. Automated tests verify dashboard and navbar behavior plus the shared selector in all six destination templates, capped track math, and mobile override. Coordinating-agent acceptance confirmed the structural behavior and unchanged route/authentication protections.

## Non-blocking manual follow-up

A live authenticated-browser visual sweep was unavailable. Verify dashboard and retained-navbar behavior, then test one-card and multi-card organization destinations at desktop, tablet, and mobile widths. Confirm sparse grids remain capped above `480px`, mobile grids are fluid without overflow, and variable content/actions remain visible and usable. These browser-specific checks are not claimed as completed.

## Release impact

Authenticated users can reach their recipe collection, cookbooks, favorites, and meal plans directly from the dashboard. There are no breaking changes or special deployment steps.
