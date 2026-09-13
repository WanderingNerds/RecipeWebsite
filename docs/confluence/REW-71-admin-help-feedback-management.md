# Release: REW-71 - Admin Login and Help & Feedback Management

Jira: https://wanderingnerds.atlassian.net/browse/REW-71

## Implementation lineage

This page now describes the restarted implementation built from the clean merged REW-70 baseline (`2ee900a`). The earlier REW-71 local attempt was intentionally scrapped and is not shipped. Its REW-72/REW-73 review lessons were carried into the current design: isolated auth clients, workflow-column-only grants, unassigned intake, and OLD/NEW-aware active-assignee validation.

## What the current implementation delivers

- Separate, rate-limited `/admin/login` with generic denial and fresh non-persisting Supabase clients.
- POST-only caller-bound logout and refreshed-session admin-claim revalidation.
- Admin-only newest-first feedback queue with All, Unresolved, and Done filters.
- Escaped ticket detail and status/assignment controls, including clear preservation of an inactive current assignee.
- Express authorization and independent RLS based only on trusted `app_metadata.role = "admin"`.
- Migration 015 with admin profiles, workflow/assignment fields, column-limited UPDATE, unassigned intake, and OLD/NEW-aware assignment enforcement.
- Application-wide CSRF for unsafe requests, with post-Multer validation for multipart forms and same-origin fetch-token injection.
- Conditional admin navigation and responsive Potluck views.

## Validation

Final review approved. Current local/static QA passes 185/185 with zero skips in a listener-capable environment. HTTP/security, CSRF, auth/logout, fetch, multipart, migration smoke, and contract checks pass. These are results for the restarted implementation.

Live Supabase/browser acceptance is blocked, not passed: the configured project lacks migrations 014/015 and the required safe admin/regular/active/inactive fixtures.

## Deployment and remaining acceptance

Apply migrations 014 and 015 in order. Provision the trusted admin claim and matching profiles out of band, refresh authentication, then verify direct RLS/grants, forced intake fields, immutable content columns, assignment/status semantics, CSRF, refresh/logout, queue/detail/filter behavior, and responsive keyboard/browser use. REW-71 remains In Progress until live acceptance is recorded.
