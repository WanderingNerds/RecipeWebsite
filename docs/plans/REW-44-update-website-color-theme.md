# REW-44: Update Website Color Theme

## Jira Issue
[REW-44](https://wanderingnerds.atlassian.net/browse/REW-44) - Update website color theme

**Description:** QA finding: Update the website theming so cream, blue, and green are the main colors. Pink and orange should remain available as additional accent colors.

## Summary

Update the Potluck design system color hierarchy so that **Sage (green)** and **Mist (blue)** become the primary UI colors alongside cream, while **Terracotta (orange)** and **Blush (pink)** remain available as accent colors for specific use cases.

### Current State
- Primary accent: Terracotta (#c67139) - used for buttons, links, CTAs
- Secondary colors: Sage, Mist, Blush used sparingly

### Target State
- Primary accent: Sage (#7a8a5e) - buttons, primary CTAs
- Secondary accent: Mist (#7f93a5) - links, info callouts, secondary actions
- Tertiary accents: Terracotta, Blush - special highlights, warnings, badges

## Two-Part Implementation

### Part 1: Refactor Inline Colors to Use CSS Variables
Before changing the color hierarchy, we need to ensure all hardcoded colors in templates use CSS variables. This prevents visual inconsistencies when we change the tokens.

**Files with hardcoded colors:**
- `views/recipes/view.ejs` - status badges, photo backgrounds, tips section
- `views/recipes/public-view.ejs` - same issues
- `views/recipes/new.ejs` - draft badge, photo preview, tips
- `views/recipes/edit.ejs` - edit badge, photo preview, tips
- `views/recipes/index.ejs` - photo placeholder, status badges
- `views/recipes/import.ejs` - error/warning states
- `public/js/import.js` - confidence indicator colors
- `public/js/recipe-form.js` - photo preview background

### Part 2: Update Color Hierarchy
After refactoring, update the CSS variables to implement the new color hierarchy.

## Tasks

### Phase 1: Add Semantic CSS Classes
1. Add semantic component classes to `styles.css`:
   - `.badge-draft`, `.badge-published` - status badges
   - `.callout-info`, `.callout-warning`, `.callout-error` - callout sections
   - `.confidence-good`, `.confidence-medium`, `.confidence-low` - import confidence
   - `.photo-placeholder` - photo placeholder backgrounds

### Phase 2: Refactor Templates
2. Refactor `views/recipes/view.ejs` - replace inline colors with CSS classes
3. Refactor `views/recipes/public-view.ejs` - same treatment
4. Refactor `views/recipes/new.ejs` - replace badge and photo preview colors
5. Refactor `views/recipes/edit.ejs` - replace badge and photo preview colors
6. Refactor `views/recipes/index.ejs` - replace status badge and placeholder colors
7. Refactor `views/recipes/import.ejs` - replace error/warning section colors
8. Refactor `views/partials/import-modal.ejs` - if any hardcoded colors
9. Refactor `public/js/import.js` - use CSS classes instead of inline backgroundColor
10. Refactor `public/js/recipe-form.js` - use CSS variable for photo preview

### Phase 3: Update Color Hierarchy
11. Update `styles.css` design tokens:
    - Change `--color-accent` from Terracotta to Sage
    - Add `--color-accent-tertiary` for Terracotta
    - Update legacy compatibility aliases
12. Update button styles to use Sage as primary
13. Update link styles to use Mist for hover/info states
14. Keep Terracotta for specific elements (cooking-related CTAs if needed)
15. Keep Blush for people/social features

### Phase 4: Visual Verification
16. Visual regression check across all affected pages

## Affected Files

### CSS (modifications)
| File | Changes |
|------|---------|
| `public/css/styles.css` | Add semantic classes; update color hierarchy; redefine `--color-accent` |

### EJS Templates (refactoring)
| File | Changes |
|------|---------|
| `views/recipes/view.ejs` | Replace inline colors with CSS classes |
| `views/recipes/public-view.ejs` | Same as view.ejs |
| `views/recipes/new.ejs` | Replace badge, photo preview, tips colors |
| `views/recipes/edit.ejs` | Replace badge, photo preview, tips colors |
| `views/recipes/index.ejs` | Replace photo placeholder, status badges |
| `views/recipes/import.ejs` | Replace error/warning section colors |
| `views/partials/import-modal.ejs` | Review and replace hardcoded colors |

### JavaScript (refactoring)
| File | Changes |
|------|---------|
| `public/js/import.js` | Use CSS class toggles instead of inline colors |
| `public/js/recipe-form.js` | Use CSS variable for photo preview |

## Color Mapping (Phase 1 - Refactoring)

| Hardcoded Color | Purpose | Replacement |
|-----------------|---------|-------------|
| `#f8d7da` | error background | `.callout-error` or `var(--color-blush-100)` |
| `#721c24` | error text | `var(--color-blush-800)` |
| `#d4edda` | success background | `.callout-success` or `var(--color-accent-2-100)` |
| `#155724` | success text | `var(--color-accent-2-800)` |
| `#f5f5f5` | neutral background | `var(--color-neutral-200)` |
| `#e8f4f8` | info background | `.callout-info` or `var(--color-mist-100)` |
| `#fff3cd` | warning background | `.callout-warning` or `var(--color-accent-100)` |
| `#28a745` | success green | `var(--color-accent-2-600)` |
| `#dc3545` | error red | `var(--color-blush-600)` |

## New Color Hierarchy (Phase 3)

| Role | Current | New |
|------|---------|-----|
| Primary buttons | Terracotta (#c67139) | Sage (#7a8a5e) |
| Links | Terracotta | Mist (#7f93a5) |
| Info callouts | - | Mist-100 |
| Success states | Sage | Sage (unchanged) |
| Warning states | - | Terracotta (accent) |
| Error states | - | Blush |
| Special CTAs | - | Terracotta (for cooking actions) |

## Database Changes

None required.

## Security Considerations

None - this is a purely cosmetic refactoring task.

## Acceptance Criteria

- [ ] No hardcoded hex colors remain in EJS templates
- [ ] No hardcoded hex colors remain in JavaScript files
- [ ] Primary buttons use Sage (#7a8a5e) as the main color
- [ ] Links use Mist (#7f93a5) for hover/active states
- [ ] Terracotta remains available for cooking-specific accents
- [ ] Blush remains available for people/social accents
- [ ] Cream background maintained throughout
- [ ] All pages render correctly with new color scheme
- [ ] Visual hierarchy is clear and consistent
