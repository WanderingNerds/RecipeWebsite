-- REW-63: Create meal_plans table
--
-- A meal plan is a private, per-user named collection of the owner's
-- recipes scoped to a defined date range -- in contrast to cookbooks
-- (009), which are open-ended, ongoing collections with no schedule.
-- Modeled directly on the `cookbooks` table pattern, plus the required
-- start_date/end_date range this ticket adds.
--
-- REW-26 (grocery list generation) is expected to build on top of this
-- table plus meal_plan_recipes (012) via a join query -- no further
-- migration should be required for REW-26 to read a meal plan's recipes.

CREATE TABLE IF NOT EXISTS meal_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Basic information
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),

  -- Scheduled period this meal plan covers. Plain DATE columns (no
  -- time-of-day/timezone handling) -- see Open Questions #5 in the
  -- REW-63 plan. No uniqueness/overlap constraint across a user's plans
  -- is intentional -- nothing in the AC requires plans to be mutually
  -- exclusive in time.
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  CHECK (end_date >= start_date),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_meal_plans_user_id ON meal_plans(user_id);

-- Secondary index to cheaply support a future "upcoming/past plans" sort
-- on the list page.
CREATE INDEX IF NOT EXISTS idx_meal_plans_user_id_start_date ON meal_plans(user_id, start_date);

-- Enable Row Level Security
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;

-- Create policy: Users can view their own meal plans only
CREATE POLICY "Users can view own meal plans"
  ON meal_plans
  FOR SELECT
  USING (auth.uid() = user_id);

-- Create policy: Users can insert their own meal plans
CREATE POLICY "Users can insert own meal plans"
  ON meal_plans
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create policy: Users can update their own meal plans
CREATE POLICY "Users can update own meal plans"
  ON meal_plans
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create policy: Users can delete their own meal plans
CREATE POLICY "Users can delete own meal plans"
  ON meal_plans
  FOR DELETE
  USING (auth.uid() = user_id);

-- Deliberately NO public/shared SELECT policy -- there is currently no
-- policy under which a non-owner's auth.uid() satisfies any of the four
-- policies above, so meal plans are structurally private at the RLS
-- layer, not just hidden in the UI. Satisfies "Meal Plans are private to
-- the user who created them" in the REW-63 AC.

-- Reuse the update_updated_at_column() trigger function already defined in
-- 001_create_recipes_table.sql -- do not redefine it here.
CREATE TRIGGER update_meal_plans_updated_at
  BEFORE UPDATE ON meal_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
