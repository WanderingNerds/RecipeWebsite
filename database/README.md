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

4. **Verify the Setup**
   - Go to "Table Editor" in the left sidebar
   - You should see the following tables:
     - `recipes`
     - `categories`
     - `tags`
     - `recipe_categories`
     - `recipe_tags`

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

---

## Notes

- The `status` field defaults to 'draft' and accepts 'draft' or 'published'
- The `difficulty` field accepts 'Easy', 'Medium', or 'Hard'
- The `updated_at` field on recipes is automatically updated via a trigger
- Tags with the same slug can exist for different users (unique per user_id)
- All foreign keys use CASCADE delete for referential integrity

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
