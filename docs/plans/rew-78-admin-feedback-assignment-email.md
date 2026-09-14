## Jira issue

[REW-78 — Admin Feedback: Fix Assignee Options and Send Assignment Email](https://wanderingnerds.atlassian.net/browse/REW-78)

## Confluence page

[REW-78: Admin Feedback Assignee Options and Assignment Email - Feature Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/28573754/REW-78+Admin+Feedback+Assignee+Options+and+Assignment+Email+-+Feature+Plan)

## Summary

Tighten the existing REW-71 admin feedback workflow so the assignment control on `/admin/feedback/:id` contains exactly Andrew, Victoria, and Unassigned, rejects any other submitted profile server-side, and sends a transactional email to the newly selected person whenever a ticket moves from unassigned or another assignee to them. Unassignment and status-only saves do not send mail. The message identifies the feedback ticket and contains a direct, server-configured link to its admin detail page.

## As-shipped status

Implemented on `REW-78-admin-feedback-assignment-email` using the Resend HTTPS API through built-in `fetch`; no SDK dependency was added. Migration 016 is the implemented idempotent provisioning follow-up: it creates or repairs Andrew and Victoria's active `admin_profiles` rows from exact case-insensitive Auth email matches, but only after those Auth users already have the trusted `admin` role. It does not grant administrator access. The fixed roster accepts the explicit stored profile aliases `Andrew`/`Andrew Carroll` and `Victoria`/`Victoria Johnson`, while always rendering the short UI labels Andrew and Victoria. Active-profile validation, transition detection, persistence-before-delivery behavior, five-second timeout, canonical `APP_URL` link, and distinct delivery-failure warning match the plan. Runtime configuration is `RESEND_API_KEY`, `ASSIGNMENT_EMAIL_FROM`, and `APP_URL`.

Final review is approved. The full Node suite passes 205/205 and `git diff --check` passes. Live migration, Resend, and browser acceptance remains pending because verified provider credentials and safe database/browser fixtures were unavailable.

## Open questions / assumptions

- The user-supplied requirements are treated as authoritative because Jira could not be fetched in this session. The supplied destinations are Andrew (`carroll.andrew@gmail.com`) and Victoria (`vhobbs1895@gmail.com`).
- Existing `admin_profiles` rows remain the source of assignee UUIDs. The shipped implementation recognizes only the explicit exact aliases `Andrew` or `Andrew Carroll`, and `Victoria` or `Victoria Johnson`, exposes no other active profiles, and maps them to the specified notification addresses in server-only configuration. The UI always renders Andrew and Victoria. No profile-name normalization is required for these four supported stored values, and substring or fuzzy matching is intentionally rejected.
- REW-71 already stores a nullable profile UUID and enforces active-profile assignment, so no schema change is required. Migration 016 is nevertheless required as an idempotent data-provisioning follow-up: it selects only the two exact Auth emails whose trusted role is already `admin`, upserts canonical short display names, and sets those profiles active. It does not synchronize arbitrary users or confer authorization.
- There is no general transactional-email client in the repository. The implementation should add a small injectable mail service backed by an explicitly configured provider (recommended: Resend over its HTTPS API), with `RESEND_API_KEY` and `ASSIGNMENT_EMAIL_FROM` supplied through environment configuration. Recipient addresses remain server-side and must never come from the form.
- Assignment persistence is authoritative. If the database update succeeds but the external email call fails, keep the new assignment, show a non-sensitive warning that the notification could not be sent, and log only safe diagnostic metadata. Do not attempt a misleading rollback across the database/provider boundary.
- A repeated save with the same assignee is not a reassignment and sends no email. Assigning from Andrew to Victoria notifies Victoria only; assigning from Victoria to Andrew notifies Andrew only.

## Tasks

1. Add a server-only canonical assignee definition containing the two display names and notification addresses, plus helpers that filter active `admin_profiles`, resolve a selected profile to its allowed recipient, and reject all non-allowlisted or inactive selections. Keep `Unassigned` represented by the existing null assignment rather than as a profile.
2. Change the admin feedback detail loader to request active profiles, filter them to Andrew and Victoria, and render the select in deterministic order with exactly `Unassigned`, `Andrew`, and `Victoria`. Do not preserve arbitrary inactive/current profiles as selectable options under this ticket's stricter requirement; the read-only current-assignee display may still reveal legacy data accurately.
3. Harden the update route so any non-null assignee UUID is looked up as an active profile and must resolve to Andrew or Victoria before the update occurs. Never trust a posted name or recipient email, and retain existing UUID/status validation, admin middleware, CSRF protection, RLS-scoped client use, and Post/Redirect/Get behavior.
4. Extend the route's pre-update read to obtain the fields needed for notification (at minimum ticket ID/subject and current assignee). Detect a true assignment transition by comparing the stored and requested UUIDs. Only after a successful database update, resolve the newly assigned recipient and invoke the mail service; skip it for unassignment and unchanged assignments.
5. Add an injectable assignment-email service. Build a concise subject and escaped/plain-text-safe body that identify the ticket by subject and ID and contain `${getAppUrl()}/admin/feedback/${ticketId}`. Use `getAppUrl` rather than request host headers. Submit mail through the configured provider with a timeout and map provider/network/configuration failures to a controlled result without leaking keys or message content.
6. Define route feedback for successful save plus successful notification, successful save with no notification required, and successful save with notification failure. Ensure a mail failure never causes a second database mutation or reports that the assignment itself failed.
7. Add utility and service unit tests for the exact allowlist/order, recipient mapping, unknown/duplicate/missing profiles, safe URL construction, correct destination/content, provider rejection, timeout, and absent configuration. Inject the transport/fetch implementation so tests make no network calls.
8. Expand admin route tests through the relevant handler/middleware chain: detail options are constrained; Andrew and Victoria assignments succeed; other active profile IDs and inactive profiles fail before update; unassignment sends nothing; same-assignee/status-only saves send nothing; initial assignment and Andrew↔Victoria reassignment notify only the new assignee; email is invoked only after persistence; update and notification error paths produce the intended flashes/redirects.
9. Expand view contract tests to verify the three visible choices, selected state, labels/CSRF preservation, and absence of recipient addresses or arbitrary roster entries in rendered HTML.
10. Document the new provider environment variables and operational behavior in the repository/admin-feedback documentation, including the non-transactional delivery-failure behavior and deployment smoke-test procedure.
11. Validate with focused utility/service/route/view tests, the full `npm test` suite, and `git diff --check`. In a configured environment, manually verify assignment and reassignment emails for both people, direct links, unassignment/no-op suppression, admin-page behavior, and controlled handling of a provider failure.

## Affected files

- `src/utils/adminUtils.js` — replace/generalize the broad active-profile merge behavior with exact REW-78 allowlist/filter/recipient resolution helpers.
- `src/utils/adminUtils.test.js` — cover exact names, order, profile filtering, nullable selection, and rejection of unknown/inactive/ambiguous entries.
- `src/services/assignmentEmail.js` (new) — provider adapter, assignment message construction, safe application URL, timeout, and controlled delivery result.
- `src/services/assignmentEmail.test.js` (new) — verify destination, subject/body ticket identity, direct link, provider request, and failure/configuration cases without network access.
- `src/routes/adminFeedbackRoutes.js` — constrain GET assignee data, validate POST against the product allowlist, detect assignment transitions, and call the injected mail service after a successful update.
- `src/routes/adminFeedbackRoutes.test.js` — add route behavior and notification sequencing/suppression/error coverage.
- `views/admin/feedback-detail.ejs` — retain the existing accessible control while rendering only Unassigned, Andrew, and Victoria in the required order.
- `src/views/adminFeedback.test.js` — pin the form's option, escaping, selected-state, label, and CSRF contracts.
- `database/migrations/016_backfill_rew78_admin_profiles.sql` — idempotently provision or repair the two fixed assignment profiles from already-authorized Auth users without granting admin access.
- `package.json` and `package-lock.json` — add the selected transactional-email SDK only if the provider implementation does not use Node's built-in `fetch`.
- `README.md` — document required mail-provider environment variables and production setup.
- `docs/api/admin-feedback.md` — document the constrained assignment model, notification trigger/suppression rules, direct-link behavior, and delivery-failure semantics.
- `docs/qa/rew-78-admin-feedback-assignment-email.md` (later QA output) — record actual automated and live email acceptance results; do not pre-mark them passed.

## Database changes

Migration 016 is implemented after migration 015 as an idempotent provisioning backfill, not a schema or authorization migration. It finds the two exact case-insensitive Auth emails only when `raw_app_meta_data.role = 'admin'`, then upserts their `admin_profiles` rows with canonical short names and `active = TRUE`. `help_feedback_submissions.assignee_id` continues to reference `admin_profiles(id)`, allows null for Unassigned, and database enforcement continues to reject newly assigned inactive profiles. The migration has not been applied to remote Supabase in this workflow. The exact Andrew/Victoria product allowlist and destination mapping remain in server-side application configuration because the database has no notification-address field. If stakeholders require administrators to edit this roster later, that is separate schema/admin-UI work and should receive its own ticket.

## Security considerations

- Retain `requireAdmin`, global CSRF validation, UUID/status allowlists, request-scoped Supabase clients, and RLS; hiding options in EJS is not authorization.
- Resolve the submitted UUID against an active database profile and then the fixed server-side roster. Never accept recipient addresses, names, links, or provider parameters from the request body.
- Build direct links only from `getAppUrl(process.env)`, never `Host` or forwarded headers, to prevent poisoned links.
- Keep provider credentials in environment variables. Do not expose them to EJS, source control, flash messages, or logs.
- Treat ticket subject/contact/message as untrusted content. Prefer a plain-text message or correctly escaped provider templates, and avoid logging personal feedback content or recipient addresses on failure.
- Bound the outbound request with a timeout. A slow provider must not leave the route hanging indefinitely.
- Because database update and email delivery cannot be atomic, persist first and report notification failure separately. Repeating the same saved assignment must not resend, which limits accidental duplicate delivery after a retry.

## Acceptance criteria

- [ ] On the admin feedback detail page, the assignee select shows exactly three choices in this order: Unassigned, Andrew, Victoria.
- [ ] A forged UUID for any other active/inactive admin profile is rejected server-side and does not update the ticket or send email.
- [ ] Selecting Unassigned stores `assignee_id = null` and sends no assignment email.
- [ ] Assigning a ticket to Andrew sends one email to `carroll.andrew@gmail.com` after the assignment is successfully stored.
- [ ] Assigning a ticket to Victoria sends one email to `vhobbs1895@gmail.com` after the assignment is successfully stored.
- [ ] Reassigning Andrew→Victoria notifies only Victoria; reassigning Victoria→Andrew notifies only Andrew.
- [ ] Saving a status change with the same assignee, or resaving an otherwise unchanged assignment, sends no email.
- [ ] No email is attempted when validation, profile lookup, or database update fails.
- [ ] Each assignment email identifies the feedback ticket by subject and/or UUID and includes a clickable canonical link to `/admin/feedback/:id` on the configured application origin.
- [ ] Recipient addresses and provider credentials cannot be supplied by the browser and do not appear in the admin page markup or user-facing error details.
- [ ] If delivery fails after persistence, the assignment remains saved and the administrator sees a distinct non-sensitive notification warning.
- [ ] The workflow continues to operate only on the authenticated admin feedback management page with CSRF and RLS protections intact.
- [ ] Focused tests, the full Node suite, and `git diff --check` pass; live provider/browser checks are recorded separately and are not claimed unless run.
