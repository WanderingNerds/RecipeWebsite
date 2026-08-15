# Release Notes: REW-11 Recipe Scaling Engine

**Release Date:** 2026-08-14
**Branch:** REW-11-recipe-scaling-engine
**Version:** 1.2.0

---

## Summary

This release introduces instant recipe scaling without page reloads and a comprehensive recipe categories and tagging system. Users can now dynamically adjust recipe servings using interactive controls, and organize their recipes with pre-defined categories and custom tags.

---

## New Features

### 1. Instant Recipe Scaling Engine

Users can now scale recipe ingredients in real-time without page reloads.

**What's New:**
- **Interactive Servings Controls**: Plus (+) and minus (-) buttons to incrementally adjust servings
- **Direct Input**: Type a specific number of servings directly into the input field
- **Quick Scale Buttons**: One-click multipliers (0.5x, 1x, 2x, 3x) for recipes without parseable servings
- **Real-time Updates**: Ingredients update instantly via AJAX
- **URL State Management**: Scaled state is reflected in the URL for bookmarking and sharing
- **Professional-Grade Scaling**: Ingredients are converted to grams for accurate scaling, with practical measurements displayed (e.g., "1 cup + 2 tbsp" instead of "1.125 cups")

**Technical Highlights:**
- New API endpoint: `GET /recipes/:id/scale`
- Client-side JavaScript with progressive enhancement (falls back to page reloads if JS is disabled)
- Loading states with visual feedback
- Scale factor safety guards (0.05x to 50x range)

### 2. Recipe Categories and Tagging System

Organize recipes with system-wide categories and personal custom tags.

**What's New:**
- **10 Pre-defined Categories**: Breakfast, Lunch, Dinner, Appetizers, Desserts, Beverages, Soups, Salads, Sides, Baking
- **Custom Tags**: Create personal tags with autocomplete suggestions
- **Filtering**: Filter recipes by category and/or multiple tags on the recipe index page
- **Visual Badges**: Clickable category and tag badges on recipe cards and detail pages
- **Quick Navigation**: Click any badge to instantly filter recipes

**Technical Highlights:**
- 4 new database tables with Row Level Security (RLS)
- New API endpoints for categories and tags
- Tag autocomplete with debouncing
- Comma and Enter key support for tag input

---

## API Changes

### New Endpoint: Recipe Scaling

```
GET /recipes/:id/scale
```

**Authentication:** Required

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `servings` | number | Target number of servings |
| `scale` | number | Direct scale factor (e.g., 2 for double) |

**Response:**
```json
{
  "ingredientRows": [
    {
      "type": "ingredient",
      "quantity": 2,
      "unit": "cup",
      "ingredient": "flour",
      "primaryAmount": "250g",
      "secondaryAmount": "2 cups",
      "scaled": true
    }
  ],
  "scaling": {
    "factor": 2,
    "factorText": "2",
    "isScaled": true,
    "baseServings": 4,
    "targetServings": 8,
    "targetServingsText": "8",
    "canScaleByServings": true,
    "stepDownServings": 7,
    "stepUpServings": 9
  }
}
```

### Updated Endpoints

- `GET /recipes` - Now supports `category` and `tags` query parameters for filtering
- `GET /recipes/new` - Returns available categories and user tags
- `POST /recipes` - Accepts `categories` and `tags` form fields
- `GET /recipes/:id/edit` - Returns recipe with selected categories and tags
- `POST /recipes/:id/update` - Updates recipe categories and tags
- `GET /recipes/:id` - Returns recipe with populated categories and tags

### New API Endpoints for Categories and Tags

See [docs/CATEGORIES_AND_TAGS.md](CATEGORIES_AND_TAGS.md) for complete API documentation.

---

## Database Changes

### New Tables

| Table | Purpose |
|-------|---------|
| `categories` | System-wide recipe categories (10 pre-seeded) |
| `tags` | User-owned custom tags |
| `recipe_categories` | Junction table linking recipes to categories |
| `recipe_tags` | Junction table linking recipes to tags |

### Migrations Required

Run the following migrations in order:
1. `003_create_categories_table.sql`
2. `004_create_tags_table.sql`
3. `005_create_recipe_categories_table.sql`
4. `006_create_recipe_tags_table.sql`

All migrations include RLS policies and appropriate indexes.

---

## Files Changed

### Backend
| File | Change |
|------|--------|
| `src/routes/recipeRoutes.js` | Added `/recipes/:id/scale` endpoint, category/tag support |
| `src/routes/categoryRoutes.js` | New file - Categories API |
| `src/routes/tagRoutes.js` | New file - Tags API |
| `src/utils/ingredientScaler.js` | Recipe scaling logic |
| `src/utils/ingredientParser.js` | Ingredient parsing utilities |
| `src/utils/measurements.js` | Measurement conversion utilities |

### Frontend
| File | Change |
|------|--------|
| `public/js/main.js` | Instant scaling JavaScript |
| `public/js/tags-input.js` | Tag input with autocomplete |
| `public/css/styles.css` | Number input spinner removal, badge styles |
| `views/recipes/view.ejs` | Scaling controls UI |
| `views/recipes/index.ejs` | Filter bar, category/tag badges |
| `views/recipes/new.ejs` | Category and tag selection UI |
| `views/recipes/edit.ejs` | Category and tag selection UI |

### Database
| File | Description |
|------|-------------|
| `database/migrations/003_create_categories_table.sql` | Categories table with seed data |
| `database/migrations/004_create_tags_table.sql` | Tags table with RLS |
| `database/migrations/005_create_recipe_categories_table.sql` | Recipe-categories junction |
| `database/migrations/006_create_recipe_tags_table.sql` | Recipe-tags junction |

---

## Breaking Changes

**None.** This release is fully backward compatible.

---

## Deprecations

**None.**

---

## Known Limitations

1. **Scaling requires JavaScript**: Instant scaling requires JavaScript; falls back to page reloads if disabled
2. **No user-facing error messages**: API failures show console errors only
3. **Tag filtering is AND-based**: When filtering by multiple tags, recipes must have ALL selected tags

---

## Deployment Notes

### Prerequisites
- No new environment variables required
- No changes to Vercel configuration

### Deployment Steps
1. Run database migrations (003, 004, 005, 006) in Supabase SQL Editor
2. Deploy application code
3. Restart server to activate new API endpoint
4. Users should hard refresh (Ctrl+Shift+R) to load new JavaScript

### Rollback Plan
If issues arise:
1. Remove `/recipes/:id/scale` route from `recipeRoutes.js`
2. Revert `main.js` to remove scaling functions
3. CSS changes are harmless and can remain
4. Categories/tags tables can remain (feature degrades gracefully)

---

## Testing Performed

### Recipe Scaling
- Plus button increases servings without limit
- Minus button decreases servings (minimum: 1)
- Direct input updates instantly
- Quick scale buttons work for recipes without parseable servings
- Ingredients update without page reload
- URL updates to reflect current scale
- Page reload maintains scaled state
- Loading state displays during API calls

### Categories and Tags
- Category selection on create/edit forms
- Tag creation with autocomplete
- Filtering by category
- Filtering by multiple tags
- Clickable badges navigation
- Clear filters functionality

---

## Future Enhancements (Out of Scope)

- User-facing error messages for API failures
- More prominent loading indicator
- Debouncing for rapid button clicks
- Keyboard shortcuts (+ and - keys)
- Unit tests for JavaScript functions
- "Any" tag matching mode (vs current "all" mode)

---

## Contributors

- Claude Code AI Assistant

---

## Related Documentation

- [Categories and Tags System](CATEGORIES_AND_TAGS.md)
- [Implementation Notes](../IMPLEMENTATION_NOTES_REW-11.md)
- [Database README](../database/README.md)

---

**Jira Issue:** REW-11
**Status:** Complete and Tested
