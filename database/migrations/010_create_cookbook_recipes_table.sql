-- REW-62: Create cookbook_recipes junction table
--
-- Many-to-many between cookbooks and recipes, modeled on the
-- `recipe_categories` junction table pattern (005). A single recipe can
-- belong to any number of cookbooks, and a cookbook can hold any number of
-- recipes; the composite primary key prevents adding the same recipe to the
-- same cookbook twice.

CREATE TABLE IF NOT EXISTS cookbook_recipes (
  cookbook_id UUID NOT NULL REFERENCES cookbooks(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Composite primary key prevents duplicate membership rows
  PRIMARY KEY (cookbook_id, recipe_id)
);

-- Create index on cookbook_id for faster "recipes in this cookbook" lookups
CREATE INDEX IF NOT EXISTS idx_cookbook_recipes_cookbook_id ON cookbook_recipes(cookbook_id);

-- Create index on recipe_id for faster "which cookbooks contain this recipe" lookups
CREATE INDEX IF NOT EXISTS idx_cookbook_recipes_recipe_id ON cookbook_recipes(recipe_id);

-- Enable Row Level Security
ALTER TABLE cookbook_recipes ENABLE ROW LEVEL SECURITY;

-- Create policy: Users can view cookbook_recipes for their own cookbooks
CREATE POLICY "Users can view own cookbook recipes"
  ON cookbook_recipes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cookbooks
      WHERE cookbooks.id = cookbook_recipes.cookbook_id
      AND cookbooks.user_id = auth.uid()
    )
  );

-- Create policy: Users can add recipes to their own cookbooks, and only
-- their OWN recipes -- this is what enforces "add recipes from their
-- recipes" at the database layer, not just in application code. A user
-- cannot add someone else's recipe (including another user's published
-- recipe) into their own cookbook even if application code were buggy.
CREATE POLICY "Users can insert own cookbook recipes"
  ON cookbook_recipes
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cookbooks
      WHERE cookbooks.id = cookbook_recipes.cookbook_id
      AND cookbooks.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM recipes
      WHERE recipes.id = cookbook_recipes.recipe_id
      AND recipes.user_id = auth.uid()
    )
  );

-- Create policy: Users can remove recipes from their own cookbooks
CREATE POLICY "Users can delete own cookbook recipes"
  ON cookbook_recipes
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM cookbooks
      WHERE cookbooks.id = cookbook_recipes.cookbook_id
      AND cookbooks.user_id = auth.uid()
    )
  );

-- No UPDATE policy needed -- membership is insert/delete only, same
-- reasoning as recipe_likes (008).
