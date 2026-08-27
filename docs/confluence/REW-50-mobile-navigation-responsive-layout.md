# REW-50: Mobile Navigation & Responsive Layout Overhaul - As Shipped

**Space:** Recipe Website
**Status:** Complete (Reviewer approved, no blocking issues)
**Jira Issue:** [REW-50](https://wanderingnerds.atlassian.net/browse/REW-50)
**Branch:** `REW-50-mobile-navigation-responsive-layout`

---

## Overview

This page documents the as-shipped state of REW-50. It supersedes the [implementation plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/19595265) where the final implementation diverged from or extended it.

The Potluck site's mobile experience was broken: header nav links were hidden below 832px with no replacement way to access them, several templates used fixed two-column grids or unwrapped flex rows via inline styles that didn't collapse on narrow viewports, and recipe/feature card grids could overflow at 320px width. This change replaces the "hide the nav links" approach with a hamburger menu and fixes the layout/overflow issues across recipe list, recipe form, and recipe detail templates.

---

## What Shipped

### Navigation
- `views/partials/navbar.ejs` restructured into a persistent header row (logo + `.navbar-toggle` hamburger button) and a collapsible `#navbar-menu` container, with `aria-controls`/`aria-expanded`/`aria-hidden` wired to the toggle.
- New `public/js/nav.js` (registered in `views/layouts/main.ejs`) handles:
  - Toggling `.is-open` + `aria-expanded` on hamburger click
  - Closing on nav-link click, outside click/tap, repeat hamburger tap, and **Escape** (returns focus to the toggle button)
  - Keeping `aria-hidden` correct across the mobile/desktop boundary via `matchMedia('(min-width: 769px)')`, since the menu is always visible (not collapsible) on desktop
  - Re-closing/re-syncing state when the viewport crosses the 768px breakpoint (e.g. tablet rotation), so the menu can't get stuck in the wrong open/closed state for the new mode

This is a superset of the plan's original scope (which called for open/close on click, link-select, and outside-click) — the Escape-key handling and breakpoint-crossing sync were added during development as accessibility/robustness hardening.

### CSS (`public/css/styles.css`)
- Consolidated the two previously-conflicting mobile breakpoints (`max-width: 52rem` and `max-width: 768px` — the latter was dead code against a `display: grid` navbar) into a single `max-width: 768px` rule, per the plan.
- Added `.navbar-toggle` / `.navbar-toggle-bar` / `.navbar-menu` / `.is-open` styles; toggle button is a 44x44px tap target.
- `.recipe-grid`, `.features-grid`, and a new `.recipe-grid-fill` class all collapse to a single column below 480px.
- New utility classes `.form-grid-2col`, `.form-grid-meta`, `.form-grid-meta-4` replace the inline `grid-template-columns: 1fr 1fr` hacks in the recipe form templates and collapse to one column at <=640px.
- Mobile-only media query bumps `.btn-icon`, `.scale-btn`, `.like-btn`, and pagination links to ~44x44px tap targets.
- Defensive `overflow-x: hidden` added on `html`/`body`.

### Templates
- `views/recipes/index.ejs` — inline recipe-card grid style replaced with `.recipe-grid-fill`; header row (title + actions) now wraps.
- `views/recipes/new.ejs`, `views/recipes/edit.ejs` — inline two-column grids replaced with `.form-grid-2col`/`.form-grid-meta`/`.form-grid-meta-4`.
- `views/recipes/view.ejs`, `views/recipes/public-view.ejs` — title/like-button/badge header rows now wrap.
- `views/recipes/import.ejs` — audited and updated for the same inline-flex/fixed-grid overflow pattern.
- `views/partials/import-modal.ejs`, `views/auth/login.ejs`, `views/auth/register.ejs` — audited; no changes needed.

---

## Divergence from Plan

| Plan item | As shipped |
|-----------|------------|
| Close menu on toggle/link/outside click | Implemented, **plus** Escape-key close and breakpoint-crossing auto-close (not in original plan) |
| Single 768px breakpoint | Implemented exactly as planned |
| `.recipe-grid`/`.features-grid` single column below ~480px | Implemented as planned |
| Inline recipe-card grid in `index.ejs` → CSS class | Implemented as `.recipe-grid-fill` |
| Inline form grids in `new.ejs`/`edit.ejs` → CSS classes at 640px | Implemented as `.form-grid-2col`/`.form-grid-meta`/`.form-grid-meta-4` (plan anticipated one class; shipped with three to distinguish the main layout grid from the 2-field and 4-field meta grids) |
| Audit `import.ejs`, `import-modal.ejs`, `auth/*.ejs` | `import.ejs` needed fixes; `import-modal.ejs` and `auth/*.ejs` did not (see Known Issues for a separate, pre-existing issue found in `import-modal.ejs`) |
| 44px tap targets | Implemented as planned |
| `overflow-x: hidden` backstop | Implemented as planned |

---

## Known Issues / Follow-Ups (non-blocking, flagged by Reviewer)

1. **`navbar.ejs:35` — `aria-hidden="true"` hardcoded server-side.** The menu is visible on desktop until `nav.js`'s `syncAriaHidden()` corrects it on `DOMContentLoaded`. This is a real but minor accessibility gap (a screen reader evaluating the DOM before JS executes could see the desktop-visible menu marked hidden). Recommend a small follow-up ticket.
2. **`import-modal.ejs` inline `<script>` CSP violation.** Pre-existing, predates this change, out of scope for REW-50. Recommend a separate ticket if not already tracked.
3. **No automated test for `nav.js`.** Consistent with existing repo convention — no other front-end DOM script (`main.js`, `recipe-form.js`, `tags-input.js`) has co-located tests.

---

## Security

- Presentation-layer only. No new input, forms, or auth surfaces.
- `nav.js` uses `classList` toggling and `addEventListener` only — no `innerHTML` or unsanitized DOM injection.
- No CSP changes required; `nav.js` is an external script with no inline handlers, consistent with `helmet`'s existing policy in `src/app.js`.
- No changes to rate limiting, file upload handling, or Supabase auth flows.

---

## Database Changes

None. Front-end CSS/EJS/JS only.

---

## Testing

`npm test`: 71/71 passing. Reviewer approved with no blocking issues. Manual verification performed via Chrome DevTools device emulation at 320px, 375px, 414px, and 768px, with a regression check at 1024px/1280px, per the plan's acceptance criteria.

---

## Related Pages

- [REW-50: Implementation Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/19595265)
- [REW-48: Rebrand Website CSS/Image](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe) (parent brand theme work this builds on)

---

**Last Updated:** 2026-08-26
**Author:** Documentation Team
