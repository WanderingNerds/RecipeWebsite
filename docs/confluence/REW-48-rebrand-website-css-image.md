# REW-48: Rebrand Website CSS/Image - Potluck Brand Theme Redesign

**Space:** Recipe Website
**Status:** Complete
**Jira Issue:** [REW-48]

---

## Overview

This page documents the complete visual rebrand of the Potluck website (REW-48). The redesign implements a cohesive brand theme featuring a dark olive hero section, oat milk/vanilla page backgrounds, wavy SVG dividers, and feature cards with colored accents. The implementation consolidates the design system into CSS custom properties for maintainability.

---

## Summary

The website has been completely redesigned with the Potluck brand identity:

- **Hero Section:** Dark olive background (#4f5c3f) with cream text and botanical vine decorations
- **Page Backgrounds:** Oat milk/vanilla (#faf5ea) for warm, inviting feel
- **Navigation:** Dark olive navbar matching the hero, with cream text
- **Feature Cards:** Cards with colored left borders and circular icons using three accent colors
- **Wavy Divider:** SVG wave transition between hero and content sections
- **Typography:** Caprasimo for headings, Figtree for body text

---

## Visual Design System

### Core Color Palette

| Token | Hex Value | CSS Variable | Usage |
|-------|-----------|--------------|-------|
| Olive Grove 800 | `#4f5c3f` | `--potluck-olive-800` | Hero background, navbar, brand elements |
| Olive Grove 900 | `#39442f` | `--potluck-olive-900` | Hover states, headings |
| Olive Grove 950 | `#2e3426` | `--potluck-olive-950` | Primary text color |
| Oat Milk | `#f4ebdd` | `--potluck-oat-milk` | Text on dark backgrounds |
| Vanilla | `#faf5ea` | `--potluck-vanilla` | Page background |
| Paper | `#fffaf1` | `--potluck-paper` | Card surfaces |
| Sage Whisper | `#aeb7a0` | `--potluck-sage-400` | Decorative elements, muted text |

### Accent Color Palettes

#### Olive/Sage (Collect feature)

| Token | Hex Value | CSS Variable |
|-------|-----------|--------------|
| Olive 700 | `#657252` | `--potluck-olive-700` |
| Sage 100 | `#e9ece3` | `--potluck-sage-100` |

#### Misty Sky/Blue (Scale feature)

| Token | Hex Value | CSS Variable |
|-------|-----------|--------------|
| Blue 700 | `#506b80` | `--potluck-blue-700` |
| Blue 500 | `#7890a4` | `--potluck-blue-500` |
| Blue 100 | `#e4ebef` | `--potluck-blue-100` |

#### Rosewood/Blush (Notes feature)

| Token | Hex Value | CSS Variable |
|-------|-----------|--------------|
| Pink 700 | `#955663` | `--potluck-pink-700` |
| Pink 500 | `#b56f78` | `--potluck-pink-500` |
| Pink 100 | `#f4e4e4` | `--potluck-pink-100` |

#### Terracotta/Orange (Action color)

| Token | Hex Value | CSS Variable |
|-------|-----------|--------------|
| Orange 700 | `#934020` | `--potluck-orange-700` |
| Orange 600 | `#b25531` | `--potluck-orange-600` |
| Orange 500 | `#c66f47` | `--potluck-orange-500` |

---

## Typography

| Element | Font | CSS Variable | Weight |
|---------|------|--------------|--------|
| Display/Headings | Caprasimo | `--font-display`, `--font-heading` | 400 |
| Body text | Figtree | `--font-body` | 400, 600, 700 |

### Font Sizes

| Token | Value | Usage |
|-------|-------|-------|
| `--text-hero` | `clamp(2.75rem, 5vw, 5.25rem)` | Hero headline |
| `--text-2xl` | `clamp(2rem, 3vw, 3rem)` | Section headings |
| `--text-xl` | `clamp(1.35rem, 1.6vw, 1.7rem)` | Feature card headings |
| `--text-lg` | `1.125rem` | Large body text |
| `--text-base` | `1rem` | Default body text |
| `--text-sm` | `0.875rem` | Small text |
| `--text-xs` | `0.75rem` | Badges, labels |

---

## Component Specifications

### Hero Section

```css
.hero {
  background: radial-gradient(circle at 50% 20%, rgba(125, 138, 101, 0.28), transparent 42%),
              var(--potluck-olive-800);
  min-height: 38rem;
  padding: clamp(5rem, 10vw, 9rem) 1rem;
}
```

Features:
- Radial gradient overlay for depth
- SVG botanical vine decorations (pseudo-elements)
- Centered content with max-width 52rem
- Cream text on dark background

### Wavy Divider

The wavy divider creates a smooth transition from the hero to the content section:

```html
<div class="hero-wave">
  <svg viewBox="0 0 1440 120" fill="none" preserveAspectRatio="none">
    <path d="M0 120L48 108C96 96 192 72 288 66..." fill="#faf5ea"/>
  </svg>
</div>
```

### Feature Cards

| Variant | Left Border Color | Icon Background | CSS Class |
|---------|------------------|-----------------|-----------|
| Collect (Sage) | `--potluck-olive-700` | `--potluck-sage-100` | `.feature-card--collect` |
| Scale (Mist) | `--potluck-blue-700` | `--potluck-blue-100` | `.feature-card--scale` |
| Notes (Blush) | `--potluck-pink-700` | `--potluck-pink-100` | `.feature-card--notes` |

Structure:
- 0.45rem colored left border accent
- 5rem circular icon container
- Grid layout with icon and content columns
- Rounded corners (radius-lg)
- Medium shadow elevation

### Dark Olive Navbar

```css
.navbar {
  background: var(--potluck-olive-800);
  color: var(--potluck-oat-milk);
  border-bottom: 1px solid rgba(244, 235, 221, 0.17);
}
```

Features:
- Sticky positioning
- Three-column grid layout (brand, search, nav)
- Cream text for links and brand
- Terracotta underline on hover/active states
- Responsive collapsing for mobile

---

## Spacing System

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4.4px | Tight spacing |
| `--space-2` | 8.8px | Small gaps |
| `--space-3` | 13.2px | Form gaps |
| `--space-4` | 17.6px | Card padding |
| `--space-6` | 26.4px | Section gaps |
| `--space-8` | 35.2px | Large spacing |
| `--space-section-desktop` | 72px | Section padding (desktop) |
| `--space-section-mobile` | 44px | Section padding (mobile) |

---

## Shape Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 0.65rem | Buttons, badges |
| `--radius-md` | 1rem | Cards, inputs |
| `--radius-lg` | 1.4rem | Feature cards |
| `--radius-pill` | 999px | Pill buttons, tags |
| `--radius-card` | 32px | Major cards |

---

## Files Modified

| File | Changes |
|------|---------|
| `public/css/styles.css` | Complete Potluck design system tokens, hero styles, feature cards, navbar (~2400 lines) |
| `views/home.ejs` | New hero section with search, wavy divider, feature cards |
| `views/partials/navbar.ejs` | Updated for dark olive background styling |
| `views/layouts/main.ejs` | Conditional `home-main` class for home page layout |
| `src/routes/index.js` | Added `isHomePage` flag for conditional layout |

---

## Semantic Color Mappings

| Semantic Role | CSS Variable | Resolves To |
|---------------|--------------|-------------|
| Page background | `--color-page` | `--potluck-vanilla` |
| Surface (cards) | `--color-surface` | `--potluck-paper` |
| Brand color | `--color-brand` | `--potluck-olive-800` |
| Action color | `--color-action` | `--potluck-orange-600` |
| Focus ring | `--color-focus` | `--potluck-blue-500` |
| Favorite | `--color-favorite` | `--potluck-pink-700` |
| Info | `--color-info` | `--potluck-blue-700` |
| Text | `--color-text` | `--potluck-olive-950` |
| Text (on dark) | `--color-text-light` | `--potluck-oat-milk` |

---

## Button Variants

| Variant | Class | Background | Text Color |
|---------|-------|------------|------------|
| Primary | `.btn-primary` | Terracotta | White |
| Secondary | `.btn-secondary` | Transparent | Text |
| Outline Light | `.btn-outline-light` | Transparent | Cream |
| Olive | `.btn-olive` | Olive 800 | Cream |
| Ghost | `.btn-ghost` | Transparent | Action |
| Blush | `.btn-blush` | Blush 700 | Background |
| Mist | `.btn-mist` | Mist 700 | Background |

---

## Responsive Behavior

### Mobile Breakpoints

| Breakpoint | Changes |
|------------|---------|
| `max-width: 52rem` | Navbar search moves to second row |
| `max-width: 768px` | Navbar stacks vertically, reduced typography |
| `max-width: 36rem` | Hero stacks vertically, feature cards single column |

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
  }
}
```

---

## Home Page Layout

The home page uses a special layout class to remove default padding:

```ejs
<main class="<%= isHomePage ? 'home-main' : 'container' %>">
```

This allows the hero section to extend edge-to-edge while other pages maintain container constraints.

---

## Testing

All 71 existing tests pass. Visual verification completed across:

- Home page hero and feature sections
- Navigation bar on all pages
- Responsive breakpoints
- Dark mode compatibility (future consideration)

---

## Deployment

No special deployment steps required. Standard deployment of updated CSS and template files.

### Environment Variables

No new environment variables introduced.

### Database Changes

None.

---

## Browser Compatibility

Tested and verified in:
- Chrome 120+
- Firefox 120+
- Safari 17+
- Edge 120+

Modern CSS features used:
- CSS custom properties (variables)
- `color-mix()` function
- `clamp()` for fluid typography
- CSS Grid and Flexbox
- `aspect-ratio` property

---

## Future Considerations

- Dark mode theme variant
- Additional feature card color variants
- Animation enhancements for hero section
- Logo integration in navbar (currently using brand mark)

---

## Related Pages

- [REW-44: Update Website Color Theme]
- [Potluck Brand Design System]
- [Typography Guidelines]

---

**Last Updated:** 2026-08-21
**Author:** Documentation Team
