## Jira issue

[REW-71 — Create Admin Login and Help & Feedback Management Page](https://wanderingnerds.atlassian.net/browse/REW-71), with completed blocking lessons from [REW-72](https://wanderingnerds.atlassian.net/browse/REW-72) and [REW-73](https://wanderingnerds.atlassian.net/browse/REW-73).

## Confluence page

[REW-71: Admin Login and Help & Feedback Management - Feature Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28409857/REW-71+Admin+Login+and+Help+Feedback+Management+-+Feature+Plan)

## Summary

Restart REW-71 on the clean, merged REW-70 baseline by adding a separate administrator login and an admin-only Help & Feedback queue/detail workflow. Authorized administrators can review all submissions, identify unresolved versus completed work, assign tickets to active admin/team profiles, and move tickets among New/To Do, In Progress, and Done. The implementation must enforce admin authorization in Express and Supabase RLS, and must incorporate every prior review/QA lesson: isolated per-request auth clients, workflow-column-only database updates, an unassigned intake invariant, and OLD/NEW-aware assignee validation that permits status-only updates on tickets whose existing assignee later becomes inactive.

## Open questions / assumptions

- This is a fresh implementation plan. Jira records that the prior REW-71 implementation and local changes were intentionally scrapped; no prior code or claimed QA result is treated as shipped. Historical review findings are retained as mandatory design constraints.
- `main` and branch `REW-71-admin-feedback-management` both point to `2ee900a`, which includes merged REW-70 migration 014, intake route, form, dashboard card, and tests. Migration 015 may now build directly on that baseline.
- Admin authorization uses a server-verified Supabase Auth `app_metadata.role = "admin"` claim. User-editable `user_metadata`, email allowlists, navigation visibility, and request fields are not authorization sources. Claim/profile provisioning is an out-of-band Supabase operation; self-promotion and admin-roster management are outside scope.
- An `admin_profiles` table keyed to `auth.users(id)` provides display names and an `active` flag for assignment. A ticket may be unassigned. Only active profiles may be newly selected, but an inactive profile already assigned to a ticket remains visible and may remain assigned during a status-only save; the admin can explicitly reassign or unassign it.
- Reuse Supabase email/password authentication at `/admin/login`, but create a fresh non-persisting auth client per login, refresh, and logout request. Logout must bind and revoke the caller's token pair, never implicit process-global session state.
- Store status as `new`, `in_progress`, or `done`, displaying `new` as “New / To Do.” The queue defaults newest first and offers All, Unresolved (`new` + `in_progress`), and Done filters. Pagination, search, bulk actions, comments, priority, SLA, attachments, outbound email, audit history, and admin-profile management remain outside scope.
- Admins update only `status` and `assignee_id`. Submission owner/contact/content/timestamps are immutable through the authenticated PostgREST update privilege; `updated_at` continues to be trigger-managed.
- Because global CSRF is disabled in the current `src/app.js`, this ticket must enable effective token validation for state-changing requests and update every existing POST form/test affected by application-wide enforcement. Admin login attempts also require dedicated rate limiting in production.
- Live Supabase/browser acceptance requires migrations 014 and 015 in a safe environment plus provisioned admin, regular-user, active-profile, and inactive-profile fixtures. Static/mocked tests are necessary but cannot substitute for direct RLS and concurrency validation.

## Tasks

1. Establish focused baseline coverage for merged REW-70 and document that migration 014 already creates both `created_at` and `(status, created_at)` indexes; migration 015 must reuse them and must not create a duplicate status/created index.
2. Add migration 015 to create admin profiles, extend submission status to the three-state workflow, add nullable assignment, and add only genuinely new indexes (for example assignee lookup if justified). Replace the REW-70 intake INSERT policy so authenticated users must insert their own `new`, unassigned ticket.
3. Add admin-only SELECT policies for submissions and assignable profiles. Revoke broad authenticated UPDATE on submissions and grant UPDATE only on `status` and `assignee_id`; retain a real-profile check in RLS and database constraints while leaving `updated_at` trigger-owned.
4. Enforce assignment activity with an OLD/NEW-aware database mechanism: validate `active = TRUE` only when `assignee_id` changes to a non-null value. Allow status-only updates or an explicitly unchanged assignment when the current profile has since become inactive; reject newly assigning any inactive/nonexistent profile.
5. Add an isolated Supabase auth-client factory configured without persisted or automatic session state. Use a new instance for each admin login, token refresh, and logout; bind logout to the requesting user's access/refresh tokens before revocation. Keep request-scoped data clients tied to the verified access token so RLS remains authoritative.
6. Add reusable admin-claim/status/filter/UUID helpers and `requireAdmin` middleware. Revalidate the trusted admin claim after refresh, rotate cookies consistently, expose admin state to views only after verification, and reject anonymous and regular users without disclosing protected data.
7. Add admin auth routes and view for GET/POST login and logout. Validate inputs, use generic credential/authorization errors, retain cookies only for authorized admins, clear state after a non-admin login attempt, use Post/Redirect/Get, and rate-limit production login attempts.
8. Add protected admin feedback routes for the newest-first queue, filter selection, detail view, and workflow update. Select only required fields, preserve an inactive current assignee in the detail choices, permit active new choices and unassignment, validate every submitted value, distinguish missing records safely, and avoid sensitive logging.
9. Add accessible EJS views and responsive Potluck styles for admin login, queue, status badges/filtering, detail display, and workflow controls. Escape all submitter-controlled fields; represent state with text as well as color; include semantic labels, focus states, validation feedback, and CSRF tokens.
10. Enable effective CSRF protection and update all existing state-changing forms/tests to the actual token contract without regressing REW-70 intake or existing recipe/account workflows.
11. Add robust tests that exercise complete middleware chains rather than invoking only terminal handlers: auth-client isolation under concurrent requests, caller-bound logout/revocation, refreshed-claim checks, anonymous/regular/admin access, CSRF rejection and success, queue/filter/detail/error paths, assignment/status mutations, missing rows, inactive-current behavior, and escaped view content.
12. Add migration contract tests plus live database acceptance for policy/grant behavior: ordinary owner-bound unassigned intake succeeds; forced assignment fails; regular SELECT/UPDATE/DELETE fails; admin workflow updates succeed; content/ownership column updates fail; new inactive assignment fails; unchanged inactive assignment with status change succeeds; no duplicate index exists.
13. Run focused and full Node test suites, `git diff --check`, an HTTP CSRF smoke test, and browser acceptance at desktop/mobile widths with keyboard navigation. Record live Supabase results separately and do not claim QA passed until those checks actually run.

## Affected files

- `database/migrations/015_add_admin_feedback_management.sql` — admin profiles, workflow/assignment changes, replacement intake policy, narrow grants/RLS, and OLD/NEW assignment enforcement without duplicating migration 014 indexes.
- `database/migrations/015_add_admin_feedback_management.test.js` — pin exact policy predicates, column privileges, trigger semantics, constraints, and index non-duplication.
- `database/README.md` — migration order, schema, RLS boundaries, and out-of-band claim/profile provisioning.
- `src/config/supabase.js` — add a fresh non-persisting auth client factory while retaining request-scoped RLS data clients.
- `src/config/supabase.test.js` — assert auth-client isolation and disabled persistence/auto-refresh configuration.
- `src/middleware/authMiddleware.js` — add admin middleware and use isolated clients for refresh without global auth state.
- `src/middleware/authMiddleware.test.js` — cover anonymous, non-admin, admin, expired/refreshed, rotated-token, and revoked/changed-claim paths through middleware.
- `src/utils/adminUtils.js` — pure trusted-role, workflow/filter, UUID, and assignee-choice helpers.
- `src/utils/adminUtils.test.js` — boundary coverage, including inactive-current preservation versus inactive-new rejection.
- `src/routes/adminAuthRoutes.js` — isolated admin sign-in/logout, cookie lifecycle, generic denial, and caller-bound revocation.
- `src/routes/adminAuthRoutes.test.js` — complete router-chain, concurrency/isolation, non-admin cleanup, refresh/logout, CSRF, and safe-error coverage.
- `src/routes/adminFeedbackRoutes.js` — protected queue/filter/detail/update flow using request-scoped clients.
- `src/routes/adminFeedbackRoutes.test.js` — complete middleware-chain coverage for reads, updates, inactive-current behavior, failures, 404s, and PRG.
- `src/routes/index.js` — mount admin routes without conflicting with current routes.
- `src/app.js` — effective CSRF token generation/enforcement and production admin-login rate limiting.
- `views/admin/login.ejs` — accessible admin credential form.
- `views/admin/feedback-index.ejs` — newest-first, filterable queue with status and assignee visibility.
- `views/admin/feedback-detail.ejs` — fully escaped ticket details and status/assignee controls, including inactive-current context.
- `views/partials/navbar.ejs` — optional verified-admin navigation entry; never a security boundary.
- `views/layouts/main.ejs` — shared CSRF/admin locals and accessible flash presentation as needed.
- `public/css/styles.css` — branded responsive admin surfaces, filters, table/card fallback, and status treatment.
- `src/views/adminFeedback.test.js` — semantic/accessibility/escaping/form/status/inactive-assignee contracts.
- Existing EJS files and route/view tests containing POST forms — add real CSRF fields/fixtures where global protection requires it.
- `docs/qa/rew-71-admin-feedback-management.md` — later QA agent record for actual live and browser results, not authored as passed during planning.

## Database changes

Migration 015 is required after merged migration 014. Create `admin_profiles` keyed to `auth.users(id)` with required display name and non-null active state. Add nullable `assignee_id` to `help_feedback_submissions` referencing the profile table with assignment cleared, rather than the ticket deleted, when appropriate. Replace the intake-only status check with `new`, `in_progress`, and `done`, keeping `new` as the default. Migration 014 already provides chronological and status/chronological indexes; do not duplicate them, and add an assignee index only if the planned query needs it.

RLS and privileges must be complementary. Admin policies use the immutable signed JWT app-metadata role for row access. Authenticated UPDATE privilege must be revoked at table scope and granted only for `status` and `assignee_id`; RLS still requires an admin and a real profile for non-null assignment. An OLD/NEW-aware `BEFORE UPDATE OF assignee_id` guard applies `active = TRUE` only when assignment changes, preventing new inactive assignments without blocking status-only saves that retain an inactive current assignee. Drop/recreate migration 014's named INSERT policy after adding `assignee_id`, requiring `auth.uid() = user_id`, `status = 'new'`, and `assignee_id IS NULL`. Ordinary users receive no submission SELECT/UPDATE/DELETE or admin-profile access.

## Security considerations

- Never use the process-global stateful Supabase client for admin login, refresh, or logout. Every request gets a fresh `persistSession: false`, `autoRefreshToken: false` client; logout first binds the caller's access/refresh session.
- Verify admin status from Supabase-validated user/JWT `app_metadata` on initial login and after refresh. Clear cookies and transient auth state after denial; do not let admin login become an alternate regular-user login.
- Keep data operations on access-token-scoped clients so Postgres RLS is enforced. Never introduce a service-role key into browser-facing routes.
- RLS limits rows, not columns. Explicitly narrow UPDATE privileges to the two workflow columns and prove direct attempts to alter `user_id`, contact data, content, creation time, or trigger-managed update time fail.
- Apply assignee activity rules only on changed assignment using OLD/NEW comparison. Preserve and clearly label an inactive current assignee so a status-only save neither fails nor silently unassigns it.
- Preserve the REW-70 intake boundary: caller-owned, `new`, and unassigned. Request body fields must never override owner, initial status, or assignment.
- Enable real CSRF validation for state-changing routes, retain secure/httpOnly/sameSite cookies and Post/Redirect/Get, and rate-limit admin credentials.
- Validate all identifiers, filters, status, assignment, and credentials server-side. Escape stored submission content in EJS and exclude contact/message values, token details, and Supabase internals from logs and user errors.
- Include direct database/live tests because mocked route tests cannot reveal privilege, RLS, trigger, concurrency, or token-revocation defects.

## Acceptance criteria

- [ ] The implementation starts from `main` commit `2ee900a` on `REW-71-admin-feedback-management`, and the merged REW-70 form, storage, dashboard card, and tests remain functional.
- [ ] A valid trusted admin can sign in at `/admin/login`; invalid credentials and valid regular-user credentials receive generic denial and retain no newly established admin-endpoint session.
- [ ] Concurrent admin auth requests use distinct non-persisting clients, refresh rechecks the trusted claim, and logout binds/revokes only the caller's access/refresh tokens.
- [ ] Anonymous and regular users cannot access admin queue/detail/update routes or read/update submissions/admin profiles directly; admin checks exist in both Express and RLS.
- [ ] Admins see every REW-70 submission newest first with name, email, category, subject, submitted time, status, and assignee, and can distinguish All, Unresolved, and Done states with text in addition to color.
- [ ] Ticket detail shows every required field using escaped output and includes active assignees plus any inactive current assignee clearly labeled; changing only status never silently clears or rejects that current assignment.
- [ ] Admins can move tickets among `new`, `in_progress`, and `done`, assign an active profile, or unassign. Invalid IDs/statuses and new inactive/nonexistent assignees fail without mutation.
- [ ] Database enforcement allows a status-only update retaining an existing inactive assignee but rejects changing assignment to an inactive profile, using OLD/NEW-aware semantics covered by contract and live tests.
- [ ] Authenticated database UPDATE is limited to `status` and `assignee_id`; direct attempts to mutate owner, contact, category, subject, message, `created_at`, or trigger-managed `updated_at` fail.
- [ ] Ordinary REW-70 intake still permits exactly caller-owned, `new`, unassigned inserts, and direct attempts to preassign or force another initial status fail.
- [ ] Migration 015 does not duplicate migration 014's `(status, created_at DESC)` index and adds no unjustified redundant index.
- [ ] Effective CSRF protection rejects tokenless/invalid admin login and workflow POSTs and accepts valid tokens; existing state-changing workflows, including REW-70 intake, remain operational.
- [ ] Route tests execute complete middleware chains and cover success, denial, CSRF, concurrency/isolation, refresh/logout, filtering, 404, database error, inactive-current, and invalid-update cases without leaking sensitive details.
- [ ] Focused tests and full `npm test` pass, `git diff --check` passes, and HTTP smoke results are recorded.
- [ ] Live Supabase QA proves all RLS/grant/trigger/intake invariants with admin, regular, active-profile, and inactive-profile fixtures; desktop/mobile keyboard/browser acceptance passes before documentation claims completion.

## As-built restart status

The current implementation was rebuilt from the clean merged REW-70 baseline. No code or QA result from the intentionally scrapped attempt is treated as shipped. The restart implements the plan, including the prior REW-72/REW-73 lessons:

- Fresh non-persisting Supabase clients are used for admin login, refresh, and caller-bound logout; data clients remain scoped to the verified request access token.
- Admin authorization relies only on verified `app_metadata.role = "admin"` in Express and RLS.
- Migration 015 creates `admin_profiles`, workflow status, nullable assignment, the assignee index, owner/new/unassigned intake, workflow-column-only UPDATE grants, and OLD/NEW-aware active-assignee enforcement without duplicating migration 014's queue index.
- The queue provides All, Unresolved, and Done filters. Detail/update preserves an inactive current assignee during status-only saves while rejecting new inactive/nonexistent selections.
- CSRF is enforced application-wide for unsafe non-multipart requests. Multipart routes validate after Multer parsing; the same-origin fetch wrapper supplies the token. User and admin logout are POST-only.

### Final validation

- Final reviewer: approved.
- Listener-capable full suite: 185/185 passed, zero skipped.
- HTTP/security, CSRF, authentication/logout, fetch, multipart, migration smoke, and contract checks: passed.
- Live Supabase/browser acceptance: blocked, not passed. The configured project lacks the required migrations/tables and safe admin/regular/active/inactive fixtures.

### Pending deployment and acceptance

Apply migrations 014 and 015, provision the trusted admin claim plus matching profile fixtures, and refresh authentication. Then exercise direct admin/regular RLS and grants, forced intake fields, immutable content columns, changed/unchanged inactive assignment behavior, status updates, CSRF, token refresh/logout, filters/detail, and desktop/mobile keyboard/browser behavior. Keep REW-71 In Progress until those checks pass.
