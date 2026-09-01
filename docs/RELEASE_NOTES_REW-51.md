# Release Notes: REW-51 - Fix Low-Contrast Outline Button Text

**Release Date:** 2026-08-31
**Jira Issue:** [REW-51](https://wanderingnerds.atlassian.net/browse/REW-51)
**Branch:** `REW-51-low-contrast-button-text`
**Type:** Bug fix (accessibility), presentation-only

---

## Summary

The View, Edit, and Import Recipe buttons — and 13 other buttons/links sharing
the `.btn-outline` CSS class across 9 view files — rendered cream text
(`--potluck-oat-milk`, `#f4ebdd`) on a transparent background over light page
and card surfaces. That pairing was designed for the dark-olive hero/navbar,
but `.btn-outline` is used almost everywhere on light `--potluck-paper` /
`--potluck-vanilla` backgrounds, producing a measured contrast ratio of
roughly **1.1:1** (cream-on-cream) — far below the WCAG AA minimum of 4.5:1
for normal text, and in practice close to invisible.

This was a previously-flagged drift item in the Potluck design system
documentation (`.btn-outline` was noted as a non-spec extension slated for a
recolor to match `.btn-secondary`). This release executes that recolor.

---

## User-Facing Changes

- View, Edit, and Import Recipe buttons on `/recipes` (My Recipes) are now
  clearly legible.
- Every other `.btn-outline` button/link is also now legible: Cancel and Save
  as Draft on the new/edit recipe forms, Edit Recipe on the recipe detail and
  public view pages, Login on the public view page, Clear Filters and Browse
  All Recipes, and Save as Draft / Open Full Import Page on the import flow.
- Hover state remains visually distinct (sage background, olive border/text).
- No visual change to any other button variant (`.btn-primary`,
  `.btn-secondary`, `.btn-outline-light`, `.btn-olive`, `.btn-ghost`,
  `.btn-blush`, `.btn-mist`).
- The navbar Logout link (dark olive background) is unchanged — it still
  reads cream text at ~6:1 contrast; it was moved to the existing
  `.btn-outline-light` class specifically so it would *not* pick up this
  recolor.
- No functional/behavioral changes — this is a color-only presentation fix.

---

## Technical Changes

### `public/css/styles.css`
- `.btn-outline` recolored from cream-on-transparent to ink-on-transparent,
  matching `.btn-secondary`'s existing light-surface treatment:
  - Default: `color: var(--color-text)`, `border-color: var(--color-border)`
  - Hover: `background: var(--potluck-sage-100)`,
    `border-color: var(--potluck-olive-700)`,
    `color: var(--potluck-olive-900)`
  - Measured (reviewer-verified) contrast: **~12.9:1** default state
    (`#2e3426` on `#fffaf1`/`#faf5ea`), **~8.6:1** hover state (`#39442f` on
    `#e9ece3`) — both comfortably clear WCAG AA 4.5:1 and AAA 7:1.

### `views/partials/navbar.ejs`
- Logout link's class changed from `btn btn-outline` to
  `btn btn-outline-light` so it keeps its correct cream-on-dark-olive
  contrast (~6:1) instead of inheriting the new ink-on-light styling.

### `views/recipes/import.ejs`
- Removed the now-redundant inline `style="color: var(--text-muted);"`
  override on the `#startOverButton` ("Start Over") element so it inherits
  the corrected `.btn-outline` ink color, matching its sibling "Save as
  Draft" button. This was an optional cleanup identified in planning, not
  part of the originally-reported bug.

---

## Breaking Changes

None. Color-only CSS change plus one class-attribute swap on a static link;
no markup structure, route, auth, or data changes.

---

## Deployment

No special deployment steps required. Standard deployment of the updated
CSS file and two view templates.

- No database migrations
- No environment variable changes
- No new external services or middleware changes

---

## Testing

`npm test`: 78/78 passing (smoke check — no test in this repo references
`.btn-outline`/`.btn-secondary`, and there is no automated visual/contrast
regression coverage). The fix itself was verified by direct contrast-ratio
calculation and a manual trace of all 17 `.btn-outline` usage sites during
code review; reviewer approved with no blocking issues.

**QA note:** the QA verification stage was intentionally excluded for this
run by explicit operator instruction, not skipped due to a problem. This
release therefore reflects planner/developer/reviewer sign-off only — it has
not gone through this repo's usual QA walkthrough (the plan's Task 3 manual
page-by-page verification list). Recommend a follow-up manual/QA pass against
that list before treating this as fully verified in a production sense.
