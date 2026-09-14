# Jira Comment for REW-78 Documentation

REW-78 now constrains admin feedback assignment to Unassigned, Andrew, or Victoria and validates the selected active profile server-side. Stored profiles may use the exact aliases Andrew or Andrew Carroll, and Victoria or Victoria Johnson; the UI consistently labels them Andrew and Victoria. New and changed named assignments send the new assignee a Resend email after successful persistence, with a direct ticket link derived from `APP_URL`. Unassignment and unchanged/status-only saves send nothing; delivery failure does not roll back the assignment.

Migration 016 is the idempotent provisioning follow-up: it creates or repairs the two assignment profiles from exact Auth email matches only after each user already has the trusted admin role. It does not grant administrator access and has not been applied to remote Supabase in this workflow.

Final review is approved. The full Node suite passes **205/205**, and `git diff --check` passes. No package dependency was added.

Live migration/Resend/browser acceptance remains **pending, not passed**, because verified provider credentials and safe Supabase fixtures were unavailable.

- Plan: https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28573754/REW-78+Admin+Feedback+Assignee+Options+and+Assignment+Email+-+Feature+Plan
- Release notes: https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28409883/Release+REW-78+-+Admin+Feedback+Assignee+Options+and+Assignment+Email
