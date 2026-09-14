# Release Notes: REW-78 - Admin Feedback Assignee Options and Assignment Email

**Date:** 2026-09-13  
**Jira:** [REW-78](https://wanderingnerds.atlassian.net/browse/REW-78)  
**Branch:** `REW-78-admin-feedback-assignment-email`

The admin feedback detail page now limits assignment to Unassigned, Andrew, or Victoria. The server independently enforces that roster, so forged, inactive, unknown, or ambiguous profile selections cannot update a ticket.

A new or changed named assignment sends the newly assigned person a plain-text Resend email after the database update succeeds. The email identifies the ticket and includes a canonical direct link derived from `APP_URL`. Unassignment, same-assignee saves, status-only saves, validation failures, and persistence failures do not send email. If delivery fails after persistence, the assignment remains saved and the administrator receives a separate, non-sensitive warning.

Deployment requires applying migration 016 after 015, plus `RESEND_API_KEY`, `ASSIGNMENT_EMAIL_FROM`, and canonical `APP_URL`. Migration 016 idempotently creates or repairs the two assignment profiles from already-authorized Auth users; it does not grant admin access. Stored names may be `Andrew` or `Andrew Carroll`, and `Victoria` or `Victoria Johnson`; the UI labels remain Andrew and Victoria. No package dependency was added.

Final review is approved. The full Node suite passes 205/205 and `git diff --check` passes. Live migration, Resend, and browser acceptance remains pending because provider credentials and safe fixtures were unavailable; see [the QA record](qa/rew-78-admin-feedback-assignment-email.md).
