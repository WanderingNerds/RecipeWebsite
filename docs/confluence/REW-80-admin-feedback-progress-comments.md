# Release: REW-80 - Admin Feedback Timestamped Progress Comments

Published at [Release: REW-80 - Admin Feedback Timestamped Progress Comments](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/29163521/Release+REW-80+-+Admin+Feedback+Timestamped+Progress+Comments).

## Jira issue

[REW-80 — Admin Feedback — Add Timestamped Progress Comments](https://wanderingnerds.atlassian.net/browse/REW-80)

## Summary of change

Admin feedback detail pages now contain an append-only progress history. Authenticated administrators can add multiple plain-text comments; each entry persists the server-derived author, a durable author-name snapshot, and a database-generated timestamp. History displays oldest-first and renders time in `America/Chicago`, automatically selecting CST or CDT.

## User impact

Andrew and Victoria can document work directly on a ticket and revisit the complete chronological history. Invalid drafts are preserved for correction. Existing comments cannot be edited or deleted through the application.

## Technical impact

- New protected endpoint: `POST /admin/feedback/:id/comments`.
- Router-level admin auth, application-wide CSRF, UUID checks, request-scoped Supabase access, and Post/Redirect/Get remain in force.
- Comment input is trimmed, nonblank, escaped, and limited to 5,000 Unicode code points.
- The server derives author UUID/name from the session and active profile; the database supplies `created_at`.
- Stable reads order by `created_at`, then `id`.
- No new dependency, environment variable, external service, or public API was added.

## Database changes

Migration 017 creates `feedback_progress_comments` with ticket and author references, durable author-name snapshots, constrained text, `TIMESTAMPTZ DEFAULT NOW()`, and a `(feedback_submission_id, created_at, id)` index. Authenticated clients receive SELECT and INSERT only. Admin-only RLS binds inserts to `auth.uid()` and the caller's active profile; no UPDATE or DELETE grant/policy exists.

## Testing notes

Final review approved the change with no blockers. Focused tests passed 27/27, the full suite passed 250/250 with zero skips, `npm run build` passed, and `git diff --check` passed. Expected invalid-CSRF logging came from passing rejection-path tests.

Live acceptance remains pending: migration 017 has not been applied remotely, and authenticated Andrew/Victoria/non-admin browser, RLS, persistence, forged-field, responsive, and accessibility checks were not performed. REW-80 remains open until those checks pass.

## Deployment

Apply migration 017 after 016 in an authorized environment, then complete the live checks recorded in `docs/qa/rew-80-admin-feedback-progress-comments.md`. No configuration change is required.
