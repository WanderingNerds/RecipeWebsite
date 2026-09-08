# Browse Recipes (REW-59)

`GET /browse?page=1` returns server-rendered HTML and requires no authentication. The route uses the anonymous Supabase client for both guests and signed-in users and explicitly filters recipes to `status = published`.

## Pagination and results

The optional `page` parameter is parsed as an integer; invalid or nonpositive values default to 1. Each page contains up to 12 recipes, newest first by `created_at`, with an exact total count. Empty results render the existing empty state. Database errors retain the error flash and redirect to `/`.

The listing selects card fields and embedded category/tag relationships in one query. Inaccessible or missing nested records are removed, and absent collections become empty arrays. It does not load recipe instructions or notes. This is an HTML route, not a new JSON API.

## Card content and controls

Browse and My Recipes use `views/partials/recipe-summary-card.ejs` for the same metadata order: thumbnail when present, title/status, author, categories, tags, separate prep/cook times, servings, difficulty, and creation date. Optional metadata is omitted when absent; all categories and tags are shown. Text is escaped by EJS, and long titles/tags wrap within the card.

Browse uses public `/r/:id` links and informational category/tag badges. It retains the signed-in/guest Meal Plan action and renders neither Edit/Delete nor private favorite controls, even for a signed-in recipe owner. My Recipes retains private links, filter badges, favorites, and View/Edit/Delete. Search continues to use the original public card partial.

## Deployment dependency

Apply `database/migrations/013_public_recipe_card_metadata.sql` after the preceding migrations. It adds SELECT policies for metadata associated with published recipes and preserves owner access and mutation policies. No new environment variables or endpoint parameters are introduced.

The migration has not been applied by this workflow. Staging policy checks and live end-to-end acceptance remain pending; see the [QA report](../qa/rew-59-browse-recipe-cards.md).
