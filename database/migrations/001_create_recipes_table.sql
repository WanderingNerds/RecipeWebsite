-- Create recipes table
CREATE TABLE IF NOT EXISTS recipes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Basic information
  title TEXT NOT NULL,
  author TEXT,

  -- Recipe metadata
  prep_time TEXT,
  cook_time TEXT,
  servings TEXT,
  difficulty TEXT CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),

  -- Content
  ingredients TEXT,
  instructions TEXT NOT NULL,
  notes TEXT,

  -- Photo (for future use)
  photo_url TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON recipes(user_id);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_recipes_status ON recipes(status);

-- Enable Row Level Security
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

-- Create policy: Users can view their own recipes
CREATE POLICY "Users can view own recipes"
  ON recipes
  FOR SELECT
  USING (auth.uid() = user_id);

-- Create policy: Users can insert their own recipes
CREATE POLICY "Users can insert own recipes"
  ON recipes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create policy: Users can update their own recipes
CREATE POLICY "Users can update own recipes"
  ON recipes
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create policy: Users can delete their own recipes
CREATE POLICY "Users can delete own recipes"
  ON recipes
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create policy: Allow viewing published recipes by all authenticated users
CREATE POLICY "Users can view published recipes"
  ON recipes
  FOR SELECT
  USING (status = 'published');

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_recipes_updated_at
  BEFORE UPDATE ON recipes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
