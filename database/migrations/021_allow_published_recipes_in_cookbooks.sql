-- REW-100: Allow adding another user's published recipe to a cookbook
--
-- Widens the RECIPE half of the cookbook_recipes INSERT policy from
-- "the caller's own recipe" to "the caller's own recipe (any status) OR
-- anyone's status = 'published' recipe". The COOKBOOK-ownership half is
-- unchanged: the target cookbook must still belong to auth.uid().
--
-- PRECEDENT: 012_create_meal_plan_recipes_table.sql already uses exactly this
-- shape for meal_plan_recipes, which is why "+ Meal Plan" has always worked
-- for another user's published recipe. This migration brings cookbooks in
-- line with it; the two junction tables now enforce the same recipe rule.
-- 012's analogous policy is likewise named "...insert own meal plan recipes"
-- while admitting published rows, so the policy name is deliberately KEPT
-- here rather than renamed: it keeps the two files consistent, keeps the
-- rollback text below simple, and avoids leaving documentation pointing at a
-- policy name that no longer exists.
--
-- SUPERSEDES A COMMENT IN 010: 010_create_cookbook_recipes_table.sql states
-- in its header that own-recipes-only is enforced "at the database layer, not
-- just in application code" and that a user "cannot add someone else's recipe
-- (including another user's published recipe) into their own cookbook even if
-- application code were buggy." That was true of REW-62 and is no longer true
-- as of this migration; read 010's header as historical. 010 itself is NOT
-- edited -- it has already been applied. Same handling as 020 superseding a
-- comment in 011.
--
-- THIS IS A KNOWING RELAXATION of a documented database-layer guarantee, so
-- the AND / OR nesting below is load-bearing: the cookbook EXISTS and the
-- recipe EXISTS are ANDed, and the OR lives strictly INSIDE the recipe
-- EXISTS. An OR at the top level would let a user insert into a cookbook they
-- do not own, which this migration must never do.
--
-- DRAFT PRIVACY IS UNCHANGED. Another user's draft recipe is still rejected
-- by this WITH CHECK, and is still invisible to SELECT under 001's
-- own-or-published recipes policy.
--
-- UNTOUCHED BY THIS MIGRATION:
--   * 010's SELECT and DELETE policies on cookbook_recipes -- both remain
--     scoped to cookbooks owned by auth.uid(), so a recipe's author still
--     cannot read or remove anything inside someone else's cookbook.
--   * Both REW-19 public SELECT policies from 019_add_cookbook_sharing.sql,
--     including the one requiring the referenced recipe to be published.
--   * Every policy, grant and column on `recipes`. In particular 001's
--     own-or-published SELECT policy is NOT widened here.
--   * No schema change: no table, column, index, grant, function, trigger or
--     ON DELETE CASCADE is created or altered. The composite primary key
--     (cookbook_id, recipe_id) still prevents duplicate membership rows.
--
-- Drop-and-recreate rather than ALTER POLICY, guarded with DROP POLICY IF
-- EXISTS so the file is re-runnable and reads side by side with 010.
--
-- ROLLBACK: restore 010's own-recipes-only WITH CHECK.
--
--   DROP POLICY IF EXISTS "Users can insert own cookbook recipes" ON cookbook_recipes;
--
--   CREATE POLICY "Users can insert own cookbook recipes"
--     ON cookbook_recipes
--     FOR INSERT
--     WITH CHECK (
--       EXISTS (
--         SELECT 1 FROM cookbooks
--         WHERE cookbooks.id = cookbook_recipes.cookbook_id
--         AND cookbooks.user_id = auth.uid()
--       )
--       AND EXISTS (
--         SELECT 1 FROM recipes
--         WHERE recipes.id = cookbook_recipes.recipe_id
--         AND recipes.user_id = auth.uid()
--       )
--     );
--
-- A rollback is not destructive and deletes nothing: any non-owned membership
-- rows inserted while this migration was in force REMAIN in place, remain
-- readable by the cookbook's owner, and remain removable by them. Only NEW
-- non-owned inserts stop being possible.

-- ---------------------------------------------------------------------------
-- INSERT policy: cookbook ownership (unchanged) + own-or-published recipe
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can insert own cookbook recipes" ON cookbook_recipes;

CREATE POLICY "Users can insert own cookbook recipes"
  ON cookbook_recipes
  FOR INSERT
  WITH CHECK (
    -- Unchanged from 010: the target cookbook must belong to the caller.
    EXISTS (
      SELECT 1 FROM cookbooks
      WHERE cookbooks.id = cookbook_recipes.cookbook_id
      AND cookbooks.user_id = auth.uid()
    )
    -- Widened by REW-100, mirroring 012's meal_plan_recipes policy: the
    -- caller's own recipe at any status, or anyone's published recipe. The OR
    -- is scoped inside this EXISTS on purpose -- see the header.
    AND EXISTS (
      SELECT 1 FROM recipes
      WHERE recipes.id = cookbook_recipes.recipe_id
      AND (recipes.user_id = auth.uid() OR recipes.status = 'published')
    )
  );
