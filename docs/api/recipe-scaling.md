# Recipe Scaling API

## Overview

The Recipe Scaling API enables real-time ingredient scaling for recipes. It calculates scaled ingredient amounts based on a target number of servings or a scale factor, returning JSON data suitable for dynamic UI updates.

---

## Endpoint

### GET /recipes/:id/scale

Returns scaled ingredient data for a recipe.

**URL Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | UUID | Yes | The recipe ID |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `servings` | number | No | Target number of servings (preferred) |
| `scale` | number | No | Direct scale factor (fallback) |

**Notes:**
- If both `servings` and `scale` are provided, `servings` takes precedence
- If neither is provided, the recipe displays at its original scale (factor = 1)
- The `servings` parameter only works for recipes with a parseable servings count
- Scale factors are clamped between 0.05 and 50

---

## Authentication

**Required:** Yes

This endpoint requires authentication via the `requireAuth` middleware. The user must have a valid session cookie.

**Error Response (401):**
```json
{
  "error": "Authentication required"
}
```

---

## Request Examples

### Scale by servings
```
GET /recipes/123e4567-e89b-12d3-a456-426614174000/scale?servings=8
```

### Scale by factor
```
GET /recipes/123e4567-e89b-12d3-a456-426614174000/scale?scale=2
```

### Reset to original
```
GET /recipes/123e4567-e89b-12d3-a456-426614174000/scale
```

---

## Response

### Success (200 OK)

```json
{
  "ingredientRows": [
    {
      "raw": "2 cups all-purpose flour",
      "type": "ingredient",
      "quantity": 4,
      "quantityMax": null,
      "quantityText": "2",
      "unit": "cup",
      "unitText": "cups",
      "unitType": "volume",
      "unitIsAbbreviation": false,
      "ingredient": "all-purpose flour",
      "note": null,
      "scalable": true,
      "grams": 500,
      "gramsText": "500g",
      "measureText": "4 cups",
      "primaryAmount": "4 cups",
      "secondaryAmount": "500g",
      "scaled": true
    },
    {
      "raw": "For the frosting:",
      "type": "section",
      "quantity": null,
      "quantityMax": null,
      "quantityText": null,
      "unit": null,
      "unitText": null,
      "unitType": null,
      "unitIsAbbreviation": false,
      "ingredient": "For the frosting",
      "note": null,
      "scalable": false,
      "grams": null,
      "gramsText": "",
      "measureText": "",
      "primaryAmount": "",
      "secondaryAmount": "",
      "scaled": false
    },
    {
      "raw": "Salt and pepper to taste",
      "type": "ingredient",
      "quantity": null,
      "quantityMax": null,
      "quantityText": null,
      "unit": null,
      "unitText": null,
      "unitType": null,
      "unitIsAbbreviation": false,
      "ingredient": "Salt and pepper",
      "note": "to taste",
      "scalable": false,
      "grams": null,
      "gramsText": "",
      "measureText": "",
      "primaryAmount": "",
      "secondaryAmount": "",
      "scaled": false
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

### Response Fields

#### ingredientRows[]

| Field | Type | Description |
|-------|------|-------------|
| `raw` | string | Original ingredient line as entered |
| `type` | "ingredient" \| "section" | Row type (section headers vs ingredients) |
| `quantity` | number \| null | Scaled numeric quantity (lower bound if range) |
| `quantityMax` | number \| null | Upper bound for ranges (e.g., "2-3 cups") |
| `quantityText` | string \| null | Original quantity as written |
| `unit` | string \| null | Canonical unit name (singular) |
| `unitText` | string \| null | Unit as originally written |
| `unitType` | string \| null | volume, weight, count, length, or approximate |
| `unitIsAbbreviation` | boolean | Whether the unit was abbreviated (tsp vs teaspoon) |
| `ingredient` | string | Ingredient name |
| `note` | string \| null | Preparation notes (e.g., "finely chopped") |
| `scalable` | boolean | Whether this row can be scaled |
| `grams` | number \| null | Weight in grams (if calculable) |
| `gramsText` | string | Formatted grams display (e.g., "250g") |
| `measureText` | string | Practical measurement (e.g., "1 cup + 2 tbsp") |
| `primaryAmount` | string | Primary display amount: the practical kitchen measurement (e.g., "4 cups") if one exists, else grams |
| `secondaryAmount` | string | Secondary display amount: grams, shown only when a practical measurement is the primary amount (empty otherwise — never duplicates grams as both primary and secondary) |
| `scaled` | boolean | Whether this row was scaled from original |

> **Note:** As of REW-45, the practical kitchen measurement is always the
> `primaryAmount` and grams (when known) are the `secondaryAmount`. This is a
> fixed default — there is currently no user-facing toggle to switch which
> measurement system leads.

#### scaling

| Field | Type | Description |
|-------|------|-------------|
| `factor` | number | Scale multiplier applied |
| `factorText` | string | Display-friendly factor (e.g., "1 1/2") |
| `isScaled` | boolean | True if factor is not 1 |
| `baseServings` | number \| null | Original servings from recipe |
| `targetServings` | number \| null | Scaled servings count |
| `targetServingsText` | string | Display-friendly target servings |
| `canScaleByServings` | boolean | Whether servings-based scaling is available |
| `stepDownServings` | number \| null | Suggested value for "minus" button |
| `stepUpServings` | number \| null | Suggested value for "plus" button |

---

## Error Responses

### Recipe Not Found (404)
```json
{
  "error": "Recipe not found"
}
```

### Server Error (500)
```json
{
  "error": "An unexpected error occurred"
}
```

---

## Client-Side Integration

### JavaScript Example

```javascript
async function scaleRecipe(recipeId, servings) {
  const response = await fetch(`/recipes/${recipeId}/scale?servings=${servings}`);

  if (!response.ok) {
    throw new Error('Failed to scale recipe');
  }

  const data = await response.json();

  // Update ingredients display
  data.ingredientRows.forEach(row => {
    if (row.type === 'section') {
      // Render section header
      console.log(`== ${row.ingredient} ==`);
    } else {
      // Render ingredient
      console.log(`${row.primaryAmount} ${row.ingredient}`);
      if (row.secondaryAmount) {
        console.log(`  (${row.secondaryAmount})`);
      }
    }
  });

  // Update URL without page reload
  const url = new URL(window.location);
  url.searchParams.set('servings', data.scaling.targetServings);
  window.history.replaceState({}, '', url);
}
```

### URL State Management

The client should update the browser URL to reflect the current scale state, enabling:
- Bookmarking scaled recipes
- Sharing links with specific serving sizes
- Maintaining state on page refresh

```javascript
// Update URL
window.history.replaceState({}, '', `?servings=${scaling.targetServings}`);

// Or with scale factor
window.history.replaceState({}, '', `?scale=${scaling.factor}`);
```

---

## Scaling Logic

### How Scaling Works

1. **Parse servings**: Extract numeric servings from recipe's free-text servings field
2. **Calculate factor**: Divide target servings by base servings (or use direct scale)
3. **Clamp factor**: Keep within 0.05x to 50x safety bounds
4. **Scale quantities**: Multiply all numeric quantities by factor
5. **Convert to grams**: When possible, express amounts in grams for accuracy
6. **Format for display**: Convert back to practical measurements

### Scaling Modes

**Servings Mode** (preferred):
- Used when recipe has a parseable servings count (e.g., "Serves 4")
- UI shows serving count that can be adjusted with +/- buttons
- URL uses `?servings=X`

**Scale Factor Mode** (fallback):
- Used when servings cannot be parsed
- UI shows quick scale buttons (0.5x, 1x, 2x, 3x)
- URL uses `?scale=X`

### Non-Scalable Ingredients

Some ingredients cannot be meaningfully scaled:
- Section headers (e.g., "For the sauce:")
- Ingredients without quantities (e.g., "Salt and pepper to taste")
- Approximate amounts (e.g., "a pinch of salt")

These pass through unchanged with `scalable: false`.

---

## Related Documentation

- [Ingredient Parser](../../src/utils/ingredientParser.js) - Parsing logic
- [Ingredient Scaler](../../src/utils/ingredientScaler.js) - Scaling logic
- [Measurements](../../src/utils/measurements.js) - Unit conversions
- [Release Notes](../RELEASE_NOTES_REW-11.md) - Feature overview
