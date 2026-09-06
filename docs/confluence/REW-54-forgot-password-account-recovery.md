# Confluence update for REW-54 — drafted content, not yet posted

**Tooling note (updated at documentation/release stage):** Atlassian Rovo MCP tools (`getAccessibleAtlassianResources`, `getJiraIssue`, `createConfluencePage`, `updateConfluencePage`, etc.) were still not available as callable tools in the documentation session that finalized this content post-implementation — only `Read`, `Write`, `Edit`, `Grep`, and `Glob` were exposed, the same gap noted in the original planning session and in the REW-52/REW-53 documentation sessions in this repo. The content below has been updated to reflect the **as-shipped** state (implementation is complete, code-reviewed, `npm test` 79/79 passing) rather than the original plan. This file is ready for the next agent/human with working Atlassian access to post, following the same pattern used for REW-52/REW-53 in this repo (see `docs/confluence/REW-52-required-prep-total-time.md`, `docs/confluence/REW-53-remove-duplicate-search-bar.md`).

**Recommended target page:** "REW-41: Fix Broken Email Confirmation Link" — this is the existing page documenting `/auth/callback`, `/auth/resend-confirmation`, `ALLOWED_OTP_TYPES`, and the login-redirect-on-unconfirmed-email behavior (see `docs/confluence/REW-41-email-confirmation-fix.md` for this repo's markdown mirror of that live page). REW-54 directly extends and partially supersedes that page's content, so it should be updated in place, not forked into a new page. Its live page ID/URL was not independently confirmed in this session (no Confluence read access); search for it by title before posting.

**Status:** Not posted. Requires an agent/human session with working Atlassian Rovo MCP access.

---

## Section to add: "REW-54: Forgot Password / Account Recovery"

Add this as a new `##`-level section on the target page, directly after the existing "Login Flow Integration" section:

---

### REW-54: Forgot Password / Account Recovery

**Status:** Complete — implemented, code-reviewed (approved, non-blocking follow-ups only, see below). `npm test`: 79/79 passing. See `docs/plans/rew-54-forgot-password-account-recovery.md` for the full plan and `docs/RELEASE_NOTES_REW-54.md` for full release notes.

**Jira:** [REW-54](https://wanderingnerds.atlassian.net/browse/REW-54)

QA found that the Sign In page's only account-recovery affordance was "Need a new confirmation email? Resend it" — there was no way for a user who forgot their password to reset it. This work replaces that link with "Forgot Password?", which opens a new centralized account-recovery page (`GET /auth/forgot-password`). That page collects one email address and offers two actions from a single form (via HTML `formaction`, no JavaScript required):

- **Send Password Reset Email** — new functionality, built on Supabase Auth's `resetPasswordForEmail()` API. Submits to `POST /auth/forgot-password`.
- **Resend Confirmation Email** — the pre-existing functionality documented above under "POST /auth/resend-confirmation," reused unchanged and simply re-entered from this page instead of its own dedicated page.

A new route pair, `GET`/`POST /auth/reset-password`, handles the incoming Supabase recovery-link click (`type=recovery` OTP verification, mirroring the existing `verifyOtp()` pattern used by `/auth/callback` for signup confirmation) and the subsequent "set a new password" form submission. After a successful password update, the recovery-granted session is cleared and the user is redirected to `/auth/login` to sign in with the new password.

**What changed vs. the REW-41 flow documented above:**
- `GET /auth/resend-confirmation` no longer renders its own page — it now redirects to `/auth/forgot-password` (preserving `?email=`) for backward compatibility. `POST /auth/resend-confirmation` is unchanged.
- The unconfirmed-email login redirect (`Login Flow Integration`, above) now points to `/auth/forgot-password?email=...` instead of `/auth/resend-confirmation?email=...`.
- `views/auth/resend-confirmation.ejs` was removed; its markup is superseded by the new `views/auth/forgot-password.ejs`.

**New/changed files:**

| File | Change Type | Description |
|------|-------------|-------------|
| `src/routes/authRoutes.js` | Modified | New `/auth/forgot-password` and `/auth/reset-password` routes; login redirect target updated; `/auth/resend-confirmation` GET becomes a redirect |
| `src/utils/authUtils.js` | Modified | New `RECOVERY_OTP_TYPE` constant (kept separate from `ALLOWED_OTP_TYPES`) |
| `views/auth/login.ejs` | Modified | "Resend it" link replaced with "Forgot Password?" |
| `views/auth/forgot-password.ejs` | New | Centralized recovery page — email field + reset/resend actions |
| `views/auth/reset-password.ejs` | New | "Set a new password" form shown after a valid recovery link |
| `views/auth/resend-confirmation.ejs` | Removed | Superseded by `forgot-password.ejs` |

**New Supabase Dashboard configuration required:** add `{APP_URL}/auth/reset-password` to **Settings > Authentication > URL Configuration > Redirect URLs**, alongside the existing `{APP_URL}/auth/callback` entry documented above — without this, `resetPasswordForEmail`'s `redirectTo` will be rejected/fall back incorrectly. This is an infrastructure step, not a code change, and must be done in each environment (dev and production) before the reset-password flow works there.

**Security notes:** Reset-password requests use the same email-enumeration-safe generic response as resend-confirmation. Recovery-type OTPs are validated by a route-specific check, not folded into `ALLOWED_OTP_TYPES`, so a recovery link can never log a user directly into `/dashboard` via `/auth/callback` — it always lands on the "set a new password" form first. `POST /auth/reset-password` additionally requires a short-lived, httpOnly `recovery-session` marker cookie (set only by a successful `GET /auth/reset-password` verification), so an already-logged-in user can't reach the password-update endpoint without having gone through the recovery-email link first.

**Non-blocking follow-ups identified in review (tracked as future work, not fixed in this ticket):**
1. The `recovery-session` marker cookie is presence-only rather than a random, single-use, server-verified token tied to the specific OTP verification, and it isn't cleared on login/register — recommend hardening this in a follow-up.
2. Neither `/auth/forgot-password` nor `/auth/resend-confirmation` has route-specific rate limiting (only the app-wide general limiter applies) — recommend a follow-up ticket.
3. CSRF protection remains globally disabled app-wide (pre-existing, unrelated to this ticket) — the new forms include `_csrf` fields for when it's re-enabled.

Also fixed as part of this ticket: `src/middleware/authMiddleware.js`'s `requireAuth` now attaches `req.refreshToken` on every success path (previously only on the token-refresh branch), preventing spurious "session expired" failures during password reset caused by a stale/rotated refresh-token cookie.

---

*Once posted, also update this page's "Related Pages" and "Last Updated" date/author at the bottom.*

---

## Recommended new page: "Release: REW-54 - Forgot Password Account Recovery"

In addition to updating the page above, create a dedicated release-notes page (matching the pattern used for REW-51/REW-53) with the following content:

---

# Release: REW-54 - Forgot Password Account Recovery

**Jira:** [REW-54](https://wanderingnerds.atlassian.net/browse/REW-54)
**Branch:** `REW-54-forgot-password-account-recovery`
**Status:** Implemented, code-reviewed (approved, non-blocking follow-ups only). `npm test`: 79/79 passing.

## What shipped
Replaced the Sign In page's "Need a new confirmation email? Resend it" link with "Forgot Password?", opening a new centralized account-recovery page (`/auth/forgot-password`) offering both a password-reset request (new, via Supabase's `resetPasswordForEmail`) and the existing resend-confirmation action from one email field. A new `GET`/`POST /auth/reset-password` route pair lets the user set a new password after clicking the emailed recovery link. No database changes.

## Why
QA found that a user who forgot their password had no self-service way to reset it — the only recovery affordance on Sign In was for resending a confirmation email. This centralizes both recovery paths behind a single, clearly-labeled entry point.

## Impact
- **User-facing:** new "Forgot Password?" self-service flow; old resend-confirmation functionality preserved, just reached from the new page. Old `/auth/resend-confirmation` links still resolve (via redirect).
- **Technical:** new auth routes and views; one middleware bug fix (`requireAuth` now consistently attaches `req.refreshToken`); no database changes.
- **Testing:** `npm test` 79/79 passing (78 pre-existing + 1 new unit test). No route-level integration test harness exists in this repo — acceptance criteria require manual/QA verification against a real or dev Supabase project.

## Deployment
**Required:** add `${APP_URL}/auth/reset-password` to Supabase's allow-listed Redirect URLs (Settings > Authentication > URL Configuration), alongside the existing `/auth/callback` entry, in both dev and production. No database migrations, no new environment variables.

## Links
- Full release notes: `docs/RELEASE_NOTES_REW-54.md`
- Plan: `docs/plans/rew-54-forgot-password-account-recovery.md`
- API documentation: `docs/api/email-confirmation.md`
