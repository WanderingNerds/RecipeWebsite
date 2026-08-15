-- Create tags table
CREATE TABLE IF NOT EXISTS tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint on slug per user (users can have same tag names)
  CONSTRAINT tags_slug_user_unique UNIQUE (slug, user_id)
);

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);

-- Create index on slug for lookups
CREATE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug);

-- Enable Row Level Security
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

-- Create policy: Users can view their own tags
CREATE POLICY "Users can view own tags"
  ON tags
  FOR SELECT
  USING (auth.uid() = user_id);

-- Create policy: Users can insert their own tags
CREATE POLICY "Users can insert own tags"
  ON tags
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create policy: Users can update their own tags
CREATE POLICY "Users can update own tags"
  ON tags
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create policy: Users can delete their own tags
CREATE POLICY "Users can delete own tags"
  ON tags
  FOR DELETE
  USING (auth.uid() = user_id);
