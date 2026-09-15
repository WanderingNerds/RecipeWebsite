-- REW-69: Meal plan sharing
--
-- Gives a meal plan owner one explicit, reversible Private <-> Public choice,
-- using exactly the mechanism REW-19 established for cookbooks in
-- 019_add_cookbook_sharing.sql. Public means the plan is readable by anyone at
-- GET /m/:id -- the plan's own UUID is the share identifier. There is no share
-- token, no per-user grant table, and (unlike cookbooks) NO search
-- discoverability: a meal plan is a time-boxed personal schedule, not
-- browsable content, so this migration adds no search vector, no RPC and no
-- trigram index.
--
-- This migration is purely ADDITIVE. The four owner-only policies from
-- 011_create_meal_plans_table.sql and the three from
-- 012_create_meal_plan_recipes_table.sql are left untouched, and permissive
-- policies are OR'd, so an owner keeps full visibility of their own plans.
--
-- SUPERSEDES A COMMENT IN 011: that migration's header states meal plans are
-- "structurally private at the RLS layer" with "deliberately NO public/shared
-- SELECT policy." That was true of REW-63 and is no longer true as of this
-- migration. 011 itself is NOT edited -- it has already been applied.
--
-- PRIVACY NOTE -- Private (draft) recipes must never leak through a shared
-- meal plan. Plan membership is deliberately independent of a recipe's publish
-- status (REW-63), so a Public plan can contain the owner's drafts. Nothing
-- here changes the `recipes` table, its policies, or its grants: the
-- published/owner SELECT policy from 001 is precisely the mechanism relied on.
-- The application reads /m/:id through the anon key, where auth.uid() is null,
-- so only published recipes are ever returned -- structurally, not by a filter
-- somebody could forget. A Public plan whose recipes are all Private renders
-- as an empty plan to visitors, which is correct.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS "Anyone can view recipes in public meal plans" ON public.meal_plan_recipes;
--   DROP POLICY IF EXISTS "Anyone can view public meal plans" ON public.meal_plans;
--   ALTER TABLE meal_plans DROP COLUMN IF EXISTS is_public;
-- Dropping these returns meal plans to REW-63 behavior with no data loss.

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------

-- NOT NULL DEFAULT false means every meal plan that existed before this
-- migration is Private afterwards, with no backfill required.
ALTER TABLE meal_plans
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Deliberately none. The only query against a public meal plan is
--   id = ? AND is_public = true
-- which the primary key already serves. There is no public-plan listing and no
-- meal plan search (see REW-69 plan, assumption 9), so the partial created_at
-- index 019 added for cookbooks would be unused here.

-- ---------------------------------------------------------------------------
-- Row Level Security -- additive SELECT policies only
-- ---------------------------------------------------------------------------

-- Anyone (signed in or not) can read a meal plan the owner has made Public.
-- Additive alongside "Users can view own meal plans" from 011; a Private meal
-- plan is still only visible to its owner.
CREATE POLICY "Anyone can view public meal plans"
  ON public.meal_plans
  FOR SELECT TO anon, authenticated
  USING (is_public = true);

-- Membership rows of a Public meal plan are readable by anyone -- but ONLY the
-- edges that point at a published recipe.
--
-- Gating on the parent meal plan alone is NOT sufficient. The membership row
-- itself carries recipe_id, planned_servings and created_at, so an anon
-- PostgREST read of
--   /rest/v1/meal_plan_recipes?meal_plan_id=eq.<public_id>&select=recipe_id,created_at
-- would disclose the count, UUIDs and add-times of the owner's PRIVATE recipes
-- even though the recipe rows themselves stay hidden by the policies from 001.
-- That is the REW-92 lesson already applied to cookbook_recipes in 019: the
-- threat model is the direct anon-key API read, not just the rendered page, so
-- the recipe's status is checked here too. This mirrors
-- 013_public_recipe_card_metadata.sql, which gates every public junction-edge
-- policy on recipes.status = 'published'.
--
-- The two EXISTS clauses are AND-ed, never OR-ed. OR would make either
-- condition sufficient on its own and re-open exactly the leak above.
--
-- This does not affect the owner's own /meal-plans/:id view: the owner-only
-- SELECT policy from 012 is a separate PERMISSIVE policy, and permissive
-- policies are OR'd, so an owner still sees every membership row including
-- those for their Private recipes.
--
-- No RLS recursion risk: meal_plan_recipes policies reference meal_plans and
-- recipes, and neither of those tables' policies reference meal_plan_recipes.
CREATE POLICY "Anyone can view recipes in public meal plans"
  ON public.meal_plan_recipes
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meal_plans mp
      WHERE mp.id = meal_plan_recipes.meal_plan_id
        AND mp.is_public = true
    )
    AND EXISTS (
      SELECT 1 FROM public.recipes r
      WHERE r.id = meal_plan_recipes.recipe_id
        AND r.status = 'published'
    )
  );

-- No new UPDATE policy: "Users can update own meal plans" (011) already covers
-- an owner writing this new column on a row they can already update.
-- No new INSERT/DELETE policies anywhere: membership stays insert/delete by
-- the owner only.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Explicit rather than relying on Supabase default privileges, matching
-- 003_add_recipe_search.sql, 013_public_recipe_card_metadata.sql and
-- 019_add_cookbook_sharing.sql. RLS above remains the row-visibility boundary;
-- this only permits the read to be attempted.
GRANT SELECT ON public.meal_plans, public.meal_plan_recipes TO anon, authenticated;
