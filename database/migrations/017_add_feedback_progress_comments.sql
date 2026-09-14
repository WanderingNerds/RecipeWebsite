-- REW-80: append-only administrator progress history for feedback submissions.
CREATE TABLE public.feedback_progress_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_submission_id UUID NOT NULL REFERENCES public.help_feedback_submissions(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.admin_profiles(id),
  author_display_name TEXT NOT NULL CHECK (char_length(btrim(author_display_name)) BETWEEN 1 AND 120),
  comment_text TEXT NOT NULL CHECK (
    comment_text = btrim(comment_text)
    AND char_length(comment_text) BETWEEN 1 AND 5000
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX feedback_progress_comments_submission_created_idx
  ON public.feedback_progress_comments (feedback_submission_id, created_at, id);

ALTER TABLE public.feedback_progress_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feedback_progress_comments FROM anon, authenticated;
GRANT SELECT, INSERT ON public.feedback_progress_comments TO authenticated;

CREATE POLICY "Admins can read feedback progress comments"
  ON public.feedback_progress_comments FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admins can add feedback progress comments"
  ON public.feedback_progress_comments FOR INSERT TO authenticated
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    AND author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.admin_profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.active = TRUE
        AND profile.display_name = author_display_name
    )
  );
