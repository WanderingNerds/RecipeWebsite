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
   | 3b | `003_add_recipe_search.sql` | Recipe full-text search: generated `tsvector` column, GIN + trigram indexes, published-recipe partial index, and the `search_recipes()` RPC (`STABLE`, `SECURITY INVOKER`) backing `GET /search` |
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
   | 14 | `014_create_help_feedback_submissions_table.sql` | Authenticated feedback intake with owner-bound INSERT-only RLS (REW-70) |
   | 15 | `015_add_admin_feedback_management.sql` | Admin profiles, workflow/assignment, narrow grants, and admin-only RLS (REW-71) |
   | 16 | `016_backfill_rew78_admin_profiles.sql` | Idempotently provision Andrew and Victoria's already-authorized admin profiles (REW-78) |
   | 17 | `017_add_feedback_progress_comments.sql` | Append-only, admin-only feedback progress history with durable author snapshots (REW-80) |
   | 18 | `018_add_recipe_clone_provenance.sql` | Immutable clone lineage and durable original-author attribution (REW-84) |
   | 19 | `019_add_cookbook_sharing.sql` | Cookbook sharing: `cookbooks.is_public`, title search vector + indexes, two additive public SELECT policies, anon/authenticated grants, and the `search_cookbooks()` RPC (REW-19) |
   | 20 | `020_add_meal_plan_sharing.sql` | Meal plan sharing: `meal_plans.is_public`, two additive public SELECT policies (the junction one gated on both plan visibility and recipe publish status), and anon/authenticated grants. **No index, no search vector, no RPC** — Public meal plans are link-only (REW-69) |

   **Note on the duplicated `003_` prefix.** Two files ship with a `003_` prefix — `003_create_categories_table.sql` and `003_add_recipe_search.sql`. This is a historical accident, not a pair of alternatives: **both must be run**, in the order shown above. Every migration from `004` onward uses a unique prefix. The search migration was previously missing from this table entirely; it is listed here as of REW-19.

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
     - `help_feedback_submissions`
     - `admin_profiles`

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
| `cloned_from_recipe_id` | UUID | Nullable direct-source recipe reference; cleared if that source is deleted |
| `original_author` | TEXT | Immutable, trimmed root-author snapshot for a cloned recipe |
| `prep_time` | TEXT | Preparation time |
| `cook_time` | TEXT | Cooking time |
| `servings` | TEXT | Number of servings (free text, parsed for scaling) |
| `difficulty` | TEXT | Easy, Medium, or Hard |
| `ingredients` | TEXT | Free-text ingredients (one per line) |
| `instructions` | TEXT | Cooking instructions |
| `notes` | TEXT | Additional notes |
| `photo_url` | TEXT | Base64-encoded main photo |
| `thumbnail_url` | TEXT | Base64-encoded thumbnail |
| `status` | TEXT | User-facing Private/Public visibility, stored as `draft`/`published` |
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

### cookbooks (REW-62)

A per-user named collection of the owner's own recipes ("cookbooks"). Modeled directly on the `recipes` table pattern. Private by default; REW-19 adds an opt-in Public state (see `is_public` below).

| Column | Type | Description |
|--------|------|--------------|
| `id` | UUID | Primary Key. Also serves as the public share-link identifier at `GET /c/:id` (REW-19) — there is no separate share token or slug |
| `user_id` | UUID | Foreign Key to `auth.users` (owner) |
| `title` | TEXT | Cookbook name; `NOT NULL` with a `CHECK` requiring non-empty content after trimming |
| `is_public` | BOOLEAN | **REW-19.** `NOT NULL DEFAULT false`. `true` means the cookbook is readable by anyone at `GET /c/:id` **and** discoverable in site search. Written only by `POST /cookbooks/:id/visibility` |
| `search_vector` | TSVECTOR | **REW-19.** `GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, ''))) STORED`. Title-only today (cookbooks have no description column); a future description can be folded in without application changes |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp (auto-updated via the existing `update_updated_at_column()` trigger function, reused from `001_create_recipes_table.sql`) |

A cookbook belongs to exactly one user. Deleting a cookbook never deletes the recipes in it — see "Cascade behavior" in Notes below.

**`is_public` is the whole sharing model (REW-19).** There is no `cookbook_shares` table and no per-user grant: a cookbook is either Private (owner-only, the default and the state of every row that existed before migration 019) or Public (world-readable). Because visibility is read from this column on every request and never cached, flipping a cookbook back to Private revokes its share link on the very next request.

### cookbook_recipes (REW-62)

Junction table linking cookbooks to recipes (many-to-many) — a single recipe can belong to any number of a user's cookbooks, and a cookbook can hold any number of that user's recipes:

| Column | Type | Description |
|--------|------|--------------|
| `cookbook_id` | UUID | Foreign Key to `cookbooks` |
| `recipe_id` | UUID | Foreign Key to `recipes` |
| `created_at` | TIMESTAMPTZ | When the recipe was added to the cookbook (used to sort a cookbook's contents by most-recently-added) |

**Primary Key:** Composite `(cookbook_id, recipe_id)` — prevents adding the same recipe to the same cookbook twice.

Consumed by `GET/POST /cookbooks*` (`src/routes/cookbookRoutes.js`), the "My Cookbooks" list/detail pages, the recipe picker (`/cookbooks/:id/add-recipes`), and the "Save to Cookbook(s)" widget on the recipe detail view (`views/recipes/view.ejs`, wired up in `src/routes/recipeRoutes.js`'s `GET /:id`). See [Cookbooks API](../docs/api/cookbooks.md).

### meal_plans (REW-63, extended by REW-69)

A per-user named collection of recipes scoped to a required date range ("meal plans") — in contrast to `cookbooks`, which have no schedule. Modeled directly on the `cookbooks` table pattern, plus the required `start_date`/`end_date` this ticket adds. Private by default; REW-69 adds an opt-in Public state (see `is_public` below).

| Column | Type | Description |
|--------|------|--------------|
| `id` | UUID | Primary Key |
| `user_id` | UUID | Foreign Key to `auth.users` (owner) |
| `title` | TEXT | Meal plan name; `NOT NULL` with a `CHECK` requiring non-empty content after trimming |
| `start_date` | DATE | `NOT NULL` |
| `end_date` | DATE | `NOT NULL`; `CHECK (end_date >= start_date)` |
| `is_public` | BOOLEAN | **REW-69.** `NOT NULL DEFAULT false`. `true` means the plan is readable by anyone at `GET /m/:id`. Written only by `POST /meal-plans/:id/visibility` |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp (auto-updated via the existing `update_updated_at_column()` trigger function, reused from `001_create_recipes_table.sql`) |

A meal plan belongs to exactly one user. Deleting a meal plan never deletes the recipes in it — see "Cascade behavior" in Notes below. Plain `DATE` columns are used (no time-of-day/timezone handling), and there is no uniqueness/overlap constraint across a user's plans — a user's meal plans may cover overlapping calendar days.

**`is_public` is the whole sharing model (REW-69).** There is no `meal_plan_shares` table and no per-user grant: a plan is either Private (owner-only, the default and the state of every row that existed before migration `020`) or Public (world-readable at its share link). Because visibility is read from this column on every request and never cached, flipping a plan back to Private revokes its share link on the very next request. Unlike `cookbooks.is_public`, it does **not** make the row discoverable in search — migration `020` adds no search vector, no RPC, and no index.

### meal_plan_recipes (REW-63, extended by REW-69)

Junction table linking meal plans to recipes (many-to-many) — a single recipe can belong to any number of a user's meal plans, and a meal plan can hold any number of recipes:

| Column | Type | Description |
|--------|------|--------------|
| `meal_plan_id` | UUID | Foreign Key to `meal_plans` |
| `recipe_id` | UUID | Foreign Key to `recipes` |
| `planned_servings` | INTEGER | Nullable; `CHECK (planned_servings IS NULL OR planned_servings > 0)`. Forward-compatible column for REW-26 (grocery list generation) — not written to by any REW-63 route/view; exists so a future feature can scale a recipe's ingredients to N servings for a given plan without a further migration |
| `created_at` | TIMESTAMPTZ | When the recipe was added to the plan (used to sort a plan's contents by most-recently-added) |

**Primary Key:** Composite `(meal_plan_id, recipe_id)` — prevents adding the same recipe to the same plan twice.

**Key difference from `cookbook_recipes`:** the INSERT RLS policy allows adding a recipe that is **either the caller's own recipe (any status) or any other user's *published* recipe** — not owner-only. This mirrors the visibility rule already used by `recipe_likes`, and reflects that "Add to Meal Plan" appears on `/browse`, `/search`, and `/recipes/liked`, which show other users' published recipes, unlike Cookbooks' only entry point (the owner's own recipe page).

Consumed by `GET/POST /meal-plans*` (`src/routes/mealPlanRoutes.js`), the "My Meal Plans" list/detail pages, the bulk recipe picker (`/meal-plans/:id/add-recipes`), the shared "Add to Meal Plan" modal (`views/partials/meal-plan-modal.ejs`, backed by `src/routes/mealPlanApiRoutes.js` at `/api/meal-plans*`), and — as of REW-69 — the public shared-plan view at `GET /m/:id` in `src/routes/publicRoutes.js`. See [Meal Plans API](../docs/api/meal-plans.md).

### help_feedback_submissions (REW-70)

Durable submission-time snapshots with `id`, `user_id`, contact name/email, category, subject, message, workflow status, optional `assignee_id`, and timestamps. Migration 015 expands status to `new`, `in_progress`, and `done`; assignment references `admin_profiles(id) ON DELETE SET NULL`. Text constraints mirror the application limits. The user foreign key intentionally uses PostgreSQL's default `NO ACTION`; live account-deletion behavior remains to be verified.

### admin_profiles (REW-71)

Assignable administrator roster keyed one-to-one to Supabase Auth users.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key and foreign key to `auth.users(id)` with `ON DELETE CASCADE` |
| `display_name` | TEXT | Required trimmed assignment label, 1–120 characters |
| `active` | BOOLEAN | Whether the profile can be newly assigned; defaults to `TRUE` |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

A profile row does not grant administrator access. The matching Auth user must independently carry the trusted `app_metadata.role = 'admin'` claim.

Migration 016 idempotently provisions the fixed REW-78 assignees from existing `auth.users` rows. It matches only the case-normalized exact emails `carroll.andrew@gmail.com` and `vhobbs1895@gmail.com`, requires each user to already carry `raw_app_meta_data.role = 'admin'`, and writes the canonical short names Andrew and Victoria with `active = TRUE`. On an ID conflict it repairs only `display_name` and `active`; it does not grant a role, broaden RLS, or create profiles for any other account.

Migration 017 adds `feedback_progress_comments`, an append-only history keyed to `help_feedback_submissions`. Each row records an authenticated `admin_profiles` author, a durable display-name snapshot, trimmed plain text of 1–5,000 characters, and a database-generated `TIMESTAMPTZ`. The `(feedback_submission_id, created_at, id)` index supports stable oldest-first detail-page reads. Authenticated callers receive only SELECT and INSERT; RLS further requires the trusted admin claim and, for inserts, binds the author and active profile name to `auth.uid()`. No UPDATE or DELETE grant or policy exists.

---

## Search functions (RPCs)

Both search RPCs are declared `LANGUAGE sql`, `STABLE`, **`SECURITY INVOKER`**, with `SET search_path = public, pg_temp`, and are granted `EXECUTE` to `anon` and `authenticated`. `SECURITY INVOKER` is deliberate and load-bearing: RLS stays the real visibility boundary, so the visibility filter inside each function body is defence in depth rather than the only thing standing between a visitor and private data. Neither function may be converted to `SECURITY DEFINER` without a fresh security review.

### `search_recipes(search_query text, result_limit integer, result_offset integer)`

Added by `003_add_recipe_search.sql`. Ranks published recipes by a generated `tsvector`, with an `ILIKE` partial-title fallback (LIKE metacharacters escaped) so a prefix like "week" still matches "Weeknight Dinner". Returns a `total_count` via `count(*) OVER ()` so the caller can paginate without a second query. Backs `GET /search`.

### `search_cookbooks(search_query text, result_limit integer DEFAULT 5, result_offset integer DEFAULT 0)` (REW-19)

Added by `019_add_cookbook_sharing.sql`. Same shape and same security posture as `search_recipes`, applied to **Public cookbooks only** (`is_public = true` in the function body, on top of the RLS policy). Returns `id`, `title`, `created_at`, `recipe_count`, `rank`, and `total_count`.

`recipe_count` is computed with an explicit `recipes.status = 'published'` join predicate, so an owner searching their own Public cookbook sees the same count a stranger sees — without that predicate, the owner's broader RLS visibility would inflate the number with their own drafts. The count subquery runs in the outer `SELECT`, after `LIMIT`/`OFFSET`, so it evaluates once per returned row rather than once per matched row.

`result_limit` is clamped to 1–50 and `result_offset` floored at 0, matching `search_recipes`. Callers (`GET /search`) request 5 with offset 0 and only on page 1.

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

### cookbooks (REW-62, extended by REW-19)
- SELECT/INSERT/UPDATE/DELETE all restricted to `user_id = auth.uid()` — a user can only view, create, rename, or delete their own cookbooks. Migration 019 leaves all four of these owner-only policies untouched.
- **REW-19 adds one additional SELECT policy, `"Anyone can view public cookbooks"`** (`TO anon, authenticated`, `USING (is_public = true)`). Permissive policies are OR'd, so a Private cookbook remains visible only to its owner, and a Public one becomes readable by everyone. This is the opt-in exception REW-62's migration header anticipated; nothing else about cookbook privacy changed.
- No new UPDATE policy was added for `is_public` — the existing "Users can update own cookbooks" policy already covers an owner writing a new column on a row they can update.

### cookbook_recipes (REW-62, extended by REW-19)
- SELECT/DELETE restricted via a subquery to cookbooks owned by `auth.uid()` — only a cookbook's owner can see or remove its contents
- INSERT requires **both** cookbook ownership **and** recipe ownership (a second `EXISTS` check against `recipes.user_id = auth.uid()`) — this is what enforces "add recipes from their own recipes" at the database layer, not just in application code; a user cannot add someone else's recipe (including another user's published recipe) into their own cookbook even if application code were buggy
- No UPDATE policy needed — membership is insert/delete only, same reasoning as `recipe_likes`
- **REW-19 adds one additional SELECT policy, `"Anyone can view recipes in public cookbooks"`** (`TO anon, authenticated`), gated on **two** `EXISTS` checks that must both hold: the parent cookbook is `is_public = true` **and** the referenced recipe has `status = 'published'`. Gating on the cookbook alone would not have been sufficient — a membership row itself carries `recipe_id` and `created_at`, so an anonymous PostgREST read of `cookbook_recipes?cookbook_id=eq.<public_id>` would have disclosed the count, UUIDs, and add-times of the owner's draft recipes even while the recipe rows themselves stayed hidden. The threat model here is the direct anon-key API read, not just the rendered page. This mirrors `013_public_recipe_card_metadata.sql`, which gates every public junction-edge policy on `recipes.status = 'published'`.
- The owner's own `/cookbooks/:id` view is unaffected: the owner-only policy from 010 is a separate permissive policy, so an owner still sees every membership row, including those pointing at their drafts.
- No RLS recursion risk: `cookbook_recipes` policies reference `cookbooks` and `recipes`; neither of those tables' policies reference `cookbook_recipes`.

### Cookbook sharing grants (REW-19)
- `GRANT SELECT ON public.cookbooks, public.cookbook_recipes TO anon, authenticated` — explicit rather than relying on Supabase default privileges, matching the pattern in `003_add_recipe_search.sql` and `013_public_recipe_card_metadata.sql`. The grant only permits the read to be *attempted*; RLS above remains the row-visibility boundary.
- `GRANT EXECUTE ON FUNCTION public.search_cookbooks(text, integer, integer) TO anon, authenticated`.
- **No grant, policy, or column on `recipes` was changed by migration 019.** The published/owner SELECT policy from `001` is precisely the mechanism the application relies on to keep drafts out of a shared cookbook, and it must stay as it is.

### meal_plans (REW-63, extended by REW-69)
- SELECT/INSERT/UPDATE/DELETE all restricted to `user_id = auth.uid()` — a user can only view, create, rename/re-date, or delete their own meal plans. Migration `020` leaves all four of these owner-only policies untouched.
- **REW-69 adds one additional SELECT policy, `"Anyone can view public meal plans"`** (`TO anon, authenticated`, `USING (is_public = true)`). Permissive policies are OR'd, so a Private plan remains visible only to its owner, and a Public one becomes readable by everyone.
- **This supersedes a statement in migration `011`.** That migration's header describes meal plans as "structurally private at the RLS layer" with "deliberately NO public/shared SELECT policy." That was true of REW-63 and is no longer true as of `020`. `011` itself is not edited — it has already been applied — so the header comment there should be read as historical.
- No new UPDATE policy was added for `is_public` — the existing "Users can update own meal plans" policy already covers an owner writing a new column on a row they can update.

### meal_plan_recipes (REW-63, extended by REW-69)
- SELECT/DELETE restricted via a subquery to meal plans owned by `auth.uid()` — only a plan's owner can see or remove its contents
- **INSERT requires plan ownership PLUS a recipe-visibility check that differs from `cookbook_recipes`:** `(recipes.user_id = auth.uid() OR recipes.status = 'published')` — a user can add their own recipe (any status) or any other user's published recipe, but **not** another user's draft/unpublished recipe. A direct insert attempt as another authenticated user targeting a draft recipe they don't own is rejected by Postgres even if application code were buggy. This mirrors the visibility rule already used by `recipe_likes`, not the ownership-only rule used by `cookbook_recipes`.
- No UPDATE policy needed for membership rows, same reasoning as `recipe_likes`/`cookbook_recipes` — if `planned_servings` becomes user-editable in a future ticket, an UPDATE policy scoped the same way as SELECT/DELETE will need to be added then. Migration `020` adds no such policy; membership stays insert/delete only.
- **REW-69 adds one additional SELECT policy, `"Anyone can view recipes in public meal plans"`** (`TO anon, authenticated`), gated on **two** `EXISTS` checks that must both hold: the parent `meal_plans` row is `is_public = true` **and** the referenced `recipes` row has `status = 'published'`. The two clauses are `AND`-ed, never `OR`-ed — `OR` would make either condition sufficient on its own and re-open the leak below.
- Gating on the parent plan alone would **not** have been sufficient. A membership row itself carries `recipe_id`, `planned_servings`, and `created_at`, so an anonymous PostgREST read of `meal_plan_recipes?meal_plan_id=eq.<public_id>&select=recipe_id,created_at` would have disclosed the count, UUIDs, and add-times of the owner's Private recipes even while the recipe rows themselves stayed hidden. The threat model here is the direct anon-key API read, not just the rendered page. This is the same REW-92 lesson applied to `cookbook_recipes` in `019`, and mirrors `013_public_recipe_card_metadata.sql`, which gates every public junction-edge policy on `recipes.status = 'published'`.
- The owner's own `/meal-plans/:id` view is unaffected: the owner-only policy from `012` is a separate permissive policy, so an owner still sees every membership row, including those pointing at their Private recipes.
- No RLS recursion risk: `meal_plan_recipes` policies reference `meal_plans` and `recipes`; neither of those tables' policies reference `meal_plan_recipes`.

### Meal plan sharing grants (REW-69)
- `GRANT SELECT ON public.meal_plans, public.meal_plan_recipes TO anon, authenticated` — explicit rather than relying on Supabase default privileges, matching the pattern in `003_add_recipe_search.sql`, `013_public_recipe_card_metadata.sql`, and `019_add_cookbook_sharing.sql`. The grant only permits the read to be *attempted*; RLS above remains the row-visibility boundary.
- No function grant — migration `020` creates no RPC.
- **No grant, policy, or column on `recipes` was changed by migration `020`.** The published/owner SELECT policy from `001` is precisely the mechanism the application relies on to keep Private recipes out of a shared plan, and it must stay as it is.
- **Accepted residual exposure.** For a **Public** plan, an anon PostgREST read of `meal_plans` can see that row's `user_id`, `created_at`, and `updated_at`, so multiple Public plans can be correlated to one owner UUID. This was raised in review and accepted by design: it is identical to the existing posture for published `recipes` and Public `cookbooks`, and it exposes no Private plan. `meal_plan_recipes.planned_servings` likewise becomes readable for Public plans, but it is schema-only today — no route or view writes it — so nothing is disclosed in practice. Tightening either would require column-level grants, a new app-wide convention that belongs in its own ticket.

### help_feedback_submissions (REW-70)
- Authenticated intake requires `user_id = auth.uid()`, `status = 'new'`, and `assignee_id IS NULL`.
- Only trusted admin JWTs may SELECT submissions or UPDATE them. Authenticated UPDATE privilege is limited to `status` and `assignee_id`; owner/contact/content/timestamp columns are not writable through PostgREST.
- Assignment changes to a non-null value must target an active profile. OLD/NEW-aware trigger enforcement allows a status-only update to retain an existing assignee that later became inactive.
- Ordinary users have no SELECT, UPDATE, or DELETE policy and cannot read `admin_profiles`.
- Live owner/mismatched-owner, forced-field, regular-user, and admin policy verification remains pending.

### admin_profiles (REW-71)
- SELECT requires the verified JWT's `app_metadata.role` to equal `admin`.
- No browser-facing INSERT, UPDATE, or DELETE policy exists. Provisioning and roster maintenance are privileged out-of-band operations.

---

## Indexes

Performance indexes are created on:
- `recipes.user_id` - Fast user queries
- `recipes.status` - Draft/published filtering
- `recipes.cloned_from_recipe_id` - Direct clone-lineage lookups
- `categories.slug` - Fast lookups by slug
- `categories.display_order` - Efficient sorting
- `tags.user_id` - Fast queries by user
- `tags.slug` - Fast lookups by slug
- `recipe_categories.recipe_id` / `category_id` - Junction lookups
- `recipe_tags.recipe_id` / `tag_id` - Junction lookups
- `recipe_likes.recipe_id` - Fast like-count queries
- `recipe_likes.user_id` - Fast "which recipes has this user liked" queries (My Recipes batch-fetch, Liked Recipes page)
- `recipe_likes.created_at` (descending) - Sorting the Liked Recipes page by recency
- `recipes.search_vector` (GIN) and `recipes.title` (GIN trigram) - Full-text and partial-title matching for `search_recipes()` (`003_add_recipe_search.sql`)
- `recipes.created_at` (descending, partial `WHERE status = 'published'`) - Published-recipe listings
- `cookbooks.user_id` - Fast "list this user's cookbooks" queries
- `cookbooks.created_at` (descending, partial `WHERE is_public = true`) - Public-cookbook listings, newest first (REW-19; mirrors the published-recipe partial index)
- `cookbooks.search_vector` (GIN) - Full-text title matching for `search_cookbooks()` (REW-19)
- `cookbooks.title` (GIN trigram, `gin_trgm_ops`) - Partial-title `ILIKE` fallback in `search_cookbooks()` (REW-19). Migration 019 runs `CREATE EXTENSION IF NOT EXISTS pg_trgm`, already enabled by `003_add_recipe_search.sql`
- `cookbook_recipes.cookbook_id` - Fast "recipes in this cookbook" lookups
- `cookbook_recipes.recipe_id` - Fast "which cookbooks contain this recipe" lookups (recipe view's "Save to Cookbook(s)" widget)
- `meal_plans.user_id` - Fast "list this user's meal plans" queries
- `meal_plans.(user_id, start_date)` - Composite index to cheaply support a future "upcoming/past plans" sort on the list page
- `meal_plan_recipes.meal_plan_id` - Fast "recipes in this plan" lookups
- `meal_plan_recipes.recipe_id` - Fast "which plans contain this recipe" lookups (the "Add to Meal Plan" modal's membership check)
- **No index was added for meal plan sharing (REW-69).** Unlike cookbooks, there is no public-plan listing and no meal plan search — the only query against a Public plan is `id = ? AND is_public = true`, which the primary key already serves. A partial `created_at` index mirroring `019`'s would sit unused.
- `help_feedback_submissions.created_at` (descending) - Chronological intake ordering
- `help_feedback_submissions.(status, created_at)` - Status-filtered queue ordering for REW-71
- `help_feedback_submissions.assignee_id` - Assignment lookup support for REW-71
- `feedback_progress_comments.(feedback_submission_id, created_at, id)` - Stable oldest-first progress history per feedback ticket (REW-80)

---

## Notes

- `recipes.author` has no database-level default. When it arrives blank/missing on create (manual entry or import), the application defaults it to the logged-in user's account display name in the route handler, not via a SQL default or trigger — see [Recipe Author Default (REW-46)](../docs/api/recipe-author-default.md). Editing an existing recipe does not retroactively apply this default.
- **Clone provenance (REW-84):** cloned recipes are inserted with both `cloned_from_recipe_id` (the direct source) and `original_author` (the root author's durable snapshot). Non-clones have both values null. The snapshot must be trimmed and 1–255 characters, and a fixed-search-path trigger rejects incomplete provenance at insert or attempts to rewrite either value later. The trigger runs as its migration owner so its narrow source-existence check cannot mistake an RLS-hidden source for a deleted one. Deleting a source sets only the direct reference to null; the snapshot remains so attribution survives. Migration 018 does not change recipe grants or RLS policies. After deployment, verify owner writes still obey existing RLS and that selecting a clone does not expose a private source row through the self-reference.
- `recipes.prep_time` and `recipes.cook_time` remain nullable `TEXT` with no `NOT NULL` constraint. The manual "New Recipe"/"Edit Recipe" forms and their `POST` handlers require both values to be non-blank (REW-52), while the Import Recipe flow requires `cook_time` and keeps `prep_time` optional (REW-77). Enforcement is application-layer only, with no migration or historical-row backfill. Note: on the create/edit forms only, `cook_time` is labeled "Total Time" in the UI — the column itself was **not** renamed and there is no separate `total_time` column; see [Required Prep Time / Total Time (REW-52)](../docs/api/recipe-required-times.md) for the full rationale. The import and detail views display this same column as "Cook Time."
- The `status` field defaults to 'draft' and accepts 'draft' or 'published'
- Recipe forms describe `draft` as **Private** and `published` as **Public**. Missing or invalid visibility input fails closed to `draft`. Add Recipe copies only allowlisted recipe text, the source URL, and category selections into a new owner-scoped row; it intentionally omits user-owned tags, images, IDs, timestamps, likes, cookbook memberships, and meal-plan memberships, and always starts Private.
- The `difficulty` field accepts 'Easy', 'Medium', or 'Hard'
- The `updated_at` field on recipes is automatically updated via a trigger
- Tags with the same slug can exist for different users (unique per user_id)
- All foreign keys use CASCADE delete for referential integrity
- `recipe_likes` rows can only exist for `status = 'published'` recipes going forward — the API's `POST /api/likes/:recipeId` handler checks status before inserting — but this is enforced in the application layer, not by a database constraint or trigger. If a published recipe with existing likes is later reverted to draft, its `recipe_likes` rows are **not** automatically removed; the API's read paths (My Recipes card state, `/recipes/liked`, the detail page) still reflect them, they just can't be created fresh against a draft recipe. This edge case (draft-after-published-with-likes) was not in scope for REW-55 or REW-21 — flagging as a known gap, not a bug in either ticket.
- **Cookbook cascade behavior (REW-62):** deleting a cookbook (`ON DELETE CASCADE` on `cookbook_recipes.cookbook_id`) removes only its `cookbook_recipes` membership rows — it never touches `recipes`, satisfying "delete a cookbook without deleting the recipes in it." Deleting a recipe (existing `POST /recipes/:id/delete`, unchanged by REW-62) cascades via `ON DELETE CASCADE` on `cookbook_recipes.recipe_id` and silently removes it from any cookbooks it was in. This is the same junction-table behavior `recipe_categories`/`recipe_tags` already have, and is intentional, not a regression.
- Cookbooks have no publish/draft state and can contain a mix of the owner's draft and published recipes — cookbook membership is independent of a recipe's `status`. Both a recipe's own draft/published lifecycle and its cookbook membership can change independently of each other.
- **Cookbook sharing and draft privacy (REW-19):** `cookbooks.is_public` is a cookbook-level flag only. Setting it never reads or writes any recipe's `status`, never adds or removes membership rows, and never changes cookbook delete/cascade behavior. Because a Public cookbook can still contain the owner's drafts, the application reads `/c/:id` and its recipes exclusively through the **anon-key** Supabase client, where `auth.uid()` is null and the `recipes` SELECT policy from `001` therefore returns published rows only. An explicit `status = 'published'` predicate in the query and in the `cookbook_recipes` policy are defence in depth on top of that. A deliberate consequence: a Public cookbook whose recipes are all Private renders as an empty cookbook, with an empty state that must not hint that hidden recipes exist.
- **REW-19 deployment:** apply migration 019 after 018. It is additive and has no backfill — every existing cookbook is Private afterwards because `is_public` is `NOT NULL DEFAULT false`. No environment variable, package, or Vercel configuration change is required. **This migration has not been applied to any live Supabase project by the pipeline run that produced it, and QA was not run** — the live RLS/grant checks (anonymous and cross-user reads of a Private cookbook's rows, and of a Public cookbook's draft membership edges) remain unverified.
- **Meal plan cascade behavior (REW-63):** deleting a meal plan (`ON DELETE CASCADE` on `meal_plan_recipes.meal_plan_id`) removes only its `meal_plan_recipes` membership rows — it never touches `recipes`, satisfying "deleting a meal plan does not delete any recipes." Deleting a recipe cascades via `ON DELETE CASCADE` on `meal_plan_recipes.recipe_id` and silently removes it from any meal plans (and cookbooks) it was in — the same junction-table behavior as `cookbook_recipes`, intentional and not a regression.
- Meal plans can contain a mix of the owner's own draft and published recipes, **and** any other user's published recipes — meal plan membership does not require recipe ownership, unlike cookbook membership. If a recipe added to someone else's plan while published is later reverted to draft by its owner, existing `meal_plan_recipes` rows referencing it are **not** automatically removed (same known-gap pattern already documented above for `recipe_likes`); this edge case was not in scope for REW-63.
- `meal_plan_recipes.planned_servings` is schema-only in this ticket (REW-63) — no route or view reads or writes it yet. It exists purely so REW-26 (grocery list generation) can be built on top of `meal_plans`/`meal_plan_recipes` without a further migration. REW-69 makes it anon-readable for Public plans' published edges; since nothing writes it, no data is disclosed in practice.
- **Meal plan sharing and Private-recipe privacy (REW-69):** `meal_plans.is_public` is a plan-level flag only. Setting it never reads or writes any recipe's `status`, never adds or removes membership rows, never alters `start_date`/`end_date`, and never changes meal plan delete/cascade behavior. Because a Public plan can still contain the owner's Private recipes, the application reads `/m/:id` and its recipes exclusively through the **anon-key** Supabase client, where `auth.uid()` is null and the `recipes` SELECT policy from `001` therefore returns published rows only. An explicit `status = 'published'` predicate in the query and in the `meal_plan_recipes` policy are defence in depth on top of that. A deliberate consequence: a Public plan whose recipes are all Private renders as an empty plan, with an empty state that must not hint that hidden recipes exist. Unlike cookbooks, a Public plan is link-only — it is never surfaced in site search.
- **REW-69 deployment:** apply migration 020 after 019. It is additive and has no backfill — every existing meal plan is Private afterwards because `is_public` is `NOT NULL DEFAULT false`. No environment variable, package, or Vercel configuration change is required, though `APP_URL` must already be correct in production since it is the origin of every meal plan share link. **This migration has not been applied to any live Supabase project by the pipeline run that produced it, and QA was not run** — the live RLS/grant checks (anonymous and cross-user reads of a Private plan's rows, and of a Public plan's Private membership edges) remain unverified.
- **REW-70 deployment:** apply migration 014 after migration 013. Live migration, RLS, account-delete `NO ACTION`, and successful storage/refresh checks remain pending.
- **REW-71 deployment:** apply migration 015 after 014, set a user's trusted Auth `app_metadata.role` to `admin`, insert the matching `admin_profiles` row, and refresh/re-authenticate. The application does not use a service-role key or expose self-promotion.
- **REW-78 deployment:** apply migration 016 after 015 to idempotently backfill Andrew and Victoria's assignment profiles from their existing, independently authorized Auth users. The migration does not grant administrator access.
- **REW-80 deployment:** apply migration 017 after 016. No environment or package changes are required. Live PostgreSQL RLS/grant checks and authenticated Andrew/Victoria browser acceptance remain pending.
- **REW-71 acceptance:** the configured live project currently lacks the required tables/migrations and safe admin/regular fixtures. Verify intake invariants, role denial, direct RLS/grants, inactive-assignee behavior, queue/detail/status/assignment, CSRF, auth refresh/logout, and responsive browser behavior before release.

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

To remove **only** cookbook sharing (REW-19), leaving cookbooks themselves intact:

```sql
DROP FUNCTION IF EXISTS public.search_cookbooks(text, integer, integer);
DROP POLICY IF EXISTS "Anyone can view recipes in public cookbooks" ON public.cookbook_recipes;
DROP POLICY IF EXISTS "Anyone can view public cookbooks" ON public.cookbooks;
DROP INDEX IF EXISTS idx_cookbooks_title_trgm;
DROP INDEX IF EXISTS idx_cookbooks_search_vector;
DROP INDEX IF EXISTS idx_cookbooks_public_created;
ALTER TABLE cookbooks DROP COLUMN IF EXISTS search_vector;
ALTER TABLE cookbooks DROP COLUMN IF EXISTS is_public;
```

This returns cookbooks to REW-62 (owner-only) behavior with no data loss — every cookbook and every membership row survives; only the sharing state is discarded. Any share links handed out beforehand stop working. The application's `GET /c/:id`, `POST /cookbooks/:id/visibility`, and the search page's Cookbooks section must be removed or disabled alongside it, or they will error.

To remove the meal plans feature (REW-63, if needed):

```sql
DROP TABLE IF EXISTS meal_plan_recipes;
DROP TABLE IF EXISTS meal_plans;
```

**Warning:** This permanently deletes all meal plans and meal-plan-recipe associations. Recipes themselves are unaffected.

To remove **only** meal plan sharing (REW-69), leaving meal plans themselves intact:

```sql
DROP POLICY IF EXISTS "Anyone can view recipes in public meal plans" ON public.meal_plan_recipes;
DROP POLICY IF EXISTS "Anyone can view public meal plans" ON public.meal_plans;
ALTER TABLE meal_plans DROP COLUMN IF EXISTS is_public;
```

This returns meal plans to REW-63 (owner-only) behavior with no data loss — every plan and every membership row survives; only the sharing state is discarded. Any share links handed out beforehand stop working. The application's `GET /m/:id` and `POST /meal-plans/:id/visibility` must be removed or disabled alongside it, or they will error. There is no index, function, or generated column to drop, because migration `020` created none.

**Warning:** This permanently deletes all category and tag data.
