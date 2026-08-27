# Release Notes: REW-50 - Mobile Navigation & Responsive Layout Overhaul

**Release Date:** 2026-08-26
**Jira Issue:** [REW-50](https://wanderingnerds.atlassian.net/browse/REW-50)
**Branch:** `REW-50-mobile-navigation-responsive-layout`

---

## Summary

Replaced the site's broken mobile navigation (nav links simply disappeared below 832px with no alternate way to reach them) with a proper hamburger menu, and fixed the CSS/template issues that caused horizontal overflow and non-reflowing layouts on phones and tablets. Desktop layout (>=1024px) is unchanged.

---

## User-Facing Changes

### Navigation
- Mobile/tablet header (<=768px) now shows the Potluck logo on the left and a hamburger icon on the right, instead of hiding nav links with no replacement.
- Tapping the hamburger opens a full-width dropdown with all primary links (Home, Browse, plus Dashboard/My Recipes/Liked/Logout when signed in, or Login/Sign Up when signed out).
- The menu closes when: a link is tapped, the hamburger is tapped again, a tap lands outside the menu, or Escape is pressed.
- The menu also auto-resets if the viewport crosses the 768px breakpoint (e.g. rotating a tablet) so it can't get stuck open/closed in the wrong mode.

### Layout & Sizing
- Recipe and feature card grids now render in a single column below 480px instead of overflowing the viewport.
- The new-recipe and edit-recipe forms (main layout and the prep/cook/servings/difficulty fields) now correctly collapse to a single column at or below 640px — previously a code comment claimed this worked but the grids were hardcoded via inline styles and never actually collapsed.
- Page header rows (recipe list title/actions, recipe detail title/like button/badges) now wrap instead of clipping on narrow screens.
- Hamburger button, icon buttons, scale controls, like buttons, and pagination links now meet a ~44x44px minimum tap target on mobile.
- Added a defensive `overflow-x: hidden` on `html`/`body` as a backstop.

### No Backend/Functional Changes
This release is front-end presentation only. No recipe data, auth, or account behavior changed.

---

## Technical Changes

### New File
- `public/js/nav.js` — hamburger open/close logic: toggles `.is-open` + `aria-expanded` on click, closes on nav-link click/outside click/repeat toggle/Escape, and keeps `aria-hidden` in sync with both open state and the current breakpoint via `matchMedia('(min-width: 769px)')`. No `innerHTML`/DOM injection; uses `classList` + `addEventListener` only, consistent with `public/js/main.js`, and requires no CSP changes (external script, no inline handlers).

### Templates Modified
- `views/partials/navbar.ejs` — restructured into a persistent header row (logo + `.navbar-toggle` button) plus a collapsible `#navbar-menu` container with `aria-controls`/`aria-expanded`/`aria-hidden` wiring.
- `views/layouts/main.ejs` — registers `<script src="/js/nav.js">`.
- `views/recipes/index.ejs` — inline recipe-card grid style replaced with `.recipe-grid-fill` class; header row now wraps.
- `views/recipes/new.ejs`, `views/recipes/edit.ejs` — inline `grid-template-columns: 1fr 1fr` layouts replaced with `.form-grid-2col` / `.form-grid-meta` / `.form-grid-meta-4` utility classes.
- `views/recipes/view.ejs`, `views/recipes/public-view.ejs` — title/action header rows now wrap.
- `views/recipes/import.ejs` — audited and updated for the same overflow pattern.

### CSS (`public/css/styles.css`)
- Consolidated two conflicting mobile breakpoints (previously `max-width: 52rem` and `max-width: 768px`, with the 768px rule being dead code against a grid-display navbar) into a single `max-width: 768px` rule.
- Added `.navbar-toggle`, `.navbar-toggle-bar`, `.navbar-menu`, and `.is-open` styles for the collapsible nav.
- Added single-column-below-480px rules to `.recipe-grid`, `.features-grid`, and the new `.recipe-grid-fill`.
- Added `.form-grid-2col`, `.form-grid-meta`, `.form-grid-meta-4` utility classes, collapsing to one column at <=640px.
- Added a mobile-only media query bumping `.btn-icon`, `.scale-btn`, `.like-btn`, and pagination link tap targets to ~44x44px.
- Added `overflow-x: hidden` on `html`/`body`.

### Known Non-Blocking Follow-Ups (flagged by Reviewer, not fixed in this pass)
- `views/partials/navbar.ejs` hardcodes `aria-hidden="true"` on `#navbar-menu` server-side, even though the menu is visible on desktop until `nav.js`'s `syncAriaHidden()` corrects it on `DOMContentLoaded`. Minor accessibility nit — screen readers that evaluate the DOM before JS runs could briefly see the menu marked hidden on desktop. Recommend a small follow-up ticket to default this correctly server-side (e.g. render `aria-hidden` based on a server-known "is likely mobile" default, or simply omit the attribute server-side and let JS own it entirely).
- `views/partials/import-modal.ejs` has a pre-existing inline `<script>` CSP violation. Predates this change and is out of scope; recommend a separate ticket.

---

## Breaking Changes

None. Desktop (>=1024px) layout, nav structure, and all page routes are visually and functionally unchanged.

---

## Deployment

No special deployment steps required. Standard deployment of updated static assets and templates.

- No database migrations
- No environment variable changes
- No new external services or security middleware changes (helmet/csrf-csrf/express-rate-limit/auth untouched)

---

## Testing

`npm test`: 71/71 passing. No new automated test was added for `nav.js`, consistent with this repo's existing convention — no other front-end DOM script (`main.js`, `recipe-form.js`, `tags-input.js`) has co-located tests either. Manual verification was performed via device emulation per the plan's acceptance criteria (320px, 375px, 414px, 768px, with 1024px/1280px regression check).
