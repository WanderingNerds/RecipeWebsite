# REW-80 acceptance and QA record

## Scope and verdict

**Verdict: PASS for code-level acceptance; live Supabase and authenticated-browser acceptance remains pending.**

This independent QA pass was performed on branch `REW-80-add-timestamped-progress-comments` after the reviewer-approved handoff. It checked the REW-80 plan and acceptance criteria against the implementation diff without changing application code or applying migration 017 to a live database.

## Automated checks

### Passed

- Focused REW-80 suite:
  - Command: `node --test database/migrations/017_add_feedback_progress_comments.test.js src/utils/adminFeedbackComments.test.js src/routes/adminFeedbackRoutes.test.js src/views/adminFeedback.test.js`
  - Result: **27 passed, 0 failed, 0 skipped**.
- Full repository suite:
  - Command: `npm test`
  - Result: **250 passed, 0 failed, 0 skipped**.
  - The printed `ForbiddenError: invalid csrf token` messages are expected output from the passing global CSRF rejection-path integration test, not test failures.
- Diff hygiene:
  - Command: `git diff --check`
  - Result: **passed with no output**.
- Build script:
  - Command: `npm run build`
  - Result: **passed** (`No build step required`).

### Failed

- None.

### Skipped automated checks

- None. Both the focused and full Node runs reported zero skipped tests.

## Acceptance evidence

### Passed by automated test and source inspection

- Nonblank comments are trimmed and accepted; whitespace-only, non-string, and over-5,000-code-point inputs are rejected before database access.
- The POST handler verifies the ticket and an active administrator profile under the request-scoped authenticated Supabase client before inserting.
- Inserted values derive `author_id` from `req.user.id` and `author_display_name` from the active profile lookup. Browser-supplied author and timestamp fields are ignored, and `created_at` is omitted so PostgreSQL supplies `NOW()`.
- Comment insertions create new rows and do not expose an update/delete application path.
- Migration 017 grants authenticated clients only `SELECT` and `INSERT`, defines no UPDATE/DELETE policy, enables RLS, requires the trusted `app_metadata.role = 'admin'`, binds `author_id` to `auth.uid()`, and requires the active profile's exact display name.
- Migration 017 stores a durable name snapshot, enforces trimmed comment text of 1–5,000 PostgreSQL characters, and uses `TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- Detail loading requests `created_at ASC` and then `id ASC`, providing a stable oldest-first tie-breaker.
- Central-time formatting uses the `America/Chicago` IANA zone. Deterministic tests passed for CST, CDT, and both sides of the 2026 spring DST transition.
- Rendered semantic `<time>` elements retain the stored machine-readable timestamp in `datetime` while displaying the Central-time formatted value.
- EJS renders comment text, author names, and preserved drafts with escaped interpolation. A rendered test confirmed script/HTML payloads are encoded; CSS `white-space: pre-wrap` preserves newlines without interpreting markup.
- The detail form includes a labeled required textarea, explanatory 5,000-character limit, CSRF hidden field, and non-script-dependent POST action.
- The admin feedback router places GET and both POST handlers behind router-level `requireAdmin`. The full suite's global CSRF integration test confirmed invalid URL-encoded and JSON mutations are rejected while valid paired tokens proceed through router chains.
- Malformed ticket IDs, missing tickets, inactive/missing profiles, comment-history query errors, and insert/query failures follow controlled responses and do not expose database details or insert a comment in the tested paths.
- Existing admin feedback assignment behavior remained green in the full regression suite.

## Pending live acceptance

- Regression compatibility: hosted Supabase returned `PGRST205` before migration 017 was applied. The detail-page fallback and safe POST failure are covered by automated tests, but should be confirmed in the hosted environment both before and after applying migration 017.

The following checks were **not performed and must not be treated as passed**:

- Apply migration 017 to an authorized non-production Supabase environment and confirm the table, foreign keys, index, grants, and RLS behavior against PostgreSQL itself.
- Sign in as Andrew with a trusted admin claim and active profile; add a comment and verify persisted text, Andrew's durable display-name snapshot, and database-generated time after navigating away and reopening the ticket.
- Repeat the authenticated persistence flow as Victoria.
- Add multiple comments from both administrators and confirm stable oldest-first display after reopening the page.
- Attempt direct reads/inserts as unauthenticated and ordinary authenticated non-admin users and confirm RLS denies them.
- Attempt forged author/timestamp payloads against the running application and confirm stored authorship/time remain server/database controlled.
- Exercise blank, whitespace-only, 5,001-character, malformed-ticket, missing-ticket, and inactive/missing-profile submissions in a browser and confirm controlled feedback and draft preservation where applicable.
- Visually and keyboard-check the desktop/mobile history layout, empty state, focus behavior, flash messages, and comment form accessibility.
- Confirm actual persisted timestamps render as CST or CDT as appropriate in the deployed runtime.

These checks require an applied migration, safe feedback fixtures, and authenticated Andrew/Victoria/non-admin test accounts. No live migration or production-data write was attempted during this QA pass.
