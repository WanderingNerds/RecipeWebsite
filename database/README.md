# Database Setup

## Running the Migrations

To set up the database in your Supabase project, follow these steps:

1. **Open Supabase Dashboard**
   - Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
   - Select your project

2. **Navigate to SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New query"

3. **Run the Migrations**
   Run each migration file in order by copying the contents, pasting into the SQL editor, and clicking "Run":

   | Order | Migration File | Description |
   |-------|---------------|-------------|
   | 1 | `001_create_recipes_table.sql` | Main recipes table |
   | 2 | `002_add_thumbnail_url.sql` | Thumbnail support |
   | 3 | `003_create_categories_table.sql` | Categories table with 10 pre-seeded categories |
   | 4 | `004_create_tags_table.sql` | User-owned tags table |
   | 5 | `005_create_recipe_categories_table.sql` | Recipe-categories junction table |
   | 6 | `006_create_recipe_tags_table.sql` | Recipe-tags junction table |
   | 7 | `007_add_source_url_column.sql` | Adds `source_url` to recipes (import provenance) |
   | 8 | `008_create_recipe_likes_table.sql` | Recipe-likes junction table with RLS + `get_recipe_like_count()` helper (REW-21) |

4. **Verify the Setup**
   - Go to "Table Editor" in the left sidebar
   - You should see the following tables:
     - `recipes`
     - `categories`
     - `tags`
     - `recipe_categories`
     - `recipe_tags`
     - `recipe_likes`

---

## Tables

### recipes

The main recipes table with the following columns:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary Key |
| `user_id` | UUID | Foreign Key to auth.users |
| `title` | TEXT | Recipe title |
| `author` | TEXT | Recipe author |
| `prep_time` | TEXT | Preparation time |
| `cook_time` | TEXT | Cooking time |
| `servings` | TEXT | Number of servings (free text, parsed for scaling) |
| `difficulty` | TEXT | Easy, Medium, or Hard |
| `ingredients` | TEXT | Free-text ingredients (one per line) |
| `instructions` | TEXT | Cooking instructions |
| `notes` | TEXT | Additional notes |
| `photo_url` | TEXT | Base64-encoded main photo |
| `thumbnail_url` | TEXT | Base64-encoded thumbnail |
| `status` | TEXT | draft or published |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp (auto-updated) |

### categories

System-wide pre-defined recipe categories (10 seeded):

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary Key |
| `name` | TEXT | Display name (e.g., "Breakfast") |
| `slug` | TEXT | URL-friendly identifier (unique) |
| `description` | TEXT | Optional description |
| `icon` | TEXT | Emoji icon |
| `display_order` | INTEGER | Sort order in UI |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

**Default Categories:**
1. Breakfast, 2. Lunch, 3. Dinner, 4. Appetizers, 5. Desserts, 6. Beverages, 7. Soups, 8. Salads, 9. Sides, 10. Baking

### tags

User-owned custom tags:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary Key |
| `name` | TEXT | Display name |
| `slug` | TEXT | URL-friendly identifier (unique per user) |
| `user_id` | UUID | Foreign Key to auth.users |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

### recipe_categories

Junction table linking recipes to categories (many-to-many):

| Column | Type | Description |
|--------|------|-------------|
| `recipe_id` | UUID | Foreign Key to recipes |
| `category_id` | UUID | Foreign Key to categories |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

**Primary Key:** Composite (recipe_id, category_id)

### recipe_tags

Junction table linking recipes to tags (many-to-many):

| Column | Type | Description |
|--------|------|-------------|
| `recipe_id` | UUID | Foreign Key to recipes |
| `tag_id` | UUID | Foreign Key to tags |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

**Primary Key:** Composite (recipe_id, tag_id)

### recipe_likes (REW-21)

Junction table recording which users have favorited/"liked" which recipes:

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID | Foreign Key to `auth.users` |
| `recipe_id` | UUID | Foreign Key to `recipes` |
| `created_at` | TIMESTAMPTZ | When the like was created (used to sort the Liked Recipes page by recency) |

**Primary Key:** Composite `(user_id, recipe_id)` — prevents a user from liking the same recipe twice.

**Helper function:** `get_recipe_like_count(p_recipe_id UUID) RETURNS INTEGER` — `SECURITY DEFINER`, granted to both `anon` and `authenticated`, so like counts can be read without a per-user session.

Consumed by `POST`/`DELETE`/`GET /api/likes/:recipeId` (`src/routes/likeRoutes.js`), the `/recipes/liked` page, the recipe detail view's like button, and — as of REW-55 — the My Recipes list view (`GET /recipes`), which batch-fetches this table for the current user's recipe IDs to render the favorite state on every card. See [Recipe Likes API](../docs/api/recipe-likes.md).

---

## Security

All tables include Row Level Security (RLS) policies:

### recipes
- Users can only view, create, update, and delete their own recipes
- All authenticated users can view published recipes (not just their own)
- Draft recipes are only visible to their creator

### categories
- All authenticated users can read categories
- Categories are system-managed (no user insert/update/delete)

### tags
- Users can only CRUD their own tags
- Tags are user-specific and not shared between users

### recipe_categories / recipe_tags
- Users can only manage associations for their own recipes
- Junction table policies verify recipe ownership via subquery

### recipe_likes (REW-21)
- SELECT/INSERT/DELETE all restricted to `user_id = auth.uid()` — a user can only view, create, or remove their own like rows
- No UPDATE policy (a like is binary; toggling is insert/delete, not update)
- Like *counts* are exposed publicly via the `get_recipe_like_count()` `SECURITY DEFINER` function, independent of the row-level SELECT policy above
- The API layer (`recipeExists()` in `src/routes/likeRoutes.js`), not RLS, is what restricts liking to `status = 'published'` recipes — RLS itself does not know about a recipe's status

---

## Indexes

Performance indexes are created on:
- `recipes.user_id` - Fast user queries
- `recipes.status` - Draft/published filtering
- `categories.slug` - Fast lookups by slug
- `categories.display_order` - Efficient sorting
- `tags.user_id` - Fast queries by user
- `tags.slug` - Fast lookups by slug
- `recipe_categories.recipe_id` / `category_id` - Junction lookups
- `recipe_tags.recipe_id` / `tag_id` - Junction lookups
- `recipe_likes.recipe_id` - Fast like-count queries
- `recipe_likes.user_id` - Fast "which recipes has this user liked" queries (My Recipes batch-fetch, Liked Recipes page)
- `recipe_likes.created_at` (descending) - Sorting the Liked Recipes page by recency

---

## Notes

- `recipes.author` has no database-level default. When it arrives blank/missing on create (manual entry or import), the application defaults it to the logged-in user's account display name in the route handler, not via a SQL default or trigger — see [Recipe Author Default (REW-46)](../docs/api/recipe-author-default.md). Editing an existing recipe does not retroactively apply this default.
- `recipes.prep_time` and `recipes.cook_time` remain nullable `TEXT` with no `NOT NULL` constraint, but the manual "New Recipe"/"Edit Recipe" forms and their `POST` handlers now require both to be non-blank before a save is accepted (REW-52) — enforcement is application-layer only (no migration, no backfill), because the Import Recipe flow (`POST /recipes/import/save`) can still legitimately save blank values and is unaffected. Note: on the create/edit forms only, `cook_time` is now labeled "Total Time" in the UI — the column itself was **not** renamed and there is no separate `total_time` column; see [Required Prep Time / Total Time (REW-52)](../docs/api/recipe-required-times.md) for the full rationale. The recipe detail views still display this same column as "Cook Time," a known naming inconsistency flagged as a non-blocking follow-up.
- The `status` field defaults to 'draft' and accepts 'draft' or 'published'
- The `difficulty` field accepts 'Easy', 'Medium', or 'Hard'
- The `updated_at` field on recipes is automatically updated via a trigger
- Tags with the same slug can exist for different users (unique per user_id)
- All foreign keys use CASCADE delete for referential integrity
- `recipe_likes` rows can only exist for `status = 'published'` recipes going forward — the API's `POST /api/likes/:recipeId` handler checks status before inserting — but this is enforced in the application layer, not by a database constraint or trigger. If a published recipe with existing likes is later reverted to draft, its `recipe_likes` rows are **not** automatically removed; the API's read paths (My Recipes card state, `/recipes/liked`, the detail page) still reflect them, they just can't be created fresh against a draft recipe. This edge case (draft-after-published-with-likes) was not in scope for REW-55 or REW-21 — flagging as a known gap, not a bug in either ticket.

---

## Rollback

To remove the categories and tags feature (if needed):

```sql
DROP TABLE IF EXISTS recipe_tags;
DROP TABLE IF EXISTS recipe_categories;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS categories;
```

**Warning:** This permanently deletes all category and tag data.
