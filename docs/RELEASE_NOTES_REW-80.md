# Release Notes: REW-80 - Admin Feedback Timestamped Progress Comments

**Date:** 2026-09-14  
**Jira:** [REW-80](https://wanderingnerds.atlassian.net/browse/REW-80)  
**Branch:** `REW-80-add-timestamped-progress-comments`

## Summary

Admin feedback tickets now include an append-only progress history. Administrators can add multiple plain-text comments, and every entry shows its author and a Central Time timestamp.

## User impact

- Andrew and Victoria can record ongoing work directly on a feedback ticket.
- Comments remain visible after leaving and reopening the detail page and display oldest-first.
- Each comment shows a durable author name and a timestamp that automatically follows CST/CDT.
- Invalid comment text receives controlled feedback and is preserved for correction.
- Existing comments cannot be edited or deleted through the application.

## Technical impact

- Added `POST /admin/feedback/:id/comments` behind the existing admin and CSRF protections.
- Authorship is derived from the authenticated user and their active `admin_profiles` row; browser-supplied author/timestamp fields are ignored.
- Comment text is trimmed, required, escaped on output, and limited to 5,000 Unicode code points.
- Detail reads use `created_at` plus `id` for stable chronological ordering.
- Display uses the `America/Chicago` IANA zone while semantic `datetime` retains the stored instant.
- No package, environment-variable, or external-service changes were introduced.

## Database and deployment

Apply migration 017 after migration 016. It creates `feedback_progress_comments` with a ticket foreign key, authenticated author, durable display-name snapshot, database-generated `TIMESTAMPTZ`, and a chronological composite index. Authenticated clients receive SELECT and INSERT only; RLS further requires the trusted admin claim and binds insert authorship to `auth.uid()` and an active matching profile. No UPDATE or DELETE grant or policy exists.

Migration 017 was not applied to a live Supabase project during this workflow.

## Validation

- Final reviewer verdict: **Approved; no blockers.**
- Focused REW-80 tests: **27 passed, 0 failed, 0 skipped**.
- Full Node suite: **250 passed, 0 failed, 0 skipped**.
- `npm run build`: **passed** (`No build step required`).
- `git diff --check`: **passed**.

Live Supabase and authenticated-browser acceptance remains **pending, not passed**. This includes applying migration 017, PostgreSQL RLS/grant verification, Andrew and Victoria persistence checks, non-admin denial, forged-author/timestamp checks, and desktop/mobile accessibility and visual checks. REW-80 must not be transitioned to Done until those checks pass.

## Related documentation

- [Implementation plan](plans/rew-80-admin-feedback-progress-comments.md)
- [Admin feedback API](api/admin-feedback.md)
- [Acceptance / QA record](qa/rew-80-admin-feedback-progress-comments.md)
