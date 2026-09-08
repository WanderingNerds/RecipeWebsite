-- REW-62: Create cookbooks table
--
-- A cookbook is a private, per-user named collection of the owner's own
-- recipes. Modeled directly on the `recipes` table pattern (001), minus
-- the "published" public-read policy -- cookbooks have no public state in
-- this ticket, which is what makes them private by default.
--
-- REW-19 (cookbook sharing) is explicitly out of scope here. Because there
-- is no public/shared SELECT policy defined below, sharing can be added
-- later as an ADDITIONAL SELECT policy (or via a future `cookbook_shares`
-- join table) without reworking this migration.

CREATE TABLE IF NOT EXISTS cookbooks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Basic information
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_cookbooks_user_id ON cookbooks(user_id);

-- Enable Row Level Security
ALTER TABLE cookbooks ENABLE ROW LEVEL SECURITY;

-- Create policy: Users can view their own cookbooks only
CREATE POLICY "Users can view own cookbooks"
  ON cookbooks
  FOR SELECT
  USING (auth.uid() = user_id);

-- Create policy: Users can insert their own cookbooks
CREATE POLICY "Users can insert own cookbooks"
  ON cookbooks
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create policy: Users can update their own cookbooks
CREATE POLICY "Users can update own cookbooks"
  ON cookbooks
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create policy: Users can delete their own cookbooks
CREATE POLICY "Users can delete own cookbooks"
  ON cookbooks
  FOR DELETE
  USING (auth.uid() = user_id);

-- Deliberately NO public/"published" SELECT policy -- there is currently no
-- policy under which a non-owner's auth.uid() satisfies any of the four
-- policies above, so cookbooks are structurally private at the RLS layer,
-- not just hidden in the UI.

-- Reuse the update_updated_at_column() trigger function already defined in
-- 001_create_recipes_table.sql -- do not redefine it here.
CREATE TRIGGER update_cookbooks_updated_at
  BEFORE UPDATE ON cookbooks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
