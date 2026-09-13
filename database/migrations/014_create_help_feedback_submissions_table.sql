-- REW-70: authenticated Help & Feedback intake.
-- REW-71 will add narrowly scoped administrator read/update policies and assignment modeling.
CREATE TABLE help_feedback_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Keep the submitter reference required and use PostgreSQL's default NO ACTION
  -- behavior so deleting an auth account cannot silently erase durable intake.
  user_id UUID NOT NULL REFERENCES auth.users(id),
  contact_name TEXT NOT NULL CHECK (char_length(btrim(contact_name)) BETWEEN 1 AND 120),
  contact_email TEXT NOT NULL CHECK (char_length(btrim(contact_email)) BETWEEN 1 AND 254),
  category TEXT NOT NULL CHECK (category IN ('Question', 'Issue report', 'Feedback', 'Help request', 'Other')),
  subject TEXT NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 200),
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 5000),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status = 'new'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX help_feedback_submissions_created_at_idx
  ON help_feedback_submissions (created_at DESC);
CREATE INDEX help_feedback_submissions_status_created_at_idx
  ON help_feedback_submissions (status, created_at DESC);

CREATE TRIGGER update_help_feedback_submissions_updated_at
  BEFORE UPDATE ON help_feedback_submissions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE help_feedback_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can submit their own help feedback"
  ON help_feedback_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'new');

-- Intentionally no SELECT, UPDATE, or DELETE policy for ordinary users.
