# Recipe Import Save API

**Ticket:** [REW-77](https://wanderingnerds.atlassian.net/browse/REW-77)  
**Route:** `POST /recipes/import/save`  
**Authentication:** Required  
**CSRF:** Protected by the application's global JSON CSRF handling

## Purpose

Saves a recipe after the authenticated user reviews parsed import content. The same endpoint handles draft and publish actions.

## Request

Send a JSON body containing the reviewed recipe fields. `title`, `instructions`, and `cookTime` must be non-blank strings. `action` selects draft or published status. Other existing import fields, including `prepTime`, remain optional.

```json
{
  "title": "Tomato Soup",
  "author": "Recipe Author",
  "description": "A simple soup",
  "ingredients": "Tomatoes\nStock",
  "instructions": "Simmer until tender.",
  "prepTime": "10 min",
  "cookTime": " 35 min ",
  "servings": "4",
  "sourceUrl": "https://example.com/tomato-soup",
  "action": "publish"
}
```

Valid Cook Time is trimmed before it is stored in `recipes.cook_time`. Both `draft` and `publish` actions require Cook Time.

## Cook Time validation

Missing, empty, and whitespace-only `cookTime` values return HTTP 400 before a Supabase client is created or a duplicate-title lookup or insert runs.

```json
{
  "error": "Cook Time is required"
}
```

Client-side import review validation provides immediate accessible feedback, but the route check is authoritative for direct requests.

## Success response

The route returns the existing success payload with the created recipe ID and an action-specific message.

```json
{
  "success": true,
  "recipeId": "recipe-id",
  "message": "Recipe imported and published!"
}
```

## Database and compatibility

No migration is required. `recipes.cook_time` remains nullable `TEXT` for historical compatibility; REW-77 adds application-layer enforcement for new import saves only. `recipes.prep_time` remains optional for imports.
