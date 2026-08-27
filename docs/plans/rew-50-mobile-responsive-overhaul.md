# REW-50: Mobile Navigation & Responsive Layout Overhaul

## Jira issue
[REW-50](https://wanderingnerds.atlassian.net/browse/REW-50) — "Mobile Navigation & Responsive Layout Overhaul" (Bug, Medium priority, To Do)

## Confluence page
[REW-50: Mobile Navigation & Responsive Layout Overhaul - Implementation Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/19595265/REW-50+Mobile+Navigation+amp+Responsive+Layout+Overhaul+-+Implementation+Plan) (child of "Potluck Design System - Brand and UI Foundation")

## Summary
The Potluck site's mobile experience is broken: the header navigation links are hidden below 832px width with no replacement way to access them, several page templates use fixed two-column CSS grids or unwrapped flex rows via inline `style` attributes that don't collapse on narrow viewports, and the recipe card grids use a `minmax(280-300px, 1fr)` auto-fit pattern that can overflow viewports at 320px width. This plan replaces the current "hide the nav links" approach with a proper hamburger menu (logo left / hamburger right, tap to open/close, closes on outside tap or link select), and audits/fixes the templates and CSS causing horizontal overflow and non-reflowing layouts on mobile and tablet breakpoints, while preserving the current desktop appearance.

## Open questions / assumptions
1. **Search bar placement on mobile:** the ticket only specifies "navigation links" belong in the dropdown. Assumption: keep the search form visible as its own row under the header (current behavior); only the primary links (Home, Browse, Dashboard, My Recipes, Liked, Login/Sign Up, user greeting/Logout) go inside the hamburger menu. Flag to Developer/Reviewer to confirm before implementing.
2. **Breakpoint:** ticket's acceptance criteria treats 320-480px and 481-768px both as "hamburger" ranges, with nothing stated about 769-1024px. Assumption: single breakpoint at `768px` (hamburger <=768px, full desktop nav >=769px), matching an existing breakpoint already used in `styles.css`.
3. No Jira comments/attachments (mockups) exist on REW-50 — if a specific hamburger icon/animation spec exists elsewhere, Developer should confirm with the reporter before final styling.

## Tasks
1. Restructure `views/partials/navbar.ejs`: wrap the brand/logo and a new `<button class="navbar-toggle">` in a persistent header row; move `.navbar-nav` (and auth/user block) into a new collapsible container (e.g. `#navbar-menu`) with `aria-expanded`/`aria-controls`/`aria-hidden` wired to the toggle button.
2. Add navbar CSS to `public/css/styles.css`: consolidate the two conflicting mobile breakpoints (`max-width: 52rem` and `max-width: 768px`) into one `max-width: 768px` rule; hide `.navbar-toggle` on desktop; on mobile show logo left / toggle right in one row, hide `#navbar-menu` by default, reveal as a full-width dropdown on `.is-open`. Toggle button must be a >=44x44px tap target.
3. Create `public/js/nav.js`: toggle `.is-open` + `aria-expanded` on click; close on nav-link click; close on outside click/tap; close on repeat toggle tap. Register it in `views/layouts/main.ejs`.
4. Fix `.recipe-grid` / `.features-grid` in `styles.css` so they cannot overflow at 320px: add a narrow-width media query forcing a single column (or lower the `minmax` floor) below ~480px.
5. Replace the inline `minmax(300px, 1fr)` grid in `views/recipes/index.ejs` with a CSS class carrying the same single-column-below-480px treatment.
6. Convert the inline `grid-template-columns: 1fr 1fr` layouts in `views/recipes/new.ejs` and `views/recipes/edit.ejs` (main form grid + prep/cook/servings/difficulty meta grid) to CSS classes with a `max-width: 640px` collapse rule — the existing code comment ("single column for mobile") is currently not implemented.
7. Add `flex-wrap` to the unwrapped header flex rows in `views/recipes/index.ejs` (title + action buttons) and `views/recipes/view.ejs` / `views/recipes/public-view.ejs` (title + like button/badges).
8. Sweep `views/recipes/import.ejs`, `views/partials/import-modal.ejs`, `views/auth/login.ejs`, `views/auth/register.ejs` for the same inline-flex/fixed-grid overflow pattern; fix if found.
9. Bump minimum tap-target sizes on mobile (`.btn-icon` currently 36px, `.scale-btn` min-width 36px, `.like-btn`, pagination links) to ~44x44px via a mobile-only media query.
10. Add a defensive `overflow-x: hidden` safety net at `html`/`body` as a backstop, without relying on it in place of the root-cause fixes above.
11. Manually verify with Chrome DevTools device emulation (not just window resize) at 320px, 375px, 414px, 768px, and confirm no regressions at 1024px/1280px.

## Affected files
- `views/partials/navbar.ejs` — add hamburger button + collapsible menu wrapper with ARIA attributes
- `views/layouts/main.ejs` — add `<script src="/js/nav.js">`
- `public/css/styles.css` — navigation section (~lines 300-455): consolidate breakpoints, add `.navbar-toggle`/`.navbar-menu`/`.is-open`; card grids (~lines 872-880, 1393-1397, 2409-2412): single-column-at-narrow rules; new utility classes for the form grids; mobile tap-target overrides; `overflow-x` safety net
- `public/js/nav.js` (new) — hamburger toggle logic
- `views/recipes/index.ejs` — replace inline recipe-card grid style with a class; `flex-wrap` on header row
- `views/recipes/new.ejs`, `views/recipes/edit.ejs` — replace inline two-column grids with responsive classes
- `views/recipes/view.ejs`, `views/recipes/public-view.ejs` — `flex-wrap` on title/action header rows
- `views/recipes/import.ejs`, `views/partials/import-modal.ejs`, `views/auth/login.ejs`, `views/auth/register.ejs` — audit only

## Database changes
None. Front-end CSS/EJS/JS only — no schema, migration, or RLS impact.

## Security considerations
- Presentation-layer only; no new input, forms, or auth surfaces — CSRF/auth middleware unaffected.
- `nav.js` must avoid `innerHTML`/unsanitized DOM injection — use `classList` toggling on existing nodes, consistent with `public/js/main.js`.
- Confirm `nav.js` complies with the CSP set by `helmet` in `src/app.js` — external file with `addEventListener`, no inline handlers/inline `<script>`.
- No change to rate limiting, file upload handling, or Supabase auth flows.

## Acceptance criteria
- [ ] At 320px, 375px, 414px, and 768px widths, header shows logo left-aligned, hamburger right-aligned, no overlap/clipping
- [ ] Tapping the hamburger opens a dropdown with all primary nav links (varying by logged-in/out state)
- [ ] Menu closes on: repeat hamburger tap, link selection, or tap outside
- [ ] No horizontal scrollbar on `/`, `/browse`, `/search`, `/recipes`, `/recipes/liked`, `/recipes/new`, `/recipes/:id`, `/recipes/:id/edit`, `/r/:id` at 320/375/414/768px
- [ ] Recipe cards render single-column at 320-480px, reflow to multi-column only when a card can be >=280px without overflow
- [ ] New/edit recipe forms render single-column <=640px wide
- [ ] Hamburger button, `.btn-icon`, `.scale-btn`, `.like-btn` meet ~44x44px tap target on mobile
- [ ] Desktop (>=1024px) layout is visually unchanged (full inline nav, no hamburger, existing multi-column grids/forms)
- [ ] `npm test` continues to pass
