# Jira Comment for REW-54

**Status: NOT POSTED.** Atlassian Rovo MCP tools (`getAccessibleAtlassianResources`, `getJiraIssue`, comment/transition tools, Confluence read/write tools) were not available as callable tools in this documentation session — only `Read`, `Write`, `Edit`, `Grep`, and `Glob` were exposed (the same gap noted in the REW-52/REW-53 documentation sessions in this repo). This file is retained as drafted content only, in the tone/format of this repo's other `JIRA_COMMENT_*.md` files, for the next agent/human with working Atlassian access to post as a comment on REW-54 and use to transition the issue.

---

## Documentation Complete — Implemented, Reviewed, Documented

The Sign In page's "Need a new confirmation email? Resend it" link has been replaced with "Forgot Password?", opening a new centralized account-recovery page (`/auth/forgot-password`). This has been implemented, code-reviewed (approved, non-blocking follow-ups only — see below), and documented.

**What changed:**
- `src/utils/authUtils.js`: new `RECOVERY_OTP_TYPE = "recovery"` constant, kept separate from `ALLOWED_OTP_TYPES` so a recovery-type token can never be accepted by `/auth/callback`. New co-located test `authUtils.test.js`.
- `src/routes/authRoutes.js`: login's unconfirmed-email redirect now points to `/auth/forgot-password?email=...`; new `GET`/`POST /auth/forgot-password` (password-reset request + resend-confirmation launch point, enumeration-safe); `GET /auth/resend-confirmation` now redirects to `/auth/forgot-password` (its `POST` handler is unchanged); new `GET`/`POST /auth/reset-password` (verifies the recovery link, sets a short-lived `recovery-session` marker cookie, lets the user set a new password via a freshly-instantiated per-request Supabase client).
- `src/middleware/authMiddleware.js`: `requireAuth` now attaches `req.refreshToken` on every success path, fixing a bug where a stale/rotated refresh-token cookie could cause spurious "session expired" failures during password reset.
- `views/auth/login.ejs`: "Forgot Password?" link replaces the old resend link in the same position.
- `views/auth/forgot-password.ejs` (new), `views/auth/reset-password.ejs` (new), `views/auth/resend-confirmation.ejs` (removed, superseded).
- No database migrations — built entirely on Supabase Auth's existing `resetPasswordForEmail`/`verifyOtp`/`updateUser` APIs.

**Known non-blocking follow-ups (flagged by Reviewer, not fixed in this pass):**
1. The `recovery-session` marker cookie is presence-only (not a random single-use token tied to the specific OTP verification) and isn't cleared on login/register — a stale cookie on a shared browser could theoretically let a subsequent authenticated user's own password-change request skip the recovery-email check within the 1-hour window. Recommended follow-up: random, server-verified single-use token, cleared on login/register too.
2. No route-specific rate limiting on `/auth/forgot-password` or `/auth/resend-confirmation` (only the app-wide general limiter applies) — pre-existing gap, now doubled in surface.
3. CSRF protection remains globally disabled app-wide (pre-existing, `src/app.js`, unrelated to this ticket).

**Infrastructure action required (not code, must not be missed at deployment):** In the Supabase Dashboard, add `${APP_URL}/auth/reset-password` to the allow-listed Redirect URLs (Settings > Authentication > URL Configuration), alongside the existing `${APP_URL}/auth/callback` entry, for both development and production `APP_URL` values.

**Testing:**
`npm test`: 79/79 passing (78 pre-existing + 1 new, `authUtils.test.js`). This repo has no request-level/integration test harness for routes, so the plan's acceptance criteria (`docs/plans/rew-54-forgot-password-account-recovery.md`, AC1–AC10 plus additional checklist items) require manual/QA verification against a real or dev Supabase project. **This documentation session did not have a separate QA report to draw from** — if a QA pass has been completed, please attach/link its results here before transitioning this issue to Done; otherwise flagging that gap rather than asserting QA sign-off.

**Documentation updated:**
- `docs/api/email-confirmation.md` — retitled to cover REW-41 and REW-54; added a password-recovery flow diagram, full endpoint documentation for the four new/changed routes, a Known Limitations section, updated Supabase redirect-URL configuration guidance, and an expanded testing checklist.
- `docs/api/README.md` — Authentication endpoint table and detailed-docs list updated.
- `README.md` — feature bullet under Authentication and Supabase Setup redirect-URL guidance (already present on the branch; verified against current code).
- `docs/RELEASE_NOTES_REW-54.md` — full release notes.
- Confluence: recommended update to the existing "REW-41: Fix Broken Email Confirmation Link" page (update in place, don't fork), plus a new dedicated "Release: REW-54 - Forgot Password Account Recovery" page — **drafted, not yet posted; Confluence write access was unavailable this session.** Section and page content ready in `docs/confluence/REW-54-forgot-password-account-recovery.md` for the next agent/human with Atlassian access to post.
- No `database/README.md` or `design_handoff_recipe_form/README.md` changes needed (no schema changes; recipe form UX untouched).

**Deployment:**
No database migrations. No new environment variables (reuses existing `APP_URL`). One required manual step: add the new redirect URL in the Supabase Dashboard (see above) before this ships to an environment where the reset-password email flow will be used.

---
