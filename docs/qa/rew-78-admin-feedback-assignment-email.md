# REW-78 Admin Feedback Assignment Email QA

## Scope

This record covers the constrained admin-feedback assignee roster, server-side assignment validation, and post-persistence Resend notification behavior on branch `REW-78-admin-feedback-assignment-email`.

## Current results

- Final reviewer: approved, including the migration 016 provisioning follow-up; no blocking findings remain.
- Full Node suite: 205/205 passed.
- `git diff --check`: passed.
- Automated coverage verifies the Andrew/Victoria-only UI roster and order; exact stored aliases `Andrew`/`Andrew Carroll` and `Victoria`/`Victoria Johnson`; rejection of fuzzy, duplicate, other, or inactive profiles; assignment and reassignment notifications; suppression for unassignment and unchanged assignment; persistence-before-delivery ordering; provider/configuration/timeout failures; direct canonical links; and view contracts.
- Migration 016 adds the narrowly scoped, idempotent assignment-profile backfill. No package dependency was added.

## Pending live acceptance

Live migration, provider, and browser QA did not run because verified Resend credentials and safe Supabase admin/profile/ticket fixtures were unavailable. Migration 016 was not applied remotely. These checks are not marked passed.

After deployment, apply migration 016 after 015, configure `RESEND_API_KEY`, `ASSIGNMENT_EMAIL_FROM`, and canonical `APP_URL`; verify the sender; and ensure each person has one uniquely active profile. Confirm the page labels them Andrew and Victoria, then assign a safe test ticket to each in turn. Confirm each recipient receives exactly one email containing the ticket identity and correct `/admin/feedback/:id` link. Confirm unassignment and same-assignee/status-only saves send nothing. Finally, simulate a provider rejection and verify the assignment remains saved while the administrator sees the separate notification warning.
