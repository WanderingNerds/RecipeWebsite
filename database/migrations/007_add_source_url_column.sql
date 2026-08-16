-- Add source_url column for imported recipes
-- This stores the original URL where the recipe was imported from

ALTER TABLE recipes
ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Create index for potential future querying by source
CREATE INDEX IF NOT EXISTS idx_recipes_source_url ON recipes(source_url) WHERE source_url IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN recipes.source_url IS 'Original URL where the recipe was imported from';
