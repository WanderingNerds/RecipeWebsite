-- Create recipe_tags junction table
CREATE TABLE IF NOT EXISTS recipe_tags (
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Composite primary key
  PRIMARY KEY (recipe_id, tag_id)
);

-- Create index on recipe_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_recipe_tags_recipe_id ON recipe_tags(recipe_id);

-- Create index on tag_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_recipe_tags_tag_id ON recipe_tags(tag_id);

-- Enable Row Level Security
ALTER TABLE recipe_tags ENABLE ROW LEVEL SECURITY;

-- Create policy: Users can view recipe_tags for their own recipes
CREATE POLICY "Users can view own recipe tags"
  ON recipe_tags
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM recipes
      WHERE recipes.id = recipe_tags.recipe_id
      AND recipes.user_id = auth.uid()
    )
  );

-- Create policy: Users can insert recipe_tags for their own recipes
CREATE POLICY "Users can insert own recipe tags"
  ON recipe_tags
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM recipes
      WHERE recipes.id = recipe_tags.recipe_id
      AND recipes.user_id = auth.uid()
    )
  );

-- Create policy: Users can delete recipe_tags for their own recipes
CREATE POLICY "Users can delete own recipe tags"
  ON recipe_tags
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM recipes
      WHERE recipes.id = recipe_tags.recipe_id
      AND recipes.user_id = auth.uid()
    )
  );
