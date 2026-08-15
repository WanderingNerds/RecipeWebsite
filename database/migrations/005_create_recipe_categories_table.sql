-- Create recipe_categories junction table
CREATE TABLE IF NOT EXISTS recipe_categories (
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Composite primary key
  PRIMARY KEY (recipe_id, category_id)
);

-- Create index on recipe_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_recipe_categories_recipe_id ON recipe_categories(recipe_id);

-- Create index on category_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_recipe_categories_category_id ON recipe_categories(category_id);

-- Enable Row Level Security
ALTER TABLE recipe_categories ENABLE ROW LEVEL SECURITY;

-- Create policy: Users can view recipe_categories for their own recipes
CREATE POLICY "Users can view own recipe categories"
  ON recipe_categories
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM recipes
      WHERE recipes.id = recipe_categories.recipe_id
      AND recipes.user_id = auth.uid()
    )
  );

-- Create policy: Users can insert recipe_categories for their own recipes
CREATE POLICY "Users can insert own recipe categories"
  ON recipe_categories
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM recipes
      WHERE recipes.id = recipe_categories.recipe_id
      AND recipes.user_id = auth.uid()
    )
  );

-- Create policy: Users can delete recipe_categories for their own recipes
CREATE POLICY "Users can delete own recipe categories"
  ON recipe_categories
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM recipes
      WHERE recipes.id = recipe_categories.recipe_id
      AND recipes.user_id = auth.uid()
    )
  );
