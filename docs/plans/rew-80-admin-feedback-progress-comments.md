## Jira issue

[REW-80 — Admin Feedback — Add Timestamped Progress Comments](https://wanderingnerds.atlassian.net/browse/REW-80)

## Confluence page

[REW-80: Admin Feedback Timestamped Progress Comments - Feature Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/29097985/REW-80+Admin+Feedback+Timestamped+Progress+Comments+-+Feature+Plan)

## Summary

Add an append-only progress-comment history to each protected admin feedback detail page. Administrators can submit multiple nonblank comments; each persisted entry records the authenticated administrator, a durable display-name snapshot, and a database-generated timestamp. The detail page renders comments oldest-first and formats timestamps in the `America/Chicago` IANA time zone so Central Standard and Daylight Time are applied automatically.

## As-shipped status

Implemented on `REW-80-add-timestamped-progress-comments` with migration 017 and no new dependency or environment variable. The admin detail route loads comments by `created_at` and `id`, accepts new comments at `POST /admin/feedback/:id/comments`, derives authorship from the authenticated user and active admin profile, and preserves invalid drafts through flash state. Comments are escaped plain text, append-only under database grants/RLS, capped at 5,000 Unicode code points, and displayed with an `America/Chicago` formatter while retaining the stored instant in semantic markup.

Final review approved the implementation with no blockers. Code-level QA passed: focused REW-80 tests 27/27, full suite 250/250, `npm run build`, and `git diff --check`. Migration 017 has not been applied to a live Supabase environment, and authenticated Andrew/Victoria/non-admin browser and RLS acceptance remains pending.

## Open questions / assumptions

- Comments are visible to any authenticated administrator who can open the ticket, not only its current assignee.
- Comment authorship comes from the authenticated admin and their active `admin_profiles` row; the browser cannot submit an author identity.
- Existing comments are immutable through the application and database grants. No edit/delete workflow is included.
- The comment body is plain text, trimmed, required, and capped at 5,000 characters.
- UTC is stored in PostgreSQL; Central Time conversion occurs only for display.

## Tasks

1. Add migration 017 for an append-only feedback progress-comments table keyed to the feedback ticket and authenticated author, with a durable author-name snapshot, server-generated timestamp, length constraints, chronological index, admin-only SELECT/INSERT RLS, and no UPDATE/DELETE grants.
2. Add comment normalization/validation and Central Time formatting utilities, with deterministic tests across CST/CDT and DST boundaries.
3. Extend the detail loader to fetch comments oldest-first alongside ticket/assignee data and render a controlled error if history cannot be loaded.
4. Add a protected POST comment endpoint that validates ticket UUID and body, derives author UUID/name server-side, verifies the ticket/profile under the request-scoped RLS client, inserts one comment, and redirects with 303.
5. Add an accessible progress-history section and comment form to the ticket detail page, including CSRF, empty state, preserved invalid text, author, semantic time metadata, and non-script-dependent behavior.
6. Add migration, route, utility, and view tests for append-only persistence, ordering, author spoof resistance, validation, Central timestamps, security middleware, CSRF contract, and escaped output.
7. Update API/database documentation and perform focused tests, the full Node test suite, and `git diff --check`; record live Supabase/browser acceptance separately.

## Affected files

- `database/migrations/017_add_feedback_progress_comments.sql` (new) — comments schema, index, grants, RLS, and append-only policy.
- `database/migrations/017_add_feedback_progress_comments.test.js` (new) — migration contract tests.
- `src/utils/adminFeedbackComments.js` (new) — comment validation and Central Time formatter.
- `src/utils/adminFeedbackComments.test.js` (new) — boundary, invalid input, and CST/CDT coverage.
- `src/routes/adminFeedbackRoutes.js` — load chronological history and handle comment creation.
- `src/routes/adminFeedbackRoutes.test.js` — GET/POST comment behavior, authorship, ordering, failures, and redirect tests.
- `views/admin/feedback-detail.ejs` — progress-comment history, empty state, timestamps, and add-comment form.
- `src/views/adminFeedback.test.js` — rendered comments, escaping, form, CSRF, and accessibility contracts.
- `public/css/styles.css` — responsive comment history and form styling within the existing design system.
- `database/README.md` — migration/table/RLS/index documentation.
- `docs/api/admin-feedback.md` and `docs/api/README.md` — comment endpoint and behavior documentation.
- `docs/qa/rew-80-admin-feedback-progress-comments.md` (later QA output) — actual automated/live acceptance results.

## Database changes

Migration 017 creates a dedicated progress-comments table with generated UUID, ticket foreign key with cascade cleanup, authenticated author UUID, immutable author display-name snapshot, constrained comment text, and `TIMESTAMPTZ NOT NULL DEFAULT NOW()`. Add a `(feedback_submission_id, created_at, id)` index for stable oldest-first history. Enable RLS and allow only trusted admin-role SELECT and INSERT, with insert checks binding author UUID to `auth.uid()` and the snapshot to that user's active admin profile. Do not grant UPDATE or DELETE.

The migration exists locally but was not applied to a remote Supabase project during this workflow.

## Security considerations

- Keep router-level `requireAdmin`, global CSRF, request-scoped Supabase/RLS access, UUID validation, and Post/Redirect/Get.
- Derive author identity from `req.user.id` and the database; reject browser-supplied author/timestamp values.
- Treat comment text and stored display names as untrusted and rely on escaped EJS interpolation.
- Enforce length/nonblank rules in both application and database; avoid logging comment content or personal ticket content.
- Store absolute timestamps and format with `America/Chicago`; do not hard-code CST or a fixed UTC offset.
- Append-only grants and policies prevent overwriting existing history.

## Acceptance criteria

- [ ] An authenticated admin can add a nonblank progress comment from an existing feedback detail page.
- [ ] Each saved comment persists its text, authenticated author display name, and database-generated submission time.
- [ ] The browser cannot spoof author identity or timestamp.
- [ ] Multiple comments persist and display oldest-first with a stable tie-breaker; adding one never overwrites earlier entries.
- [ ] Displayed timestamps use `America/Chicago`, showing CST or CDT correctly for the instant, while semantic `datetime` values remain machine-readable.
- [ ] Comments remain visible after navigating away and reopening the ticket.
- [ ] Both Andrew and Victoria can comment when authenticated as admins with active profiles.
- [ ] Blank/whitespace, over-5,000-character, malformed-ticket, missing-ticket, and inactive/missing-profile submissions do not insert comments and receive controlled feedback.
- [ ] Comment text and author names are escaped; newline formatting does not enable HTML/script execution.
- [ ] Unauthenticated/non-admin requests cannot read or create progress comments, and CSRF protection remains active.
- [ ] Focused tests, the full Node suite, and `git diff --check` pass; live Supabase/browser checks are recorded separately.
