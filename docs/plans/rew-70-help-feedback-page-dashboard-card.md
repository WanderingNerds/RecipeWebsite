## Jira issue

[REW-70 — Create Help & Feedback Page and Dashboard Card](https://wanderingnerds.atlassian.net/browse/REW-70)

## Confluence page

[REW-70: Help & Feedback Page and Dashboard Card - Feature Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28049410/REW-70+Help+Feedback+Page+and+Dashboard+Card+-+Feature+Plan)

## Summary

Add an authenticated Help & Feedback workflow that users can reach from a fifth Dashboard Quick Action card. The new page will explain that administrators review submissions, collect a category, subject, message, contact name, and contact email, validate the request on the server, store a durable snapshot in Supabase, and show a success confirmation. The database design will provide the intake data and initial queue status needed by the dependent REW-71 admin-management work without exposing submissions to other regular users.

## Open questions / assumptions

- Follow-up (2026-09-13): the reported notice/form crowding is a CSS token defect, not a markup or content problem. `.help-feedback__notice` and `.help-feedback__form` use `padding: var(--space-5)`, and the notice uses `margin-bottom: var(--space-5)`, but `--space-5` is not defined in the shared spacing scale. Browsers therefore discard both declarations. Use an existing spacing token consistent with adjacent card/form surfaces; do not introduce a one-off token or alter the semantic notice markup.
- The Dashboard is authenticated and is the ticket's specified entry point, so both `GET /help-feedback` and `POST /help-feedback` are assumed to require authentication. No anonymous submission flow is planned.
- Name and email remain editable, required form fields even when initialized from the authenticated user's profile and account email. Stored values are submission-time contact snapshots because administrators need reliable follow-up details even if account metadata later changes.
- Use the fixed category allowlist **Question**, **Issue report**, **Feedback**, **Help request**, and **Other**. The Developer should keep the rendered options and server-side allowlist sourced from one definition; a different product-approved vocabulary can replace it without changing the storage model.
- Subject and message limits are assumed to be 200 and 5,000 characters respectively; name and email should also have explicit practical limits. Whitespace-only values are invalid and email must pass server-side format validation.
- A successful POST uses Post/Redirect/Get, flashes a generic confirmation, and redirects back to `/help-feedback`; refreshing the result must not create another submission.
- REW-70 owns the submission table and an initial `new` status so REW-71 has a stable intake queue. REW-71 remains responsible for admin identity/authorization, admin read/update policies, assignment fields or relationships, management routes, and status transitions beyond the intake default.
- The repository's global CSRF middleware is currently disabled. The form should include the existing `_csrf` field contract, but re-enabling and validating CSRF globally is outside this ticket; this gap must not be represented as resolved by REW-70.

## Tasks

1. Correct the Help & Feedback notice/form spacing declarations in `public/css/styles.css` to use a defined shared spacing token, restoring inner padding and separation between the notice and form without changing content, routes, or submission behavior.
2. Add or extend a focused CSS/view regression assertion so the page cannot silently reference an undefined spacing token again.
3. Verify the notice and form at representative desktop and mobile widths, including wrapped notice copy, and run the focused Help & Feedback tests plus the full test suite.

The original implementation tasks remain documented below for historical traceability:

1. Add migration `014_create_help_feedback_submissions_table.sql` for immutable submitter/contact and message fields, the authenticated submitter ID, initial status, and timestamps. Add useful indexes for future admin queue ordering/filtering, enable RLS, and permit authenticated users to insert only rows whose `user_id` equals `auth.uid()`. Do not grant ordinary users list, update, or delete access; document that REW-71 must add narrowly scoped admin access.
1. Add a dedicated Help & Feedback router mounted at `/help-feedback`. Protect GET and POST with `requireAuth`; render the form with authenticated name/email defaults; normalize and validate every body field against the category allowlist, required-field rules, size limits, and email format; insert through the request-scoped authenticated Supabase client; and use a generic user-facing failure message while logging safe operational detail server-side.
1. Create the Help & Feedback EJS page using semantic labels, required indicators, input types, constraints, explanatory admin-review copy, an `_csrf` hidden field, and accessible error/confirmation presentation consistent with existing flash behavior. On validation failure, preserve safe submitted values so users can correct the form without retyping it.
1. Add a fifth, fully clickable Help & Feedback card to the Dashboard Quick Actions grid, using the established card markup and a decorative icon, linking to `/help-feedback`. Extend only the minimal modifier/page styles needed to match existing Potluck branding and responsive/focus behavior.
1. Add focused tests for validation and route behavior: authentication remains enforced, GET defaults contact fields from the user, invalid input never inserts, valid input writes the expected user-owned record and redirects with confirmation, and database failures do not leak details. Update the dashboard rendered-view regression to expect the fifth exact card destination and verify the new form's required/accessibility/admin-review contract.
1. Run the full Node test suite. Manually verify the authenticated form and Dashboard card at desktop and mobile widths, keyboard navigation/focus, validation recovery, one successful stored submission, refresh safety, and absence of cross-user read access. Provide the resulting record to REW-71 acceptance work as an integration fixture where practical.

## Affected files

- `public/css/styles.css` — replace the undefined Help & Feedback spacing token with a defined shared token for card padding and notice-to-form separation.
- `src/views/helpFeedback.test.js` — extend the focused regression contract to catch undefined page-specific spacing references if feasible within the existing view-test style.
- `database/migrations/014_create_help_feedback_submissions_table.sql` — create the durable intake table, indexes, initial status, RLS, and owner-bound insert policy.
- `src/routes/helpFeedbackRoutes.js` — new authenticated page and submission handlers plus normalization/validation orchestration.
- `src/routes/index.js` — mount the Help & Feedback router at the fixed internal path.
- `src/utils/helpFeedbackUtils.js` — recommended shared category allowlist and pure normalization/validation helpers, avoiding drift between request handling and tests.
- `src/utils/helpFeedbackUtils.test.js` — unit coverage for allowlist, whitespace, length, and email validation boundaries.
- `src/routes/helpFeedbackRoutes.test.js` — route-level coverage for render defaults, insert payload, validation failures, confirmation redirect, and safe database-error behavior.
- `views/help-feedback.ejs` — new semantic submission form and admin-review notice.
- `views/dashboard.ejs` — add the fifth full-card link to Help & Feedback.
- `src/views/dashboard.test.js` — update the exact Quick Actions contract for the new card.
- `src/views/helpFeedback.test.js` — recommended rendered-template contract for labels, required controls, CSRF placeholder, and admin-review copy.

## Database changes

No database change is needed for this visual follow-up.

A new migration is required. Create `help_feedback_submissions` with a generated UUID primary key; non-null `user_id` referencing `auth.users(id)`; non-null submitter name and email snapshots; non-null category, subject, and message values with database-level nonblank/length constraints; a non-null initial status defaulting to `new`; and created/updated timestamps. Add indexes that support chronological admin intake and later status filtering. Enable RLS and add only an authenticated owner-bound INSERT policy for REW-70. Regular users should not receive SELECT, UPDATE, or DELETE policies because the ticket only promises submission, not a personal submission history. REW-71 must add admin-only read/update authorization and assignment modeling rather than weakening the user policy. No change to the placeholder `database/schema.sql` is assumed unless the Developer confirms that file has become the canonical full-schema snapshot.

## Security considerations

- Require authentication for both rendering and submitting; derive `user_id` exclusively from the verified auth context/access token, never from request-body data.
- Use a request-scoped authenticated Supabase client so the insert is enforced by RLS. Never use an elevated/service-role client for user submission.
- Enforce the category allowlist and trim, require, type-check, and length-limit every field server-side. HTML attributes improve UX but are not a security boundary.
- EJS escapes normal `<%=` output; preserve that behavior for redisplayed values and never render a submitted message as raw HTML. The eventual admin UI must do the same.
- Treat email as contact data, not proof of ownership. Store only the fields needed for follow-up, do not log message bodies or contact details, and show generic database errors to users.
- Keep the insert response generic and do not expose record identifiers or any submission lookup endpoint. RLS must prevent ordinary authenticated users from reading or modifying other users' submissions.
- Include the existing `_csrf` hidden field, while explicitly tracking that global CSRF enforcement is disabled in `src/app.js`. Production abuse controls should also retain the global rate limiter; a stricter POST-specific limiter can be added if product expectations warrant it.
- Preserve semantic labels, error association, keyboard focus visibility, and a status/alert announcement for confirmation so the flow is usable without pointer or visual-only cues.

## As implemented and validated (2026-09-13)

The planned router, shared validation helper, form, fifth Dashboard card, migration 014, and focused tests were implemented. The migration intentionally uses the default `NO ACTION` user foreign key and grants ordinary authenticated users only owner-bound inserts with initial `new` status. REW-71 still owns administrator access.

Review is **Approved with follow-ups; blocker closed**. The formatting follow-up now uses the defined `--space-6` token for notice/form padding and the notice-to-form gap at every width. The final notice paragraph margin is reset so wrapped copy keeps a consistent inset, and the focused view regression covers all three declarations. Focused route/utils/view tests pass 13/13; the full suite passes 166/166; `git diff --check` passes. Browser-level desktop/mobile verification of wrapped notice copy remains pending and is not claimed. Live PostgreSQL/Supabase migration, RLS, account-delete behavior, and real storage/refresh checks also remain pending.

## Acceptance criteria

- [ ] The **What happens next?** heading and explanatory copy have consistent visible inset spacing from every notice border at desktop and mobile widths.
- [ ] The notice has a clear vertical gap before the first **Category** field; neither the notice border nor its content touches or overlaps the label/form card.
- [ ] Wrapped explanatory copy remains inside the notice without clipping or horizontal overflow.
- [x] The Help & Feedback styles used for this spacing use the defined `--space-6` custom property, and a focused regression check covers the corrected padding, gap, and final-paragraph margin declarations.
- [x] Existing form behavior, content, accessibility relationships, and submission handling are unchanged; focused route/utils/view tests pass 13/13 and the full test suite passes 166/166.
- [ ] An authenticated Dashboard displays a fifth full-card Quick Action titled **Help & Feedback**, and activating it navigates to `/help-feedback`.
- [ ] Unauthenticated requests to both `GET /help-feedback` and `POST /help-feedback` are rejected by the existing authentication middleware and do not render or insert a submission.
- [ ] The Help & Feedback page follows existing Potluck styling and contains required, labeled controls for category/type, subject/title, description/message, submitter name, and email address.
- [ ] The page clearly states that submissions are reviewed by an administrator and are not automatically acted upon.
- [ ] Authenticated account name/email are used as safe initial values when available, while the required contact fields remain editable.
- [ ] The server accepts only the documented category allowlist and rejects missing, whitespace-only, malformed-email, wrong-type, and over-limit values without writing to the database.
- [ ] A valid form submission stores exactly one row owned by the authenticated user's ID, including the submitted contact snapshot, category, subject, message, `new` status, and submission timestamp.
- [ ] After a successful insert, the user is redirected to the Help & Feedback page and receives an accessible confirmation; refreshing the destination does not resubmit the form.
- [ ] On validation failure, the page identifies the problem and preserves safe submitted values; on a database failure, the user sees a generic retry message and no internal/Supabase detail.
- [ ] RLS permits an authenticated user to insert only their own submission and gives regular users no broad SELECT, UPDATE, or DELETE access; future admin access remains delegated to REW-71.
- [ ] The Dashboard card and form work without clipping or horizontal overflow at representative desktop and mobile widths, and all controls/cards have logical keyboard order and visible focus.
- [ ] Automated tests cover the category and validation boundaries, authenticated route behavior, exact insert payload, success/failure flows, Dashboard link, and form structure, and the complete `npm test` suite passes.
