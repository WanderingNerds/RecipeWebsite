# Jira Comment for REW-80 Documentation

REW-80 is implemented, final-review approved, and documented at the code-validation stage. Admin feedback tickets now support append-only progress comments with authenticated author attribution, durable display-name snapshots, database-generated timestamps, stable chronological history, and Central Time display through `America/Chicago`. Input is escaped plain text limited to 5,000 Unicode code points, and invalid drafts are preserved for correction.

Migration 017 creates the comments table, chronological index, SELECT/INSERT-only grants, and admin RLS that binds authorship to the authenticated user's active profile. No package, environment-variable, or external-service changes were added.

Focused tests passed **27/27**, the full suite passed **250/250** with zero skips, `npm run build` passed, and `git diff --check` passed. Final review found no blockers.

Live Supabase and authenticated-browser acceptance remains **pending, not passed**. Migration 017 has not been applied remotely, and Andrew/Victoria/non-admin persistence, RLS, forged-field, responsive, and accessibility checks remain outstanding. The ticket has not been transitioned to Done.

- Plan: https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/29097985/REW-80+Admin+Feedback+Timestamped+Progress+Comments+-+Feature+Plan
- Release notes: https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/29163521/Release+REW-80+-+Admin+Feedback+Timestamped+Progress+Comments
