# Recipe Categories and Tagging System

## Feature Overview

The Recipe Categories and Tagging system provides users with powerful organization and filtering capabilities for their recipe collection.

### Categories
- **Pre-defined, system-wide categories** that all users share
- Each recipe can belong to multiple categories
- Categories have icons for visual identification
- Used for broad classification (e.g., Breakfast, Dinner, Desserts)

### Tags
- **User-defined, custom tags** unique to each user
- Each recipe can have multiple tags
- Tags are personal and not shared between users
- Used for flexible, personal organization (e.g., "Quick Meals", "Mom's Recipes", "Holiday Favorites")

### Key Benefits
- **Better Organization**: Categorize recipes by meal type and add custom tags
- **Easy Filtering**: Find recipes quickly using category or tag filters
- **Autocomplete**: Previously used tags appear as suggestions
- **Visual Badges**: Categories and tags display as clickable badges on recipe cards

---

## Database Schema

### Tables Overview

The feature introduces 4 new tables:

```
categories (system-wide, read-only for users)
    |
    +--- recipe_categories (many-to-many junction)
    |           |
    +-----+-----+
          |
       recipes
          |
    +-----+-----+
    |           |
    +--- recipe_tags (many-to-many junction)
    |
tags (user-owned, full CRUD)
```

### 1. `categories` Table

Stores pre-defined, system-wide recipe categories.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique identifier |
| `name` | TEXT | NOT NULL | Display name (e.g., "Breakfast") |
| `slug` | TEXT | NOT NULL, UNIQUE | URL-friendly identifier (e.g., "breakfast") |
| `description` | TEXT | | Optional description of the category |
| `icon` | TEXT | | Emoji icon for visual display |
| `display_order` | INTEGER | DEFAULT 0 | Controls sort order in UI |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp of creation |

**Indexes:**
- `idx_categories_slug` - Fast lookups by slug
- `idx_categories_display_order` - Efficient sorting

**Row Level Security (RLS):**
- Authenticated users can SELECT (read) all categories
- No INSERT, UPDATE, or DELETE policies (categories are system-managed)

**Default Categories (seeded):**
1. Breakfast (morning meals)
2. Lunch (midday meals)
3. Dinner (evening meals)
4. Appetizers (starters)
5. Desserts (sweet treats)
6. Beverages (drinks)
7. Soups (warm soups and stews)
8. Salads (fresh salads)
9. Sides (accompaniments)
10. Baking (breads and pastries)

### 2. `tags` Table

Stores user-created custom tags.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique identifier |
| `name` | TEXT | NOT NULL | Display name (e.g., "Quick Meals") |
| `slug` | TEXT | NOT NULL | URL-friendly identifier |
| `user_id` | UUID | NOT NULL, REFERENCES auth.users(id) ON DELETE CASCADE | Owner of the tag |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp of creation |

**Constraints:**
- `tags_slug_user_unique` - UNIQUE(slug, user_id) - Same slug can exist for different users

**Indexes:**
- `idx_tags_user_id` - Fast queries by user
- `idx_tags_slug` - Fast lookups by slug

**Row Level Security (RLS):**
- Users can SELECT, INSERT, UPDATE, DELETE only their own tags
- Policies check `auth.uid() = user_id`

### 3. `recipe_categories` Junction Table

Links recipes to categories (many-to-many).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `recipe_id` | UUID | NOT NULL, REFERENCES recipes(id) ON DELETE CASCADE | Recipe reference |
| `category_id` | UUID | NOT NULL, REFERENCES categories(id) ON DELETE CASCADE | Category reference |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp of creation |

**Primary Key:** Composite (`recipe_id`, `category_id`)

**Indexes:**
- `idx_recipe_categories_recipe_id` - Find categories for a recipe
- `idx_recipe_categories_category_id` - Find recipes in a category

**Row Level Security (RLS):**
- Users can SELECT, INSERT, DELETE only for their own recipes
- Policies verify ownership via subquery on `recipes` table

### 4. `recipe_tags` Junction Table

Links recipes to tags (many-to-many).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `recipe_id` | UUID | NOT NULL, REFERENCES recipes(id) ON DELETE CASCADE | Recipe reference |
| `tag_id` | UUID | NOT NULL, REFERENCES tags(id) ON DELETE CASCADE | Tag reference |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp of creation |

**Primary Key:** Composite (`recipe_id`, `tag_id`)

**Indexes:**
- `idx_recipe_tags_recipe_id` - Find tags for a recipe
- `idx_recipe_tags_tag_id` - Find recipes with a tag

**Row Level Security (RLS):**
- Users can SELECT, INSERT, DELETE only for their own recipes
- Policies verify ownership via subquery on `recipes` table

---

## API Endpoints

### Categories API

#### GET /api/categories

List all categories ordered by display_order.

**Authentication:** Required

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Breakfast",
    "slug": "breakfast",
    "description": "Morning meals and brunch recipes",
    "icon": "sunrise-emoji",
    "display_order": 1,
    "created_at": "2026-08-01T00:00:00Z"
  }
]
```

**Error Response:**
```json
{ "error": "Failed to fetch categories" }
```

### Tags API

#### GET /api/tags

List all tags owned by the authenticated user.

**Authentication:** Required

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Quick Meals",
    "slug": "quick-meals",
    "user_id": "uuid",
    "created_at": "2026-08-01T00:00:00Z"
  }
]
```

#### POST /api/tags

Create a new tag.

**Authentication:** Required

**Request Body:**
```json
{
  "name": "Holiday Favorites"
}
```

**Response (201 Created):**
```json
{
  "id": "uuid",
  "name": "Holiday Favorites",
  "slug": "holiday-favorites",
  "user_id": "uuid",
  "created_at": "2026-08-01T00:00:00Z"
}
```

**Notes:**
- If a tag with the same slug already exists for the user, returns the existing tag (200 OK)
- Slug is auto-generated from the name

**Error Response:**
```json
{ "error": "Tag name is required" }
```

#### DELETE /api/tags/:id

Delete a tag.

**Authentication:** Required

**Parameters:**
- `id` (path) - Tag UUID

**Response:**
```json
{ "success": true }
```

**Notes:**
- Associated `recipe_tags` entries are automatically deleted (CASCADE)

### Recipe Endpoints (Updated)

#### GET /recipes

Now supports category and tag filtering.

**Query Parameters:**
- `category` (optional) - Category slug to filter by
- `tags` (optional) - Comma-separated tag slugs to filter by

**Examples:**
```
GET /recipes?category=breakfast
GET /recipes?tags=quick-meals,weeknight
GET /recipes?category=dinner&tags=healthy
```

**Response includes:**
- `categories`: Array of category objects with `id`, `name`, `slug`, `icon`
- `tags`: Array of tag objects with `id`, `name`, `slug`

#### GET /recipes/new

Returns available categories and user's existing tags for form population.

**Response data includes:**
- `categories`: All available categories
- `userTags`: User's existing tags (for autocomplete)
- `selectedCategories`: Empty array (new recipe)
- `selectedTags`: Empty array (new recipe)

#### POST /recipes

Now accepts category and tag data.

**Additional Form Fields:**
- `categories` - Array of category UUIDs (or single UUID)
- `tags` - Comma-separated tag names (or array)

**Behavior:**
- New tags are automatically created if they don't exist
- Tags are matched by slug (case-insensitive)

#### GET /recipes/:id/edit

Returns recipe with its categories and tags.

**Response data includes:**
- `categories`: All available categories
- `userTags`: User's existing tags
- `selectedCategories`: Array of selected category IDs
- `selectedTags`: Array of selected tag names

#### POST /recipes/:id/update

Updates recipe categories and tags.

**Behavior:**
- Replaces all existing category associations
- Replaces all existing tag associations
- Creates new tags if needed

#### GET /recipes/:id

Returns recipe with populated categories and tags.

**Response includes:**
```json
{
  "recipe": {
    "categories": [
      { "id": "uuid", "name": "Dinner", "slug": "dinner", "icon": "moon-emoji" }
    ],
    "tags": [
      { "id": "uuid", "name": "Quick Meals", "slug": "quick-meals" }
    ]
  }
}
```

---

## Frontend Components

### Category Selection UI

**File:** `views/recipes/new.ejs`, `views/recipes/edit.ejs`

Categories are displayed as a grid of checkbox cards:

```html
<div class="categories-grid">
  <label class="category-checkbox">
    <input type="checkbox" name="categories" value="category-uuid">
    <span class="category-checkbox-label">
      <span class="category-icon">emoji</span>
      <span class="category-name">Category Name</span>
    </span>
  </label>
</div>
```

**CSS Classes:**
- `.categories-grid` - Grid layout for category checkboxes
- `.category-checkbox` - Wrapper label for styling
- `.category-checkbox-label` - Visual card appearance
- `.category-icon` - Emoji display
- `.category-name` - Category text

**Behavior:**
- Multiple selection allowed
- Visual highlight when selected
- Hover states for better UX

### Tag Input with Autocomplete

**File:** `public/js/tags-input.js`

Interactive tag input component with the following features:

**HTML Structure:**
```html
<div class="tags-input-container"
     data-existing-tags='[{"name":"...", "slug":"..."}]'
     data-selected-tags='["Tag1", "Tag2"]'>
  <div class="tags-list"></div>
  <input type="text" class="tags-input" placeholder="Type a tag...">
  <input type="hidden" name="tags" class="tags-hidden-input">
  <div class="tags-suggestions"></div>
</div>
```

**Features:**
- **Add tags by:** pressing Enter, typing comma, or blur (leaving field)
- **Remove tags:** click the X button or backspace when input is empty
- **Autocomplete:** shows matching existing tags (up to 5 suggestions)
- **Duplicate prevention:** same tag cannot be added twice
- **Hidden input:** stores comma-separated tag names for form submission

**CSS Classes:**
- `.tags-input-container` - Main wrapper with border
- `.tags-list` - Container for tag chips
- `.tags-input` - Text input field
- `.tag-chip` - Individual tag pill
- `.tag-chip-text` - Tag name text
- `.tag-chip-remove` - X button
- `.tags-suggestions` - Dropdown for autocomplete
- `.tags-suggestion-item` - Individual suggestion

### Filter Bar on Recipe Index

**File:** `views/recipes/index.ejs`, `public/js/tags-input.js`

Filter bar with category dropdown and tag filter:

**Category Filter:**
```html
<select name="category" onchange="this.form.submit()">
  <option value="">All Categories</option>
  <option value="breakfast">Breakfast</option>
</select>
```

**Tag Filter Component:**
```html
<div class="filter-tags-container" data-existing-tags='...'>
  <div class="filter-tags-list"></div>
  <input type="text" class="filter-tags-input">
  <input type="hidden" name="tags" class="filter-tags-hidden">
  <div class="filter-tags-suggestions"></div>
</div>
```

**Behavior:**
- Category dropdown auto-submits on change
- Tag selection auto-submits form
- "Clear Filters" button appears when filters are active
- Shows message when no recipes match filters

### Badge Displays

**Recipe Cards (index page):**
```html
<a href="/recipes?category=dinner" class="category-badge">
  <span>emoji</span> Dinner
</a>
<a href="/recipes?tags=quick-meals" class="tag-badge">Quick Meals</a>
```

**Recipe View Page:**
```html
<a href="/recipes?category=dinner" class="category-badge category-badge-lg">
  <span>emoji</span> Dinner
</a>
<a href="/recipes?tags=quick-meals" class="tag-badge tag-badge-lg">Quick Meals</a>
```

**CSS Classes:**
- `.category-badge` - Small category pill with icon
- `.category-badge-lg` - Larger variant for view page
- `.tag-badge` - Small tag pill (different color)
- `.tag-badge-lg` - Larger variant for view page

**Styling:**
- Categories: Primary color background with icon
- Tags: Lighter, secondary styling
- Both are clickable links that filter recipes

---

## Usage Guide

### Selecting Categories (When Creating/Editing a Recipe)

1. Scroll to the "Categories" section in the recipe form
2. Click on one or more category cards to select them
3. Selected categories show a highlighted border
4. Categories are saved when you save the recipe

### Adding Tags (When Creating/Editing a Recipe)

1. Scroll to the "Tags" section in the recipe form
2. Type a tag name in the input field
3. Add the tag by:
   - Pressing **Enter**
   - Typing a **comma**
   - Clicking outside the field
4. Click the **X** on a tag chip to remove it
5. Previously used tags appear as autocomplete suggestions
6. Tags are saved when you save the recipe

### Filtering Recipes

**By Category:**
1. On the "My Recipes" page, find the "Category" dropdown
2. Select a category to filter
3. The page automatically refreshes with filtered results

**By Tags:**
1. On the "My Recipes" page, find the "Tags" filter input
2. Type to search your existing tags
3. Click a suggestion to add it as a filter
4. Multiple tags can be selected (recipes must have ALL selected tags)
5. Click the X on a tag chip to remove it from the filter

**Clear Filters:**
- Click "Clear Filters" button to remove all active filters

### Clicking Badges

- On recipe cards or the recipe view page, click any category or tag badge
- This takes you to the recipe list filtered by that category or tag

---

## Migration Instructions

### Prerequisites

- Supabase project with existing `recipes` table
- Access to run SQL migrations

### Steps to Apply Migrations

1. **Navigate to database migrations folder:**
   ```
   cd database/migrations
   ```

2. **Apply migrations in order:**

   Run each migration file in sequence via Supabase SQL Editor or psql:

   ```sql
   -- Migration 003: Create categories table
   \i 003_create_categories_table.sql

   -- Migration 004: Create tags table
   \i 004_create_tags_table.sql

   -- Migration 005: Create recipe_categories junction table
   \i 005_create_recipe_categories_table.sql

   -- Migration 006: Create recipe_tags junction table
   \i 006_create_recipe_tags_table.sql
   ```

3. **Via Supabase Dashboard:**
   - Go to SQL Editor
   - Copy and paste each migration file content
   - Execute in order (003, 004, 005, 006)

4. **Verify migration success:**
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public'
   AND table_name IN ('categories', 'tags', 'recipe_categories', 'recipe_tags');
   ```

5. **Verify default categories were seeded:**
   ```sql
   SELECT name, slug, icon FROM categories ORDER BY display_order;
   ```

### Rollback (if needed)

To remove the feature, drop tables in reverse order:

```sql
DROP TABLE IF EXISTS recipe_tags;
DROP TABLE IF EXISTS recipe_categories;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS categories;
```

**Warning:** This will permanently delete all category/tag data.

---

## File Reference

### Backend Files

| File | Purpose |
|------|---------|
| `src/routes/categoryRoutes.js` | Categories API endpoint |
| `src/routes/tagRoutes.js` | Tags API endpoints (CRUD) |
| `src/routes/recipeRoutes.js` | Updated recipe routes with category/tag support |

### Frontend Files

| File | Purpose |
|------|---------|
| `public/js/tags-input.js` | Tag input and filter components |
| `public/css/styles.css` | Styling for badges, inputs, and checkboxes |
| `views/recipes/new.ejs` | New recipe form with category/tag UI |
| `views/recipes/edit.ejs` | Edit recipe form with category/tag UI |
| `views/recipes/index.ejs` | Recipe list with filter bar and badges |
| `views/recipes/view.ejs` | Recipe view with category/tag badges |

### Database Files

| File | Purpose |
|------|---------|
| `database/migrations/003_create_categories_table.sql` | Categories table and seed data |
| `database/migrations/004_create_tags_table.sql` | Tags table with RLS |
| `database/migrations/005_create_recipe_categories_table.sql` | Junction table for recipe-categories |
| `database/migrations/006_create_recipe_tags_table.sql` | Junction table for recipe-tags |

---

## Implementation Notes

### Design Decisions

1. **Categories are system-wide, tags are user-specific**
   - Categories provide consistent organization across all users
   - Tags allow personal, flexible labeling without cluttering shared space

2. **Tags are created on-the-fly**
   - When saving a recipe with new tag names, tags are automatically created
   - Reduces friction in the tagging workflow

3. **Slug-based matching**
   - Tags are matched by slug, not name
   - "Quick Meals" and "quick meals" resolve to the same tag
   - Prevents accidental duplicates

4. **Comma and Enter for tag input**
   - Supports both common input methods
   - Blur also commits the current input

5. **Filter by multiple tags requires ALL**
   - When filtering by multiple tags, recipes must have all selected tags
   - More precise filtering than "any" matching

### Security

- All endpoints require authentication (`requireAuth` middleware)
- RLS policies ensure users can only access their own data
- Category modifications are admin-only (no user-facing endpoints)
- Input sanitization via slug generation

### Performance

- Indexes on all foreign keys and lookup columns
- Efficient junction table queries with composite primary keys
- Autocomplete limited to 5 suggestions

---

**Documentation created:** 2026-08-14
**Feature status:** Implemented and ready for use
