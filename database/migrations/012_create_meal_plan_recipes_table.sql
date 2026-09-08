-- REW-63: Create meal_plan_recipes junction table
--
-- Many-to-many between meal_plans and recipes, modeled on the
-- `cookbook_recipes` junction table pattern (010) -- WITH ONE KEY
-- DIFFERENCE: the INSERT policy's recipe-visibility check.
--
-- Cookbooks only ever allow a user to add their OWN recipes to a cookbook.
-- This ticket's AC requires "Add to Meal Plan" on recipe cards/pages
-- generally, including surfaces that display other users' published
-- recipes (/browse, /search, /recipes/liked) -- so meal_plan_recipes must
-- allow a user's own recipe (any status) OR any other user's *published*
-- recipe, mirroring the visibility rule already used by `recipe_likes`
-- (008), not the ownership-only rule used by `cookbook_recipes` (010).

CREATE TABLE IF NOT EXISTS meal_plan_recipes (
  meal_plan_id UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,

  -- Forward-compat column for REW-26 (grocery list generation). Nullable;
  -- no route/view in this ticket writes to it. Exists so a future grocery
  -- list feature can scale a recipe's ingredients to N servings for this
  -- specific plan without a further migration. See Open Questions #4 in
  -- the REW-63 plan.
  planned_servings INTEGER CHECK (planned_servings IS NULL OR planned_servings > 0),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Composite primary key prevents duplicate membership rows. Naturally
  -- supports "recipe belongs to multiple plans" (different meal_plan_id
  -- rows) and "plan holds multiple recipes" (different recipe_id rows).
  PRIMARY KEY (meal_plan_id, recipe_id)
);

-- Create index on meal_plan_id for faster "recipes in this plan" lookups
CREATE INDEX IF NOT EXISTS idx_meal_plan_recipes_meal_plan_id ON meal_plan_recipes(meal_plan_id);

-- Create index on recipe_id for faster "which plans contain this recipe" lookups
CREATE INDEX IF NOT EXISTS idx_meal_plan_recipes_recipe_id ON meal_plan_recipes(recipe_id);

-- Enable Row Level Security
ALTER TABLE meal_plan_recipes ENABLE ROW LEVEL SECURITY;

-- Create policy: Users can view meal_plan_recipes for their own meal plans
CREATE POLICY "Users can view own meal plan recipes"
  ON meal_plan_recipes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM meal_plans
      WHERE meal_plans.id = meal_plan_recipes.meal_plan_id
      AND meal_plans.user_id = auth.uid()
    )
  );

-- Create policy: Users can add recipes to their own meal plans, and only
-- a recipe that is either their OWN (any status) or PUBLISHED by anyone --
-- this is what enforces "a user cannot add another user's draft recipe to
-- a meal plan" at the database layer, not just in application code. A
-- direct insert attempt as another authenticated user is rejected by
-- Postgres even if application code were buggy. See
-- 008_create_recipe_likes_table.sql for the precedent this mirrors.
CREATE POLICY "Users can insert own meal plan recipes"
  ON meal_plan_recipes
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM meal_plans
      WHERE meal_plans.id = meal_plan_recipes.meal_plan_id
      AND meal_plans.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM recipes
      WHERE recipes.id = meal_plan_recipes.recipe_id
      AND (recipes.user_id = auth.uid() OR recipes.status = 'published')
    )
  );

-- Create policy: Users can remove recipes from their own meal plans
CREATE POLICY "Users can delete own meal plan recipes"
  ON meal_plan_recipes
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM meal_plans
      WHERE meal_plans.id = meal_plan_recipes.meal_plan_id
      AND meal_plans.user_id = auth.uid()
    )
  );

-- No UPDATE policy needed -- membership is insert/delete only, same
-- reasoning as recipe_likes (008) / cookbook_recipes (010).
-- planned_servings is not written by any route/view in this ticket; if a
-- future ticket (REW-26) makes it user-editable, an UPDATE policy scoped
-- the same way as SELECT/DELETE above will need to be added then.

-- Cascade behavior (verified): deleting a meal plan (ON DELETE CASCADE on
-- meal_plan_id) removes only meal_plan_recipes rows, never touches
-- recipes -- satisfies "deleting a meal plan does not delete any
-- recipes." Deleting a recipe cascades via ON DELETE CASCADE on recipe_id
-- and silently removes it from any meal plans (and cookbooks) it was in
-- -- existing, expected junction-table behavior, not a regression.
