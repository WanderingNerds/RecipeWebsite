# REW-11: Recipe Scaling Engine - Implementation Notes

## Summary
Implemented instant recipe scaling without page reloads. Users can now adjust recipe servings using +/- buttons or direct input, with ingredients updating in real-time via AJAX.

## Problem Statement
- Recipe scaling previously required full page reloads when adjusting servings
- Number input had unwanted spinner arrows
- Scaling buttons didn't work beyond initial values (stuck at 5 servings)

## Solution Implemented

### 1. API Endpoint for Scaling
**File:** `src/routes/recipeRoutes.js`
**Lines:** 300-335

Created new GET endpoint `/recipes/:id/scale` that:
- Accepts `servings` or `scale` query parameters
- Returns JSON with scaled ingredients and scaling metadata
- Uses existing `parseIngredients`, `resolveScaling`, and `scaleIngredients` utilities
- Maintains authentication via `requireAuth` middleware

```javascript
// GET /recipes/:id/scale - API endpoint for instant scaling (returns JSON)
router.get("/:id/scale", requireAuth, async (req, res) => {
  // ... parses ingredients, resolves scaling, returns JSON
});
```

### 2. Client-Side Scaling JavaScript
**File:** `public/js/main.js`
**Lines:** 17-224

Implemented instant scaling with the following functions:

#### `initializeRecipeScaling()`
- Detects scale control elements on recipe pages
- Attaches click handlers to +/- and quick scale buttons
- Handles servings input form submission and change events
- Prevents default link navigation

#### `updateRecipeScale(recipeId, params)`
- Fetches scaled data from API endpoint
- Shows loading state (opacity fade)
- Updates DOM with new ingredient amounts
- Updates URL without page reload using `history.replaceState`
- Coordinates all UI updates

#### `updateIngredientsDisplay(ingredientRows)`
- Rebuilds ingredient list from JSON data
- Handles both section headers and ingredient rows
- Displays primary amounts (grams) and secondary amounts (practical measurements)
- Preserves ingredient notes

#### `updateServingsDisplay(scaling)`
- Updates the servings input value to match current scale

#### `updateServingsButtons(recipeId, scaling)`
- **Critical Fix:** Updates +/- button hrefs dynamically
- Prevents buttons from getting stuck at initial values
- Uses `stepUpServings` and `stepDownServings` from scaling data

#### `updateQuickScaleButtons(currentFactor)`
- Updates active state styling for quick scale buttons (½×, 1×, 2×, 3×)
- Visual feedback for current scale factor

### 3. CSS Improvements
**File:** `public/css/styles.css`
**Lines:** 451-458

Added CSS to hide number input spinner arrows:
```css
/* Hide number input spinner arrows */
.scale-servings-input::-webkit-outer-spin-button,
.scale-servings-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.scale-servings-input[type=number] {
  -moz-appearance: textfield;
}
```

## Technical Details

### How It Works
1. User interacts with scale controls (clicks +/-, types number, or clicks quick scale)
2. JavaScript intercepts the action and prevents default navigation
3. AJAX request sent to `/recipes/:id/scale` with servings or scale parameter
4. Server processes request using existing scaling utilities
5. JSON response contains scaled ingredient rows and scaling metadata
6. Client updates DOM:
   - Ingredient amounts
   - Servings input value
   - Button hrefs (for next click)
   - URL (for bookmarking/sharing)
   - Active button styling

### Key Architectural Decisions
- **Server-side scaling logic preserved:** All calculations remain in Node.js using existing utilities
- **Progressive enhancement:** Page still works with JavaScript disabled (falls back to full page reloads)
- **URL state management:** Uses `history.replaceState` to update URL without navigation
- **Dynamic button updates:** Critical for allowing unlimited scaling range

### Browser Compatibility
- Uses `fetch` API (IE11+ with polyfill if needed)
- Uses `URLSearchParams` (modern browsers)
- CSS uses vendor prefixes for input spinner removal

## Files Modified

1. **src/routes/recipeRoutes.js** - Added `/recipes/:id/scale` API endpoint
2. **public/js/main.js** - Implemented instant scaling client-side logic
3. **public/css/styles.css** - Removed number input spinner arrows

## Testing Performed

### Manual Testing
✅ Plus button increases servings without limit
✅ Minus button decreases servings (min: 1)
✅ Direct input in servings box updates instantly
✅ Quick scale buttons (½×, 1×, 2×, 3×) work for recipes without parseable servings
✅ Ingredients update instantly without page reload
✅ URL updates to reflect current scale
✅ Page reload maintains scaled state from URL
✅ No console errors
✅ Loading state shows during API call

### Edge Cases Handled
- Servings cannot go below 1
- Scale factor clamped between 0.05× and 50× (existing safety guards)
- Graceful fallback if API call fails (console error only)
- Works for both servings mode and scale factor mode
- Handles recipes with and without parseable servings text

## Known Limitations
- Requires JavaScript enabled for instant updates
- Single error shown in console if API fails (no user-facing error message yet)
- Loading state is subtle (opacity fade only)

## Future Enhancements (Out of Scope)
- Add user-facing error messages for API failures
- Add more prominent loading indicator
- Add debouncing for rapid button clicks
- Consider adding keyboard shortcuts (+ and - keys)
- Add unit tests for JavaScript functions

## Dependencies
- No new dependencies added
- Uses existing Express routes, Supabase client, and scaling utilities
- Relies on existing authentication middleware

## Deployment Notes
- No database migrations required
- No environment variable changes
- Server restart required to activate new API endpoint
- Clients should hard refresh (Ctrl+Shift+R) to load new JavaScript
- No breaking changes to existing functionality

## Rollback Plan
If issues arise, can be rolled back by:
1. Removing the `/recipes/:id/scale` route from recipeRoutes.js
2. Reverting main.js to remove `initializeRecipeScaling()` and related functions
3. Keeping CSS changes (harmless)

Original page reload behavior would resume.

---

**Implemented by:** Claude Code
**Date:** 2026-08-12
**Branch:** REW-11-recipe-scaling-engine
**Status:** ✅ Complete and tested
