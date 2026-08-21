# REW-44: Update Website Color Theme

**Space:** Recipe Website
**Status:** Complete
**Jira Issue:** [REW-44](https://wanderingnerds.atlassian.net/browse/REW-44)

---

## Overview

This page documents the implementation of the updated website color theme (REW-44). Based on QA feedback, the color hierarchy was updated so that Sage (green) and Mist (blue) are now the primary UI colors, while Terracotta (orange) and Blush (pink) remain available as accent colors for specific use cases.

---

## Summary

Updated the Potluck design system color hierarchy to improve visual consistency and better align with brand guidelines. The implementation was completed in two phases: first refactoring all hardcoded colors to use CSS variables, then updating the color hierarchy in the design tokens.

---

## Color Hierarchy Changes

### Before

| Role | Color | Hex |
|------|-------|-----|
| Primary accent (buttons, CTAs) | Terracotta | `#c67139` |
| Links | Terracotta | `#c67139` |
| Secondary colors | Sage, Mist, Blush | Various |

### After

| Role | Color | Hex |
|------|-------|-----|
| Primary accent (buttons, CTAs) | Sage | `#7a8a5e` |
| Links | Mist | `#7f93a5` |
| Link hover | Mist (darker) | `#4b5c69` |
| Tertiary accent (warnings, cooking) | Terracotta | `#c67139` |
| People/social accents | Blush | `#d17c7e` |

---

## CSS Design Token Changes

### Updated Variables

| Variable | Old Value | New Value |
|----------|-----------|-----------|
| `--color-accent` | `#c67139` (Terracotta) | `#7a8a5e` (Sage) |
| `--color-accent-2` | `#7f93a5` (Mist) | `#7f93a5` (Mist - unchanged) |

### New Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `--color-accent-tertiary` | `#c67139` | Terracotta for cooking-specific accents and warnings |

### Link Styles

```css
a {
  color: var(--color-mist-600);  /* #647787 */
}
a:hover {
  color: var(--color-mist-700);  /* #4b5c69 */
}
```

---

## New Semantic CSS Classes

### Status Badges

| Class | Background | Text | Usage |
|-------|------------|------|-------|
| `.badge-draft` | `--color-terracotta-100` | `--color-terracotta-800` | Draft recipe indicator |
| `.badge-published` | `--color-accent-100` | `--color-accent-800` | Published recipe indicator |
| `.badge-new` | `--color-mist-100` | `--color-mist-800` | New recipe form |
| `.badge-edit` | `--color-mist-100` | `--color-mist-800` | Edit recipe form |

Small variants: `.badge-draft-sm`, `.badge-published-sm`

### Callout Sections

| Class | Background | Border | Usage |
|-------|------------|--------|-------|
| `.callout-info` | `--color-mist-100` | None | Informational tips |
| `.callout-warning` | `--color-terracotta-100` | `--color-terracotta-300` | Warning messages |
| `.callout-error` | `--color-blush-100` | None | Error messages |
| `.callout-success` | `--color-accent-100` | None | Success messages |

### Confidence Indicators (Import Feature)

| Class | Background Color | Confidence Level |
|-------|------------------|------------------|
| `.confidence-good` | `--color-accent-600` (Sage) | High confidence |
| `.confidence-medium` | `--color-terracotta-500` | Medium confidence |
| `.confidence-low` | `--color-blush-600` | Low confidence |

### Photo Placeholders

| Class | Style | Usage |
|-------|-------|-------|
| `.photo-placeholder` | Solid `--color-neutral-200` | Simple placeholder |
| `.photo-placeholder-pattern` | Diagonal stripe pattern | Patterned placeholder |

---

## Files Modified

### CSS

| File | Changes |
|------|---------|
| `public/css/styles.css` | Updated design tokens; added semantic component classes |

### EJS Templates

| File | Changes |
|------|---------|
| `views/recipes/view.ejs` | Replaced inline colors with CSS classes |
| `views/recipes/public-view.ejs` | Replaced inline colors with CSS classes |
| `views/recipes/new.ejs` | Replaced badge, photo preview, tips colors |
| `views/recipes/edit.ejs` | Replaced badge, photo preview, tips colors |
| `views/recipes/index.ejs` | Replaced photo placeholder, status badges |
| `views/recipes/import.ejs` | Replaced error/warning section colors |
| `views/partials/import-modal.ejs` | Replaced hardcoded colors |

### JavaScript

| File | Changes |
|------|---------|
| `public/js/import.js` | Uses CSS class toggles instead of inline colors |
| `public/js/recipe-form.js` | Uses CSS variable for photo preview background |

---

## Refactoring Details

### Replaced Hardcoded Colors

| Original Hex | Semantic Purpose | Replacement |
|--------------|------------------|-------------|
| `#f8d7da` | Error background | `.callout-error` |
| `#721c24` | Error text | `var(--color-blush-800)` |
| `#d4edda` | Success background | `.callout-success` |
| `#155724` | Success text | `var(--color-accent-800)` |
| `#f5f5f5` | Neutral background | `var(--color-neutral-200)` |
| `#e8f4f8` | Info background | `.callout-info` |
| `#fff3cd` | Warning background | `.callout-warning` |
| `#28a745` | Success green | `var(--color-accent-600)` |
| `#dc3545` | Error red | `var(--color-blush-600)` |

---

## Visual Impact

### Elements Using Sage (Primary)

- Primary buttons (`.btn-primary`)
- Navigation brand highlight
- Active navigation items
- Form focus states
- Selection highlight
- Success states
- Published badge backgrounds

### Elements Using Mist (Links/Info)

- Text links (default and hover)
- Info callout sections
- New/Edit badges
- Secondary actions

### Elements Using Terracotta (Tertiary)

- Warning callouts
- Draft badges
- Medium confidence indicators
- Cooking-specific accents (future use)

### Elements Using Blush (Accents)

- Error states and callouts
- Low confidence indicators
- People/social features

---

## Testing

All 71 tests pass after the color theme update.

### Visual Verification Checklist

- [x] Primary buttons render in Sage green
- [x] Links display in Mist blue with darker hover
- [x] Status badges (draft/published) use correct semantic colors
- [x] Callout sections (info/warning/error/success) display correctly
- [x] Import confidence indicators show proper color coding
- [x] Photo placeholders use neutral backgrounds
- [x] Cream background maintained throughout
- [x] Visual hierarchy is clear and consistent

---

## Deployment Notes

This is a CSS-only change with no deployment requirements beyond deploying the updated files. No environment variables, database migrations, or external service configuration needed.

---

## Acceptance Criteria

- [x] No hardcoded hex colors remain in EJS templates
- [x] No hardcoded hex colors remain in JavaScript files
- [x] Primary buttons use Sage (#7a8a5e) as the main color
- [x] Links use Mist (#7f93a5) for hover/active states
- [x] Terracotta remains available for cooking-specific accents
- [x] Blush remains available for people/social accents
- [x] Cream background maintained throughout
- [x] All pages render correctly with new color scheme
- [x] Visual hierarchy is clear and consistent

---

## Related Pages

- [Potluck Brand Design System]
- [REW-42: Brand Account Emails] (Note: Email templates still use Terracotta for buttons per brand guidelines for external communications)

---

**Last Updated:** 2026-08-21
**Author:** Documentation Team
