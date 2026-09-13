# Jira Comment for REW-71 Restart Documentation

Documentation now reflects the restarted REW-71 implementation built from the clean merged REW-70 baseline. The prior local REW-71 attempt was intentionally scrapped and is not represented as shipped or accepted; its REW-72/REW-73 findings were retained as design constraints in the current implementation.

Final review is approved. Current listener-capable local/static QA passes **185/185 with zero skips**, including HTTP/security, CSRF, isolated auth, caller-bound POST logout, fetch wrapper, multipart, migration smoke, and contract checks.

Live QA is **blocked, not passed**. The configured Supabase project lacks migrations 014/015 and safe admin/regular/active/inactive fixtures. Pending: deploy both migrations, provision fixtures, then run direct RLS/grant, forced-intake, immutable-column, workflow/assignment, refresh/logout, and responsive browser/keyboard acceptance.

- Plan: https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28409857/REW-71+Admin+Login+and+Help+Feedback+Management+-+Feature+Plan
- Release notes: https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28475393/Release+REW-71+-+Admin+Login+and+Help+Feedback+Management

REW-71 remains **In Progress** pending live acceptance.
