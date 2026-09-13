CREATE TABLE admin_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE help_feedback_submissions
  DROP CONSTRAINT help_feedback_submissions_status_check,
  ADD CONSTRAINT help_feedback_submissions_status_check CHECK (status IN ('new', 'in_progress', 'done')),
  ADD COLUMN assignee_id UUID REFERENCES admin_profiles(id) ON DELETE SET NULL;
CREATE INDEX help_feedback_submissions_assignee_id_idx ON help_feedback_submissions (assignee_id);

REVOKE UPDATE ON help_feedback_submissions FROM authenticated;
GRANT UPDATE (status, assignee_id) ON help_feedback_submissions TO authenticated;

CREATE FUNCTION enforce_active_help_feedback_assignee() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id AND NEW.assignee_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM admin_profiles ap WHERE ap.id = NEW.assignee_id AND ap.active = TRUE)
  THEN RAISE EXCEPTION 'Help feedback assignee must be active' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_active_help_feedback_assignee_before_update
  BEFORE UPDATE OF assignee_id ON help_feedback_submissions FOR EACH ROW
  EXECUTE FUNCTION enforce_active_help_feedback_assignee();

DROP POLICY "Authenticated users can submit their own help feedback" ON help_feedback_submissions;
CREATE POLICY "Authenticated users can submit their own help feedback" ON help_feedback_submissions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'new' AND assignee_id IS NULL);

CREATE POLICY "Admins can read admin profiles" ON admin_profiles FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admins can read help feedback" ON help_feedback_submissions FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admins can update help feedback" ON help_feedback_submissions FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    AND status IN ('new', 'in_progress', 'done')
    AND (assignee_id IS NULL OR EXISTS (SELECT 1 FROM admin_profiles ap WHERE ap.id = assignee_id)));
