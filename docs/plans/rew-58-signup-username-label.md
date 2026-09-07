## Jira issue
REW-58 — "Sign up page shows 'Your Name' instead of 'Username'" (Bug, Medium priority). Related to REW-8 (User Authentication).

**Note:** No Atlassian Rovo MCP tools (`getAccessibleAtlassianResources`, `getJiraIssue`, `searchJiraIssuesUsingJql`, Confluence search/write, etc.) were available in this planning session — no Atlassian tool calls were attempted to succeed against, so I could not pull REW-58 live, confirm there are no additional comments/attachments, or check for an existing related Confluence page. This plan is built entirely from the ticket summary/description text supplied in the task prompt, plus direct inspection of the current repo (`views/auth/register.ejs`, `src/routes/authRoutes.js`, `src/utils/userUtils.js`). **Before implementation, the Developer or user should open REW-58 directly in Jira to confirm no additional comments contradict the assumptions below, and should create/update the Confluence page for this area (recommend the same Potluck design system / auth pages documentation referenced in `docs/plans/rew-54-forgot-password-account-recovery.md` and `docs/plans/rew-57-forgot-password-link-redirects-home.md`) once implemented.**

## Confluence page
Not created/updated — Atlassian tool access was unavailable this session (see note above). Flag to Developer/Reviewer: once implemented, add a one-line note to whatever Confluence page documents the auth/registration flow (or the Potluck Design System page used for other auth-related tickets like REW-54/REW-57), stating that the sign-up form's name field is labeled "Username" for UX purposes but is stored and used internally as the account's display name (`user_metadata.name`), with a link back to REW-58.

## Summary
The sign-up form at `views/auth/register.ejs` currently labels its first field "Your name" (line 10), but the ticket wants the visible label changed to "Username". This is a copy-only bug: the underlying field name attribute (`name="name"`), its server-side handling in `src/routes/authRoutes.js`, and its storage as `user_metadata.name` in Supabase Auth all remain unchanged, since the ticket's description and acceptance criteria only mention updating "the label text on the sign up page." Repo investigation confirms this `name` value is read elsewhere as the account's display name — via `getAccountDisplayName()` in `src/utils/userUtils.js`, used for the navbar's "Hello, {name}" greeting and as an autofill default for the recipe "author" field placeholder in `views/recipes/new.ejs` — so renaming the underlying concept (field name, database/metadata key, helper naming) would be a materially larger and riskier change than what this ticket asks for. This plan scopes the fix strictly to the visible `<label>` text (and its associated placeholder copy, for consistency), leaving the `name`/`id` attributes, form submission handling, and `user_metadata.name` storage untouched.

## Root cause
Simple copy mismatch: the label text "Your name" was written when the field was originally conceived as a display name, but product/UX now wants the sign-up UI to present this as a "Username" field to the user. No functional or data-model defect exists — this is purely a labeling/wording issue in the EJS template.

## Open questions / assumptions
- **No Jira/Confluence tool access this session** (see above) — proceeded from the ticket text given in the prompt, which is a complete, unambiguous bug description with a clear fix instruction. Flagging so the user can double-check the ticket's comments (if any) against this plan before handoff.
- **Scope assumption (label text only, not field semantics):** The ticket's "Fix" line says only "update the label text ... from 'Your Name' to 'Username'." It does not ask to rename the `name` input attribute, the `name` field in `req.body`, or `user_metadata.name`. I'm treating a full rename to a "username" concept (distinct from display name, with its own uniqueness/format rules) as out of scope and a separate, larger feature — if the user or Developer believes REW-58 actually intends that broader change, this should be split into a new ticket rather than folded into this bug fix, since it would touch registration validation, the Supabase user_metadata shape, `getAccountDisplayName()`, and every place that reads `user_metadata.name` (navbar greeting, recipe author autofill).
- **Placeholder text:** The input's current placeholder ("How should we call you?") reads naturally for a display-name field but slightly oddly for a "Username" label. Since the ticket only calls out the label, I'm proposing a minor placeholder tweak (e.g. "Pick a username") as a low-risk, in-scope copy consistency improvement bundled with the label change — Developer/Reviewer can drop this specific sub-change if they'd rather keep the diff to the single label line.
- **`for`/`id`/`name` attributes unchanged:** `for="name"`, `id="name"`, and `name="name"` all stay as-is. Renaming these has no user-visible effect (they're not shown to the user) but would be unnecessary attribute churn with zero benefit for a label-text-only bug, so it's excluded.

## Tasks
1. In `views/auth/register.ejs`, change the `<label for="name">` text on line 10 from "Your name" to "Username".
2. (Optional, bundled copy-consistency improvement — see assumption above) In the same file, update the input's `placeholder` attribute on line 11 from "How should we call you?" to wording consistent with a username prompt (e.g. "Pick a username"), if Developer/Reviewer agree it's in scope.
3. Confirm no other sign-up-adjacent copy references "Your name" in a way that would now read inconsistently with the new "Username" label (e.g. any client-side validation message strings in `views/auth/register.ejs` or shared auth JS, if present) — grep confirms `authRoutes.js` has no user-facing "Your name" string, only the `name` variable/key, so no other text is expected to need changes.
4. Manually render `/auth/register` and visually confirm the label now reads "Username", the form still submits successfully (creates an account via the existing `name`/`email`/`password`/`confirmPassword` flow in `src/routes/authRoutes.js`), and the navbar greeting and recipe-author autofill (both driven by `user_metadata.name`) still work unchanged after registering with the new label in place.
5. Run `npm test` as a smoke check — no existing test targets this label string, so this only confirms the change didn't break unrelated suites (e.g. `src/utils/userUtils.test.js`, which tests `getAccountDisplayName()` and is unaffected since the underlying metadata key is unchanged).

## Affected files
- `views/auth/register.ejs` — line 10: change label text "Your name" → "Username"; optionally line 11: adjust placeholder copy for consistency. No attribute (`for`/`id`/`name`), form action, or CSRF handling changes.
- `src/routes/authRoutes.js` — no changes; read only to confirm `req.body.name` handling and Supabase `user_metadata` write are unaffected by the label-only fix.
- `src/utils/userUtils.js` — no changes; read only to confirm `getAccountDisplayName()` (which reads `user_metadata.name`) is unaffected by the label-only fix.
- `views/recipes/new.ejs` — no changes; noted only because it independently uses an unrelated "Your name" placeholder string on its "author" field (line 40), which is a different feature (recipe attribution) and out of scope for this ticket. Flagging so Developer doesn't conflate the two while searching for "Your name" occurrences.
- `views/recipes/edit.ejs`, `views/recipes/import.ejs` — no changes; same "Your name" string appears here too (recipe author field), also out of scope, flagged for the same reason.

## Database changes
None. This is a template copy-only fix — no migration, schema, or RLS changes. The underlying `user_metadata.name` storage in Supabase Auth is unaffected.

## Security considerations
None expected. This change only edits static label/placeholder text in an EJS template — no changes to authentication logic, CSRF token handling (`_csrf` hidden field on line 7 is untouched), input validation/sanitization in `authRoutes.js`, rate limiting, or the registration form's `action`/`method`. Reviewer should confirm the diff touches only the label (and optionally placeholder) text and nothing else in `views/auth/register.ejs`.

## Acceptance criteria
- [ ] On `/auth/register`, the first form field's visible label reads "Username" (not "Your name" or "Your Name").
- [ ] The field's underlying `name`/`id` attributes remain `name`/`name` (unchanged), and the registration form still submits successfully end-to-end (new account created, redirected/logged in per existing `authRoutes.js` behavior).
- [ ] After registering with the new label, the navbar greeting ("Hello, {value}") still displays the value the user entered in that field, confirming `user_metadata.name` storage and `getAccountDisplayName()` are unaffected.
- [ ] No other page's copy or functionality (e.g. `views/recipes/new.ejs`, `edit.ejs`, `import.ejs` "author" field) is altered by this change.
- [ ] `npm test` passes with no new failures, including `src/utils/userUtils.test.js`.
