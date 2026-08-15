-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on slug for faster lookups
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

-- Create index on display_order for sorting
CREATE INDEX IF NOT EXISTS idx_categories_display_order ON categories(display_order);

-- Enable Row Level Security
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Create policy: All authenticated users can read categories
CREATE POLICY "Authenticated users can read categories"
  ON categories
  FOR SELECT
  TO authenticated
  USING (true);

-- Seed default categories
INSERT INTO categories (name, slug, description, icon, display_order) VALUES
  ('Breakfast', 'breakfast', 'Morning meals and brunch recipes', '🌅', 1),
  ('Lunch', 'lunch', 'Midday meals and light bites', '☀️', 2),
  ('Dinner', 'dinner', 'Evening meals and main courses', '🌙', 3),
  ('Appetizers', 'appetizers', 'Starters and finger foods', '🥗', 4),
  ('Desserts', 'desserts', 'Sweet treats and baked goods', '🍰', 5),
  ('Beverages', 'beverages', 'Drinks, smoothies, and cocktails', '🍹', 6),
  ('Soups', 'soups', 'Warm soups and stews', '🍲', 7),
  ('Salads', 'salads', 'Fresh salads and dressings', '🥬', 8),
  ('Sides', 'sides', 'Side dishes and accompaniments', '🍟', 9),
  ('Baking', 'baking', 'Breads, pastries, and baked items', '🍞', 10)
ON CONFLICT (slug) DO NOTHING;
