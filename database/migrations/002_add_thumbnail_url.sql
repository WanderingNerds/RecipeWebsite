-- Add thumbnail_url column to recipes table
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Add comment to explain the column
COMMENT ON COLUMN recipes.thumbnail_url IS 'Smaller thumbnail version of the recipe photo for list views';
