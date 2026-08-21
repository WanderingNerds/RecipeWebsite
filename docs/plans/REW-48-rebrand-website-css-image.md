# REW-48: Rebrand the website using the CSS and Image

## Jira issue
[REW-48](https://wanderingnerds.atlassian.net/browse/REW-48) — "Rebrand the website using the CSS and Image" (Story, To Do). Two attachments serve as the actual spec:
- `potluck-theme.css` (id 10033)
- `ChatGPT Image Aug 21, 2026, 02_33_37 PM.png` (id 10034)

## Confluence page
[Potluck Design System - Brand and UI Foundation](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/17235969/Potluck+Design+System+-+Brand+and+UI+Foundation) — updated in place with the finalized REW-48 plan, re-verified drift findings, and a corrected `Implementation Status` table (version 3, 2026-08-21).

## Summary
Reconcile the live stylesheet (`public/css/styles.css`) and views with the finalized Potluck design tokens delivered via the REW-48 Jira attachments — cream ground, a Terracotta-led four-hue color hierarchy, pill radii, and the documented component rules — and integrate the new brand image attachment as the site's logo/favicon. This is a token/CSS/asset reconciliation, not new product-surface work: it corrects color drift introduced by REW-44 (which swapped Terracotta-leads for Sage-leads and cream ground for near-white per a QA heuristic) and closes a total gap — there is currently no logo, favicon, or `public/images/` directory anywhere in the repo.

## Open questions / assumptions
1. **Could not download the raw Jira attachments.** This planning session's toolset had no generic HTTP fetch capability — only Jira/Confluence-specific MCP calls, which return metadata/content URLs but not authenticated binary content. **Assumption:** `potluck-theme.css` (10033) matches, or closely matches, the already-vendored `.claude/design_handoff_potluck_brand/tokens.css` + `reference/organic-styles.css` bundle. Evidence for this: identical "Potluck" branding already used site-wide (page titles, footer, REW-42 email templates use the exact cream `#f5ead8`/`#ebddc5` values from that bundle), and `public/css/organic.css` in this repo is a verbatim scoped copy of the handoff's `organic-styles.css`. **Action required before implementation:** Developer must open the real attachments from the Jira issue (web UI or authenticated API pull) and diff `potluck-theme.css` against `tokens.css` line-by-line. If values differ, treat the Jira attachment as authoritative and flag the difference back on this plan/Confluence page.
2. **Image attachment 10034 usage is unspecified.** The ticket description also embeds what appears to be the same image inline but it wasn't retrievable either. Assumption: it's a logo/wordmark or brand mood image, not final favicon-ready art. Developer must inspect it directly and decide the concrete deliverables (favicon, navbar logo, and/or an OG/social image) and derive properly-sized assets from it.
3. **REW-44 vs. REW-48 precedence.** REW-44 deliberately made Sage/Mist primary and switched ground to near-white, based on a QA finding ("cream, blue, green as main colors"). This plan assumes the REW-48 token spec (Terracotta default lead, cream ground, "final and exact" per the design-handoff README) supersedes that heuristic, since it is the newer, source-file-backed spec. This is a product/QA-facing decision — flag to the user/QA before merging if there's any doubt; do not silently overrule a prior QA finding without sign-off.
4. `public/css/organic.css` is confirmed orphaned (zero references anywhere in the repo). Assumption: delete it as cleanup rather than keep two divergent copies of the same token system. Confirm with Developer before deleting in case it was staged for a different purpose.
5. `views/layouts/recipe-layout.ejs` is confirmed unused (default layout is `layouts/main`, set in `src/app.js:115`; no view references `recipe-layout`). Flagged for awareness only — out of scope to fix/remove under REW-48.
6. No user-avatar system exists in the schema or UI today, so the design handoff's blush-ring avatar treatment (recipe-card author, note threads) cannot be implemented. Out of scope — would need its own ticket and data model work.
7. Note threads, cook mode, and the social feed described in the design handoff are not built in this codebase. Explicitly out of scope for REW-48, which only covers token/color/asset reconciliation on existing pages (home, browse, search, dashboard, recipe CRUD/view/import, liked, auth).
8. Per-level heading hue coloring (h1 sage, h2 mist, h3 blush, etc., currently in `styles.css`) and the recipe-card title size (20px vs. spec's 22px) are secondary/cosmetic deviations from the design-handoff README. Not corrected by default in this plan — only correct them if the real `potluck-theme.css` attachment explicitly confirms the plain-ink heading rule; otherwise leave as-is to limit scope creep.

## Tasks
1. Pull the real `potluck-theme.css` (10033) and image (10034) attachments from the REW-48 Jira issue; diff the CSS against `.claude/design_handoff_potluck_brand/tokens.css` and `reference/organic-styles.css` to confirm or correct this plan's assumptions before writing any code.
2. Fix the `:root` token block in `public/css/styles.css`: set `--color-bg`/`--color-surface` back to cream (`#f5ead8`/`#ebddc5`); swap `--color-accent` to Terracotta (`#c67139`) and `--color-accent-2` to Sage (`#7a8a5e`); move the Terracotta ramp (currently mislabeled `--color-terracotta-*`) into `--color-accent-100..900`, and move the correct Sage ramp into `--color-accent-2-100..900` (currently `--color-accent-100..900` and `--color-accent-2-100..900` are duplicates of the Sage and Mist ramps respectively — mislabeled, not new values). Leave `--color-blush-*` and `--color-mist-*` as-is (already correct). Most component rules (`.btn-primary`, `.btn-secondary`, `.btn-ghost`, links, focus rings) reference `var(--color-accent)` generically and will self-correct from this token fix alone — confirm no rule needs a separate literal-color update.
3. Remove the border and left-border color stripe from `.card` (spec: surface fill only, no borders); retire or repurpose `.card-sage`/`.card-blush`/`.card-mist` (not in spec) — check whether any view relies on the stripe color for meaning before removing, and pick a replacement (e.g., a kicker label) if so.
4. Recolor `.btn-outline` (currently Mist border/hover-fill, used in 9 view files / 17 occurrences) to the `.btn-secondary` ink/divider treatment instead of removing the class, to avoid large view-file churn.
5. Fix `.navbar-nav a.active` / `a[aria-current='page']` from Blush to Terracotta (spec: "current page is terracotta, never underlined").
6. Update `.recipe-card-placeholder` to render as a filled sage-200 rounded block with the recipe's first letter in Caprasimo (spec's seven-slot recipe-card rule), replacing the current faded-letter-only treatment.
7. Delete `public/css/organic.css` (confirmed orphaned/unreferenced) once Developer confirms no other intended use, to remove the duplicate/divergent copy of the token system.
8. Create `public/images/` and derive brand assets from the Jira PNG attachment using the existing `sharp` dependency (re-encode/strip metadata rather than committing the raw export): at minimum a favicon (`favicon.ico`/`favicon.png`), and a navbar logo if the image is suitable as a wordmark/icon lockup; add an `apple-touch-icon` and/or OG image only if the source art supports it.
9. Wire the favicon into `<head>` in `views/layouts/main.ejs` (the only actively-used layout) via `<link rel="icon">` (+ `apple-touch-icon` if produced).
10. Update `views/partials/navbar.ejs` to use the new logo image for `.navbar-brand` (with meaningful `alt` text), replacing or augmenting the current plain-text "Potluck" link.
11. Run a full visual pass across every page in Affected files at desktop (≥1024px) and mobile (375px) widths to confirm cream ground, corrected hue hierarchy, pill/32px radii, and no layout breakage from the border/stripe removal.
12. Spot-check for regressions against REW-44's Part 1 hardcoded-color refactor (no hex colors reintroduced) in any EJS/JS files touched.
13. After QA sign-off, update the Confluence "Potluck Design System" page's `Implementation Status` table to reflect the corrected state (Developer or Reviewer follow-up).

## Affected files
- `public/css/styles.css` — retoken `:root` (ground/surface/accent/accent-2/ramps); remove `.card` borders and `.card-sage/-blush/-mist` variants; recolor `.btn-outline`; fix navbar active-state color; update `.recipe-card-placeholder`
- `public/css/organic.css` — delete (confirmed orphaned, zero references elsewhere in repo)
- `public/images/` (new directory) — brand/logo/favicon assets derived from Jira attachment 10034 via `sharp`
- `views/layouts/main.ejs` — add favicon `<link>` tag(s) in `<head>` (this is the only layout Express actually renders with, per `src/app.js:115`)
- `views/partials/navbar.ejs` — replace/augment text-only `.navbar-brand` with the new logo image + alt text
- `views/layouts/recipe-layout.ejs` — confirmed unused; no change required, noted for awareness only
- `views/home.ejs`, `views/dashboard.ejs`, `views/error.ejs`, `views/recipes/browse.ejs`, `views/recipes/search.ejs`, `views/recipes/liked.ejs`, `views/recipes/index.ejs`, `views/recipes/view.ejs`, `views/recipes/public-view.ejs`, `views/recipes/new.ejs`, `views/recipes/edit.ejs`, `views/recipes/import.ejs`, `views/auth/login.ejs`, `views/auth/register.ejs`, `views/auth/resend-confirmation.ejs`, `views/partials/recipe-card.ejs`, `views/partials/import-modal.ejs`, `views/partials/pagination.ejs` — no code changes expected (all consume CSS variables/classes, not hardcoded values), but each must be visually re-verified after the token/card/button changes land, since they use `.card`, `.btn-outline`, `.tag-*`, or inline `style="var(--...)"` references that will inherit the corrected theme
- `src/app.js` — no change expected; verify helmet CSP (`imgSrc: ["'self'", "data:", "https:"]`) still permits the new locally-hosted `public/images/` assets (it does, as long as assets are vendored locally rather than referenced via an external URL)
- `.claude/design_handoff_potluck_brand/tokens.css`, `tokens.json`, `reference/organic-styles.css`, `reference/Potluck Brand Guide.dc.html` — read-only reference inputs (git-ignored, not shipped; every contributor needs a local copy)

## Database changes
None. This is a pure CSS/static-asset/view-markup change; no schema, migration, or RLS impact.

## Security considerations
- No new routes, forms, or auth surfaces are introduced — CSRF and rate-limiting middleware are unaffected.
- The new brand image should be processed through the existing `sharp` pipeline (already a dependency, used for uploaded recipe photos) before committing, to strip EXIF/metadata from the ChatGPT-exported PNG and normalize format/size, rather than committing the raw export as-is.
- Confirm helmet's CSP `img-src`/`font-src` directives (`src/app.js`) remain sufficient for the new assets — they already allow `'self'`/`data:`/`https:` for images, so no CSP change is needed provided assets are served locally from `public/images/`; do not reference the logo via an external URL, which would require a CSP update.
- Re-verify no hardcoded hex colors are reintroduced into EJS templates or `public/js/*.js` while touching affected views — this would regress REW-44's Part 1 refactor and reintroduce the exact inconsistency that refactor was meant to prevent.

## Acceptance criteria
- [ ] `body` background-color computes to `#f5ead8` and `.card`/`.input`/`.recipe-card` surface fill computes to `#ebddc5` on at least the home, browse, and recipe-view pages
- [ ] `.btn-primary` (e.g., "Add New Recipe", "Sign Up", navbar search submit) has a Terracotta (`#c67139`) fill, not Sage
- [ ] `--color-accent-2` (Sage) ramp values in the shipped CSS exactly match `tokens.css`'s `--color-accent-2-100..900`, not the previous Sage-under-`--color-accent` mislabeling
- [ ] The current-page navbar link renders in Terracotta, not Blush, and is never underlined
- [ ] `.card` (recipe view, filter bar, dialogs) renders with no visible border or colored left-border stripe, and visibly rounded (32px) corners
- [ ] A recipe with no photo renders `.recipe-card-placeholder` as a filled sage-200 rounded block with the title's first letter in Caprasimo, not a bare tinted letter
- [ ] A favicon is present and loads without a 404 in the browser network tab on at least two pages (home, a recipe view page)
- [ ] The navbar displays the new logo/brand image sourced from the REW-48 image attachment (not plain text alone), with non-empty, descriptive `alt` text
- [ ] `public/css/organic.css` no longer exists in the repo (or, if intentionally kept, is demonstrably linked from at least one view — no orphaned CSS file remains)
- [ ] Every page listed in Affected files renders without layout breakage (no overlapping elements, no broken-image icon, no unstyled-content flash) at 375px and at ≥1024px viewport widths
- [ ] `grep -rn "#[0-9a-fA-F]\{3,6\}"` across `views/` and `public/js/` shows no new hardcoded hex colors introduced by this change (only whatever pre-existing occurrences, if any, are unrelated to touched files)
- [ ] Any Blush or Mist text rendered at body size directly on the cream ground uses the 700-step ramp color or darker (per the spec's contrast rule), verified by inspecting computed color on at least one page using each hue for body copy
