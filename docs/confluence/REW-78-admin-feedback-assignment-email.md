# Release: REW-78 - Admin Feedback Assignee Options and Assignment Email

Published at [Release: REW-78 - Admin Feedback Assignee Options and Assignment Email](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28409883/Release+REW-78+-+Admin+Feedback+Assignee+Options+and+Assignment+Email).

## Jira issue

[REW-78 — Admin Feedback: Fix Assignee Options and Send Assignment Email](https://wanderingnerds.atlassian.net/browse/REW-78)

## Summary of change

The admin feedback detail page now offers exactly Unassigned, Andrew, and Victoria. Submitted profile UUIDs are resolved against active database profiles and the fixed server-side roster before persistence.

When a ticket moves from unassigned or the other named assignee to Andrew or Victoria, the application persists the assignment first and then sends one plain-text email to the new assignee through Resend. The message identifies the ticket and links directly to its admin detail page using the configured application origin.

## User impact

Administrators have a predictable assignment list and receive clear feedback for a successful notification or a saved assignment whose notification failed. Unassignment and unchanged assignments do not generate mail.

## Technical impact

- Canonical roster: Andrew (`carroll.andrew@gmail.com`) and Victoria (`vhobbs1895@gmail.com`), held server-side. Explicit stored-name aliases support `Andrew Carroll` and `Victoria Johnson` while preserving the short UI labels; no fuzzy matching is used.
- Delivery: Resend HTTPS API through built-in `fetch`, with a five-second timeout.
- Configuration: `RESEND_API_KEY`, `ASSIGNMENT_EMAIL_FROM`, and canonical `APP_URL`.
- Failure boundary: database persistence is authoritative; a later provider failure is reported without rollback.
- Security: the browser supplies only a profile UUID; recipient addresses, provider credentials, and link origins cannot be overridden by request data.

## Database and API changes

No database migration or package dependency was added. Existing nullable `help_feedback_submissions.assignee_id`, active-profile checks, admin authentication, RLS, CSRF, and Post/Redirect/Get behavior remain in place. The existing admin feedback routes now constrain selectable profiles and trigger post-persistence notifications; no public API was added.

## Testing notes

Final review is approved. The full Node suite passes 202/202 and `git diff --check` passes. Live provider and browser QA remains pending because verified Resend credentials and safe Supabase fixtures were unavailable.

## Deployment and acceptance

Set the three environment variables, verify the Resend sender, and ensure exactly one active recognized `admin_profiles` row exists for each person. Assign a safe test ticket to Andrew and Victoria in turn and verify recipient, ticket identity, and direct link. Verify unassignment and unchanged/status-only saves send nothing. Simulate provider rejection and confirm persistence plus the separate warning.
