# Database Setup

## Running the Migrations

To set up the recipes table in your Supabase database, follow these steps:

1. **Open Supabase Dashboard**
   - Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
   - Select your project

2. **Navigate to SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New query"

3. **Run the Migrations**
   - First, run `migrations/001_create_recipes_table.sql`
   - Then, run `migrations/002_add_thumbnail_url.sql`
   - Copy the contents of each file, paste into the SQL editor, and click "Run"

4. **Verify the Setup**
   - Go to "Table Editor" in the left sidebar
   - You should see a new table called "recipes"
   - The table should have the following columns:
     - `id` (UUID, Primary Key)
     - `user_id` (UUID, Foreign Key to auth.users)
     - `title` (TEXT)
     - `author` (TEXT)
     - `prep_time` (TEXT)
     - `cook_time` (TEXT)
     - `servings` (TEXT)
     - `difficulty` (TEXT)
     - `ingredients` (TEXT)
     - `instructions` (TEXT)
     - `notes` (TEXT)
     - `photo_url` (TEXT)
     - `thumbnail_url` (TEXT)
     - `status` (TEXT)
     - `created_at` (TIMESTAMPTZ)
     - `updated_at` (TIMESTAMPTZ)

## Security

The migration includes Row Level Security (RLS) policies:

- Users can only view, create, update, and delete their own recipes
- All authenticated users can view published recipes (not just their own)
- Draft recipes are only visible to their creator

## Notes

- The `status` field defaults to 'draft' and accepts 'draft' or 'published'
- The `difficulty` field accepts 'Easy', 'Medium', or 'Hard'
- The `updated_at` field is automatically updated via a trigger whenever a recipe is modified
