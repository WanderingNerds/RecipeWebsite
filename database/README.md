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
   | 9 | `009_create_cookbooks_table.sql` | Cookbooks table (private, per-user recipe collections) with owner-only RLS (REW-62) |
   | 10 | `010_create_cookbook_recipes_table.sql` | Cookbook-recipes junction table with dual-ownership (cookbook + recipe) RLS (REW-62) |
   | 11 | `011_create_meal_plans_table.sql` | Meal plans table (private, per-user, dated recipe collections) with owner-only RLS (REW-63) |
   | 12 | `012_create_meal_plan_recipes_table.sql` | Meal-plan-recipes junction table with plan-ownership + own-or-published-recipe RLS on INSERT (REW-63) |
   | 13 | `013_public_recipe_card_metadata.sql` | Add public SELECT policies for published recipe categories/tags and their associations (REW-59) |

4. **Verify the Setup**
   - Go to "Table Editor" in the left sidebar
   - You should see the following tables:
     - `recipes`
     - `categories`
     - `tags`
     - `recipe_categories`
     - `recipe_tags`
     - `recipe_likes`
     - `cookbooks`
     - `cookbook_recipes`
     - `meal_plans`
     - `meal_plan_recipes`

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

Junction table recording each user's Favorites. The `recipe_likes` name is retained as a compatibility contract:

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID | Foreign Key to `auth.users` |
| `recipe_id` | UUID | Foreign Key to `recipes` |
| `created_at` | TIMESTAMPTZ | When the favorite was created (used to sort the Favorites page by recency) |

**Primary Key:** Composite `(user_id, recipe_id)` — prevents a user from favoriting the same recipe twice.

**Helper function:** `get_recipe_like_count(p_recipe_id UUID) RETURNS INTEGER` — `SECURITY DEFINER`, granted to both `anon` and `authenticated`, so favorite counts can be read without a per-user session. Its legacy name remains unchanged for compatibility.

Consumed by the legacy `POST`/`DELETE`/`GET /api/likes/:recipeId` contract (`src/routes/likeRoutes.js`), the `/recipes/liked` Favorites page, the recipe detail view's Favorite button, and the My Recipes list view (`GET /recipes`). These technical identifiers remain unchanged so existing rows and callers continue to work. See [Favorites API](../docs/api/recipe-likes.md).

### cookbooks (REW-62)

A private, per-user named collection of the owner's own recipes ("cookbooks"). Modeled directly on the `recipes` table pattern, minus the "published" public-read policy — cookbooks have no public/shared state in this ticket, which is what makes them private by default.

| Column | Type | Description |
|--------|------|--------------|
| `id` | UUID | Primary Key |
| `user_id` | UUID | Foreign Key to `auth.users` (owner) |
| `title` | TEXT | Cookbook name; `NOT NULL` with a `CHECK` requiring non-empty content after trimming |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp (auto-updated via the existing `update_updated_at_column()` trigger function, reused from `001_create_recipes_table.sql`) |

A cookbook belongs to exactly one user. Deleting a cookbook never deletes the recipes in it — see "Cascade behavior" in Notes below.

### cookbook_recipes (REW-62)

Junction table linking cookbooks to recipes (many-to-many) — a single recipe can belong to any number of a user's cookbooks, and a cookbook can hold any number of that user's recipes:

| Column | Type | Description |
|--------|------|--------------|
| `cookbook_id` | UUID | Foreign Key to `cookbooks` |
| `recipe_id` | UUID | Foreign Key to `recipes` |
| `created_at` | TIMESTAMPTZ | When the recipe was added to the cookbook (used to sort a cookbook's contents by most-recently-added) |

**Primary Key:** Composite `(cookbook_id, recipe_id)` — prevents adding the same recipe to the same cookbook twice.

Consumed by `GET/POST /cookbooks*` (`src/routes/cookbookRoutes.js`), the "My Cookbooks" list/detail pages, the recipe picker (`/cookbooks/:id/add-recipes`), and the "Save to Cookbook(s)" widget on the recipe detail view (`views/recipes/view.ejs`, wired up in `src/routes/recipeRoutes.js`'s `GET /:id`). See [Cookbooks API](../docs/api/cookbooks.md).

### meal_plans (REW-63)

A private, per-user named collection of recipes scoped to a required date range ("meal plans") — in contrast to `cookbooks`, which have no schedule. Modeled directly on the `cookbooks` table pattern, plus the required `start_date`/`end_date` this ticket adds.

| Column | Type | Description |
|--------|------|--------------|
| `id` | UUID | Primary Key |
| `user_id` | UUID | Foreign Key to `auth.users` (owner) |
| `title` | TEXT | Meal plan name; `NOT NULL` with a `CHECK` requiring non-empty content after trimming |
| `start_date` | DATE | `NOT NULL` |
| `end_date` | DATE | `NOT NULL`; `CHECK (end_date >= start_date)` |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp (auto-updated via the existing `update_updated_at_column()` trigger function, reused from `001_create_recipes_table.sql`) |

A meal plan belongs to exactly one user. Deleting a meal plan never deletes the recipes in it — see "Cascade behavior" in Notes below. Plain `DATE` columns are used (no time-of-day/timezone handling), and there is no uniqueness/overlap constraint across a user's plans — a user's meal plans may cover overlapping calendar days.

### meal_plan_recipes (REW-63)

Junction table linking meal plans to recipes (many-to-many) — a single recipe can belong to any number of a user's meal plans, and a meal plan can hold any number of recipes:

| Column | Type | Description |
|--------|------|--------------|
| `meal_plan_id` | UUID | Foreign Key to `meal_plans` |
| `recipe_id` | UUID | Foreign Key to `recipes` |
| `planned_servings` | INTEGER | Nullable; `CHECK (planned_servings IS NULL OR planned_servings > 0)`. Forward-compatible column for REW-26 (grocery list generation) — not written to by any REW-63 route/view; exists so a future feature can scale a recipe's ingredients to N servings for a given plan without a further migration |
| `created_at` | TIMESTAMPTZ | When the recipe was added to the plan (used to sort a plan's contents by most-recently-added) |

**Primary Key:** Composite `(meal_plan_id, recipe_id)` — prevents adding the same recipe to the same plan twice.

**Key difference from `cookbook_recipes`:** the INSERT RLS policy allows adding a recipe that is **either the caller's own recipe (any status) or any other user's *published* recipe** — not owner-only. This mirrors the visibility rule already used by `recipe_likes`, and reflects that "Add to Meal Plan" appears on `/browse`, `/search`, and `/recipes/liked`, which show other users' published recipes, unlike Cookbooks' only entry point (the owner's own recipe page).

Consumed by `GET/POST /meal-plans*` (`src/routes/mealPlanRoutes.js`), the "My Meal Plans" list/detail pages, the bulk recipe picker (`/meal-plans/:id/add-recipes`), and the shared "Add to Meal Plan" modal (`views/partials/meal-plan-modal.ejs`, backed by `src/routes/mealPlanApiRoutes.js` at `/api/meal-plans*`). See [Meal Plans API](../docs/api/meal-plans.md).

---

## Security

All tables include Row Level Security (RLS) policies:

### recipes
- Users can only view, create, update, and delete their own recipes
- All authenticated users can view published recipes (not just their own)
- Draft recipes are only visible to their creator

### categories
- All authenticated users can read categories
- Migration 013 also permits anonymous reads of categories attached to published recipes
- Categories are system-managed (no user insert/update/delete)

### tags
- Owners retain read/create/update/delete access to their own tags
- Migration 013 permits anonymous and authenticated reads of tags attached to at least one published recipe; draft-only tags remain private to their owner

### recipe_categories / recipe_tags
- Users can only manage associations for their own recipes
- Junction table policies verify recipe ownership via subquery
- Migration 013 adds anonymous/authenticated SELECT access to associations belonging to published recipes; draft associations and existing mutation policies remain unchanged

Migration 013 adds four SELECT policies and SELECT grants, with no table or column changes. A tag used on both a published and a draft recipe is publicly readable, but its draft association remains private. Apply after earlier migrations and verify published/draft reads as anonymous, non-owner and owner users, plus owner mutation rights, in staging before release. SQL execution and live RLS verification remain pending; see the [REW-59 QA report](../docs/qa/rew-59-browse-recipe-cards.md).

### recipe_likes (REW-21)
- SELECT/INSERT/DELETE all restricted to `user_id = auth.uid()` — a user can only view, create, or remove their own like rows
- No UPDATE policy (a like is binary; toggling is insert/delete, not update)
- Like *counts* are exposed publicly via the `get_recipe_like_count()` `SECURITY DEFINER` function, independent of the row-level SELECT policy above
- The API layer (`recipeExists()` in `src/routes/likeRoutes.js`), not RLS, is what restricts liking to `status = 'published'` recipes — RLS itself does not know about a recipe's status

### cookbooks (REW-62)
- SELECT/INSERT/UPDATE/DELETE all restricted to `user_id = auth.uid()` — a user can only view, create, rename, or delete their own cookbooks
- **Deliberately no public/shared SELECT policy** — there is no policy under which a non-owner's `auth.uid()` satisfies any of the four policies above, so a cookbook is structurally private (a direct API/URL request or Supabase query for another user's cookbook ID returns nothing), not just hidden in the UI. REW-19 (cookbook sharing, out of scope for REW-62) would add sharing as an *additional* SELECT policy without reworking this migration.

### cookbook_recipes (REW-62)
- SELECT/DELETE restricted via a subquery to cookbooks owned by `auth.uid()` — only a cookbook's owner can see or remove its contents
- INSERT requires **both** cookbook ownership **and** recipe ownership (a second `EXISTS` check against `recipes.user_id = auth.uid()`) — this is what enforces "add recipes from their own recipes" at the database layer, not just in application code; a user cannot add someone else's recipe (including another user's published recipe) into their own cookbook even if application code were buggy
- No UPDATE policy needed — membership is insert/delete only, same reasoning as `recipe_likes`

### meal_plans (REW-63)
- SELECT/INSERT/UPDATE/DELETE all restricted to `user_id = auth.uid()` — a user can only view, create, rename/re-date, or delete their own meal plans
- **Deliberately no public/shared SELECT policy** — same structural-privacy approach as `cookbooks`; a direct API/URL request or Supabase query for another user's meal plan ID returns nothing

### meal_plan_recipes (REW-63)
- SELECT/DELETE restricted via a subquery to meal plans owned by `auth.uid()` — only a plan's owner can see or remove its contents
- **INSERT requires plan ownership PLUS a recipe-visibility check that differs from `cookbook_recipes`:** `(recipes.user_id = auth.uid() OR recipes.status = 'published')` — a user can add their own recipe (any status) or any other user's published recipe, but **not** another user's draft/unpublished recipe. A direct insert attempt as another authenticated user targeting a draft recipe they don't own is rejected by Postgres even if application code were buggy. This mirrors the visibility rule already used by `recipe_likes`, not the ownership-only rule used by `cookbook_recipes`.
- No UPDATE policy needed for membership rows, same reasoning as `recipe_likes`/`cookbook_recipes` — if `planned_servings` becomes user-editable in a future ticket (REW-26), an UPDATE policy scoped the same way as SELECT/DELETE will need to be added then

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
- `recipe_likes.recipe_id` - Fast favorite-count queries
- `recipe_likes.user_id` - Fast "which recipes has this user favorited" queries (My Recipes batch-fetch, Favorites page)
- `recipe_likes.created_at` (descending) - Sorting the Favorites page by recency
- `cookbooks.user_id` - Fast "list this user's cookbooks" queries
- `cookbook_recipes.cookbook_id` - Fast "recipes in this cookbook" lookups
- `cookbook_recipes.recipe_id` - Fast "which cookbooks contain this recipe" lookups (recipe view's "Save to Cookbook(s)" widget)
- `meal_plans.user_id` - Fast "list this user's meal plans" queries
- `meal_plans.(user_id, start_date)` - Composite index to cheaply support a future "upcoming/past plans" sort on the list page
- `meal_plan_recipes.meal_plan_id` - Fast "recipes in this plan" lookups
- `meal_plan_recipes.recipe_id` - Fast "which plans contain this recipe" lookups (the "Add to Meal Plan" modal's membership check)

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
- **Cookbook cascade behavior (REW-62):** deleting a cookbook (`ON DELETE CASCADE` on `cookbook_recipes.cookbook_id`) removes only its `cookbook_recipes` membership rows — it never touches `recipes`, satisfying "delete a cookbook without deleting the recipes in it." Deleting a recipe (existing `POST /recipes/:id/delete`, unchanged by REW-62) cascades via `ON DELETE CASCADE` on `cookbook_recipes.recipe_id` and silently removes it from any cookbooks it was in. This is the same junction-table behavior `recipe_categories`/`recipe_tags` already have, and is intentional, not a regression.
- Cookbooks have no publish/draft state and can contain a mix of the owner's draft and published recipes — cookbook membership is independent of a recipe's `status`. Both a recipe's own draft/published lifecycle and its cookbook membership can change independently of each other.
- **Meal plan cascade behavior (REW-63):** deleting a meal plan (`ON DELETE CASCADE` on `meal_plan_recipes.meal_plan_id`) removes only its `meal_plan_recipes` membership rows — it never touches `recipes`, satisfying "deleting a meal plan does not delete any recipes." Deleting a recipe cascades via `ON DELETE CASCADE` on `meal_plan_recipes.recipe_id` and silently removes it from any meal plans (and cookbooks) it was in — the same junction-table behavior as `cookbook_recipes`, intentional and not a regression.
- Meal plans can contain a mix of the owner's own draft and published recipes, **and** any other user's published recipes — meal plan membership does not require recipe ownership, unlike cookbook membership. If a recipe added to someone else's plan while published is later reverted to draft by its owner, existing `meal_plan_recipes` rows referencing it are **not** automatically removed (same known-gap pattern already documented above for `recipe_likes`); this edge case was not in scope for REW-63.
- `meal_plan_recipes.planned_servings` is schema-only in this ticket (REW-63) — no route or view reads or writes it yet. It exists purely so REW-26 (grocery list generation) can be built on top of `meal_plans`/`meal_plan_recipes` without a further migration.

---

## Rollback

To remove the categories and tags feature (if needed):

```sql
DROP TABLE IF EXISTS recipe_tags;
DROP TABLE IF EXISTS recipe_categories;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS categories;
```

To remove the cookbooks feature (REW-62, if needed):

```sql
DROP TABLE IF EXISTS cookbook_recipes;
DROP TABLE IF EXISTS cookbooks;
```

**Warning:** This permanently deletes all cookbooks and cookbook-recipe associations. Recipes themselves are unaffected.

To remove the meal plans feature (REW-63, if needed):

```sql
DROP TABLE IF EXISTS meal_plan_recipes;
DROP TABLE IF EXISTS meal_plans;
```

**Warning:** This permanently deletes all meal plans and meal-plan-recipe associations. Recipes themselves are unaffected.

**Warning:** This permanently deletes all category and tag data.
