-- Create recipe_likes junction table for storing user likes on recipes
CREATE TABLE IF NOT EXISTS recipe_likes (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Composite primary key prevents duplicate likes
  PRIMARY KEY (user_id, recipe_id)
);

-- Create index on recipe_id for fast like count queries
CREATE INDEX IF NOT EXISTS idx_recipe_likes_recipe_id ON recipe_likes(recipe_id);

-- Create index on user_id for fetching user's liked recipes
CREATE INDEX IF NOT EXISTS idx_recipe_likes_user_id ON recipe_likes(user_id);

-- Create index on created_at for sorting liked recipes by recency
CREATE INDEX IF NOT EXISTS idx_recipe_likes_created_at ON recipe_likes(created_at DESC);

-- Enable Row Level Security
ALTER TABLE recipe_likes ENABLE ROW LEVEL SECURITY;

-- Create policy: Users can view their own likes only
CREATE POLICY "Users can view own likes"
  ON recipe_likes
  FOR SELECT
  USING (user_id = auth.uid());

-- Create policy: Users can insert their own likes
CREATE POLICY "Users can insert own likes"
  ON recipe_likes
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Create policy: Users can delete their own likes
CREATE POLICY "Users can delete own likes"
  ON recipe_likes
  FOR DELETE
  USING (user_id = auth.uid());

-- Create a helper function to get like count for a recipe
-- This function is accessible without authentication (uses service role context)
CREATE OR REPLACE FUNCTION get_recipe_like_count(p_recipe_id UUID)
RETURNS INTEGER
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(COUNT(*)::INTEGER, 0)
  FROM recipe_likes
  WHERE recipe_id = p_recipe_id;
$$;

-- Grant execute permission to anon and authenticated roles
GRANT EXECUTE ON FUNCTION get_recipe_like_count(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_recipe_like_count(UUID) TO authenticated;
