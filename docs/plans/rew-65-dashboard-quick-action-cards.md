## Jira issue

[REW-65 — Add Recipe Organization Cards to Dashboard Quick Actions](https://wanderingnerds.atlassian.net/browse/REW-65)

## Confluence page

[REW-65: Dashboard Quick Action Cards - Feature Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/26017793/REW-65+Dashboard+Quick+Action+Cards+-+Feature+Plan)

## Summary

Replace the dashboard Quick Actions placeholder with four consistent, fully clickable cards that take an authenticated user to My Recipes, My Cookbooks, My Favorites, and My Meal Plans. The cards will reuse the Potluck design tokens and visual language already present in the dashboard and feature-card styles, while adding a dashboard-specific responsive grid and clear hover/focus states so the collection shortcuts remain usable with mouse, keyboard, and touch at supported viewport sizes.

As a follow-up, make the dashboard the primary access point for these personal organization areas by removing their duplicate authenticated-user links from the global navigation. Home, Browse, Dashboard, search, greeting, Logout, and unauthenticated Login/Sign Up navigation remain unchanged.

As a final follow-up, standardize the content-card grids reached from those Quick Actions. A one-item Favorites result currently expands across its available row because `views/recipes/liked.ejs` uses the collapsing `.recipe-grid` (`auto-fit`) layout, while My Recipes, cookbook, and meal-plan screens use `.recipe-grid-fill` (`auto-fill`). Introduce one explicit personal-organization grid contract whose desktop/tablet tracks have the same capped card width and remain left-aligned when a row is not full; only narrow/mobile layouts should make a card span the available width. This follow-up concerns recipe, cookbook, and meal-plan content cards on the destination pages—not the four Quick Action cards on the dashboard.

## As shipped

Implemented on branch `REW-65-dashboard-quick-action-cards`. `views/dashboard.ejs` now renders four single-anchor cards with the planned labels and destinations. `public/css/styles.css` provides a consistent token-based responsive grid, card sizing, hover state, and visible focus behavior. `src/views/dashboard.test.js` adds three rendered-EJS regression tests covering labels and exact links, full-card anchor structure without nested controls, and decorative-icon accessibility.

Code review of the original cards was approved with no findings (Jira comment `10150`), and the navbar follow-up was also approved with no findings (Jira comment `10154`). `views/partials/navbar.ejs` now omits the four duplicate authenticated organization links while retaining Home, Browse, Dashboard, search, greeting, and Logout; guest Login and Sign Up remain unchanged. `src/views/navbar.test.js` adds two rendered-EJS regressions for authenticated and guest states. The developer, reviewer, and coordinating agent each ran the final full suite successfully: **150 passed, 0 failed**. The coordinating agent confirmed the structural behavior and that routes/authentication were unchanged. A live authenticated-browser desktop/collapsed-mobile visual, toggle, keyboard, and destination sweep was unavailable and remains a non-blocking manual follow-up.

The final sizing follow-up is also shipped and reviewer-approved with no findings (Jira approval comment `10158`). `public/css/styles.css` defines `.organization-card-grid` with start-aligned `repeat(auto-fill, minmax(300px, 22rem))` tracks and a one-column fluid override at `480px` and below. My Recipes, Favorites, cookbook index/detail, and meal-plan index/detail use this shared class; Dashboard Quick Actions and public Browse/Search remain unchanged. `src/views/organizationCardGrid.test.js` adds two contract tests. Developer, reviewer, and coordinating-agent runs all completed at **152 passed, 0 failed**; acceptance verified the selector adoption across all six templates, grid math, mobile override, and unchanged routes/authentication. Live authenticated visual QA with one and multiple cards at desktop, tablet, and mobile was unavailable and remains a non-blocking follow-up.

## Open questions / assumptions

- Jira names the third destination **My Favorites**, while the existing destination page is titled "Liked Recipes" and is served at `/recipes/liked`. The dashboard card uses the ticket-required **My Favorites** label and links to the existing route. For the follow-up, the navbar's existing **Liked** link is treated as the Favorites navigation equivalent and is removed with the other three duplicated links.
- "Each user's relevant area" is satisfied by the existing owner-scoped/authenticated destinations: `/recipes`, `/cookbooks`, `/recipes/liked`, and `/meal-plans`. No user identifier or new dashboard query is needed.
- Use concise supporting text and an icon for each card to make the destinations distinguishable while preserving the existing dashboard style. Inline decorative SVGs should be hidden from assistive technology; the visible card title and description provide the accessible name and purpose.
- Supported responsive behavior is assumed to mean a multi-column layout when space allows and a single-column layout on narrow screens, without horizontal overflow or clipped content.
- "Each card should be the same size no matter how many there are" is interpreted as a grid-sizing requirement: at the same non-mobile viewport, a card keeps the same capped track width whether the grid has one item or many. It does not require every card to have a fixed pixel height; content may make cards taller, while cards in the same CSS grid row continue to stretch consistently.
- The sizing contract applies to the four organization destinations and their collection/detail grids: My Recipes, Favorites/Liked Recipes, cookbook index and cookbook recipe contents, and meal-plan index and meal-plan recipe contents. It does not restyle the dashboard Quick Action cards or unrelated public Browse/Search cards.
- Preserve the current narrow-screen behavior at `max-width: 480px`: one column using the available content width. Above that breakpoint, use a shared minimum track of `300px`, cap tracks at a single chosen design-token/rem width (recommended approximately `22rem`), keep incomplete rows left-aligned, and let additional cards wrap into as many capped tracks as fit. The Developer may tune the exact cap slightly after visual validation, but must use one value for every in-scope destination grid.

## Tasks

1. Replace the placeholder copy under Quick Actions in `views/dashboard.ejs` with four semantic anchor cards. Make each anchor the complete interactive surface and map the cards exactly to My Recipes (`/recipes`), My Cookbooks (`/cookbooks`), My Favorites (`/recipes/liked`), and My Meal Plans (`/meal-plans`). Include concise descriptions and decorative icons that fit the established Potluck visual style.
2. Add dashboard-specific card-grid and card styles in `public/css/styles.css`, using existing spacing, surface, radius, shadow, color, and typography custom properties. Give all cards consistent sizing, allow their content to stretch uniformly, and provide visible hover and `:focus-visible` affordances without suppressing native keyboard accessibility.
3. Add a rendered-EJS regression test for the dashboard that verifies all four labels and exact hrefs, verifies each destination is represented by a single card-level anchor rather than a small nested link, and checks the card/icon accessibility contract. Keep responsive layout verification in manual QA because the current Node test setup has no browser or layout engine.
4. Run the automated test suite and manually validate the dashboard at representative desktop, tablet, and mobile widths, including keyboard traversal and direct navigation through every card.

### Follow-up: remove duplicate navbar links

1. In `views/partials/navbar.ejs`, remove the authenticated-user list items for My Recipes (`/recipes`), Liked/Favorites (`/recipes/liked`), Cookbooks (`/cookbooks`), and Meal Plans (`/meal-plans`). Retain Dashboard plus all unrelated public, search, authentication, greeting, and logout controls.
2. Add a rendered-EJS navbar regression test that covers both authenticated and unauthenticated states: the four personal-organization links are absent from authenticated navigation, Dashboard and unrelated controls remain available, and guest Login/Sign Up behavior remains unchanged.
3. Run the full automated test suite. Manually verify desktop and collapsed mobile navigation so removing the list items does not leave layout gaps and all retained links/controls remain keyboard reachable.

### Final follow-up: consistent destination content-card sizing

1. Define a shared personal-organization card-grid class in `public/css/styles.css`. Above `480px`, use non-collapsing, capped tracks (minimum `300px`, one shared maximum around `22rem`) with start alignment so empty grid capacity is not redistributed into one or two oversized cards. At `480px` and below, retain a single fluid column so cards fit the viewport without horizontal overflow. Keep grid-item stretching within a row, but do not impose a fixed content height that could clip titles, metadata, actions, or images.
2. Apply that shared grid class to every content-card grid reached through the four Quick Actions: `views/recipes/index.ejs`, `views/recipes/liked.ejs`, `views/cookbooks/index.ejs`, `views/cookbooks/view.ejs`, `views/meal-plans/index.ejs`, and `views/meal-plans/view.ejs`. Avoid changing the `.quick-actions-grid`/`.quick-action-card` component and avoid broad changes to public Browse/Search grids. Reuse the existing recipe/card markup unless implementation reveals a markup-specific sizing defect.
3. Add a focused rendered-template/static-contract regression test under `src/views/` (recommended `src/views/organizationCardGrid.test.js`) that verifies all six in-scope templates opt into the same grid class and that Favorites no longer uses the collapsing `.recipe-grid` layout. Also assert the shared CSS contract includes capped non-mobile tracks and the existing one-column mobile override; do not claim pixel layout coverage from Node string tests.
4. Run the full Node test suite. In browser QA, seed or use authenticated states with one card and multiple cards for each applicable destination, then compare at representative desktop (at least `1200px`), tablet (approximately `768px`), and mobile (`480px` or narrower) widths. Confirm lone/partial-row cards do not expand to fill the row on desktop/tablet; cards wrap without overlap or overflow; card content and action controls remain visible and usable; and empty states are unchanged.

## Affected files

- `views/dashboard.ejs` — replace the Quick Actions placeholder with the four fully clickable organization cards.
- `public/css/styles.css` — add the responsive Quick Actions grid, consistent card presentation, and hover/focus-visible states.
- `src/views/dashboard.test.js` — new rendered-view regression coverage for card labels, links, full-card anchor structure, and icon accessibility.
- `views/partials/navbar.ejs` — remove the four authenticated personal-organization links now represented by dashboard Quick Actions; retain Dashboard and unrelated navigation.
- `src/views/navbar.test.js` — add rendered-partial regression coverage for authenticated and guest navigation visibility (new file, unless the Developer identifies a better existing view-test home).
- `public/css/styles.css` — final follow-up: replace the count-sensitive personal-organization grid behavior with one capped, start-aligned desktop/tablet track contract and preserve the fluid one-column mobile rule.
- `views/recipes/index.ejs` — opt My Recipes content cards into the shared organization grid contract.
- `views/recipes/liked.ejs` — replace the collapsing Favorites `auto-fit` grid usage with the shared organization grid contract; preserve recipe-card content and links.
- `views/cookbooks/index.ejs` — opt cookbook summary cards into the same grid sizing contract.
- `views/cookbooks/view.ejs` — opt recipes inside a cookbook into the same grid sizing contract.
- `views/meal-plans/index.ejs` — opt meal-plan summary cards into the same grid sizing contract.
- `views/meal-plans/view.ejs` — opt recipes inside a meal plan into the same grid sizing contract.
- `src/views/organizationCardGrid.test.js` — recommended new structural regression test for shared class adoption, capped-track CSS, and the mobile single-column override.

## Database changes

No migration, table, column, query, or RLS changes are needed. The ticket only exposes navigation to existing authenticated, owner-scoped feature areas.

## Security considerations

- The dashboard and all four target areas already use `requireAuth`; retain these route protections and do not embed user-controlled values into hrefs.
- Use only fixed internal paths for the card destinations, so this change introduces no redirect or URL-injection surface.
- Render visible labels/descriptions as static template content. Decorative icons should not introduce dynamic markup or external resources.
- This is a GET-only navigation change, so CSRF, request-body validation, rate limiting, and upload handling are not applicable.
- Preserve semantic anchor behavior and a visible `:focus-visible` state so keyboard users can identify and activate every card.
- The follow-up changes discoverability only; do not remove or weaken `requireAuth` on any destination route. Direct URLs and dashboard cards must continue to use the existing authenticated route protections.
- The final sizing follow-up is presentation-only. Preserve existing route authentication, owner-scoped queries, CSRF fields on destructive forms, confirmation behavior, and links/actions within every card. Do not solve sizing by hiding, truncating, or removing interactive controls.

## Acceptance criteria

- [x] The authenticated dashboard displays exactly four cards under Quick Actions: My Recipes, My Cookbooks, My Favorites, and My Meal Plans.
- [x] The four cards use the same component structure and token-based styling. Live visual comparison remains part of the manual follow-up below.
- [x] Each card is a single enclosing anchor with no nested interactive controls.
- [x] My Recipes links to `/recipes`, the existing authenticated recipe collection.
- [x] My Cookbooks links to `/cookbooks`, the existing authenticated cookbook area.
- [x] My Favorites links to `/recipes/liked`, the existing authenticated liked-recipes area.
- [x] My Meal Plans links to `/meal-plans`, the existing authenticated meal-plan area.
- [ ] At representative desktop, tablet, and mobile widths, the grid reflows without horizontal overflow, clipping, overlap, or unusably narrow cards.
- [ ] Keyboard focus moves to each card in logical source order, every card activates with standard link keyboard behavior, and focus is visibly indicated.
- [x] Decorative icons are ignored by assistive technology, while each card's visible text clearly identifies its destination.
- [x] The full automated test suite passes, including the dashboard rendered-view regression test (148 passed, 0 failed).

The two browser-dependent criteria above—responsive layout at representative widths and keyboard focus/navigation in a live authenticated browser—remain unverified and are intentionally left unchecked.

### Follow-up acceptance criteria

- [x] For an authenticated user, the global navbar no longer renders links to `/recipes`, `/recipes/liked`, `/cookbooks`, or `/meal-plans`.
- [x] The authenticated navbar still renders Home, Browse, Dashboard, search, the user greeting, and Logout.
- [x] The unauthenticated navbar still renders Home, Browse, search, Login, and Sign Up, with no regression to guest navigation.
- [x] The four dashboard Quick Actions remain present and continue to link to the same four destination routes.
- [x] Removing the links does not alter the destination routes or their existing authentication/authorization protections; structural acceptance confirms the routes and auth behavior are unchanged.
- [ ] At desktop and collapsed mobile widths, the retained navbar content has no empty list-item gaps, clipping, overlap, or broken menu-toggle behavior, and remains keyboard reachable.
- [x] The full automated test suite passes, including navbar and dashboard rendered-view regressions: **150 passed, 0 failed**.

### Final follow-up acceptance criteria: destination content-card sizing

- [ ] At the same desktop or tablet viewport, an in-scope content card has the same capped grid-track width when its grid contains one item, a partially filled row, or a full row; a lone Favorites card no longer spans the page.
- [x] My Recipes, Favorites/Liked Recipes, cookbook summaries, recipes within a cookbook, meal-plan summaries, and recipes within a meal plan all use the same shared grid-sizing class and breakpoint contract.
- [x] The four dashboard Quick Action cards retain their current component structure, sizing, labels, destinations, hover behavior, and keyboard-focus behavior.
- [x] Above `480px`, in-scope cards use a shared minimum width of `300px`, a shared `22rem` maximum, start alignment, and wrapping; structural acceptance confirms unused row capacity is not redistributed into wider tracks.
- [x] At `480px` and below, every in-scope grid is configured as one fluid column; live overflow and overlap checks remain part of browser QA.
- [ ] Variable card content remains fully visible: thumbnails keep their intended crop/aspect behavior, long titles and metadata can wrap, and View/Edit/Delete/Remove controls remain visible, keyboard reachable, and usable.
- [x] Zero-item empty states and all existing destination routes, authentication/authorization behavior, links, CSRF fields, and mutations are unchanged by the presentation-only implementation.
- [x] Two automated regressions verify shared-grid adoption in all six in-scope templates plus the capped desktop/tablet and single-column mobile CSS contract; the full suite passes: **152 passed, 0 failed**.
- [ ] Browser QA records one-item and multi-item results for each applicable destination at representative desktop, tablet, and mobile widths; Node template tests alone are not treated as visual proof.
