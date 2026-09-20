# Jira Comment for REW-105

*To post to the REW-105 Jira issue:*

---

## Implemented and Documented — Not Pushed, No PR, QA Not Run

`POST /cookbooks/:id/delete` and `POST /meal-plans/:id/delete` now run
`requireAuth -> csrfProtection -> <limiter> -> handler`, closing the multipart CSRF bypass on the two
remaining destructive routes flagged by the REW-101 audit. Caveats before anyone reads this as finished:

- **The change is committed on the local branch `REW-105-cookbook-meal-plan-delete-csrf-protection` only.
  It has not been pushed, and there is no pull request.** Nothing is merged; `main` still carries both
  unprotected routes.
- **The QA stage has not run.** No browser or curl verification was performed — the manual pass in the
  plan is still pending a human.
- **Ticket hygiene:** REW-101 is merged to `main` (PR #62, `f8673b1`) but its Jira status still reads
  *In Progress* — it should be transitioned to Done.

**What shipped (code):**

- `src/routes/cookbookRoutes.js` and `src/routes/mealPlanRoutes.js`, identically (+13 / −2 each): a named
  import of `csrfProtection` from `../middleware/csrfMiddleware.js` (neither file imported it before);
  `csrfProtection` inserted between `requireAuth` and the existing limiter; the route comment expanded
  with the why, the ordering rule, the urlencoded form note, and "do not add a Multer stage here".
  Handler bodies, `UUID_PATTERN` guards, ownership filters, flash copy and redirects unchanged.
- `csrfProtection` is placed **ahead of** the limiter (unlike REW-101, where the recipe route has no
  limiter at all). Both limiters key on `req.user.id`, so a burst of forged requests would otherwise lock
  the victim out of every cookbook / meal-plan mutation for a minute. A test pins the ordering.
- No rate limiter added or reconfigured, no Multer stage, no change to `src/middleware/csrfMiddleware.js`,
  `src/app.js`, either `/:id/visibility` route, `package.json`, `database/`, or any view or form.
- Rejection is the same 403 error page every other CSRF failure produces. No information leak — neither
  cookbook nor meal-plan existence is revealed.

**What shipped (tests):** `src/routes/cookbookDeleteRoutes.test.js` and
`src/routes/mealPlanDeleteRoutes.test.js` (new, 8 cases each, 16 pass, 0 skipped): chain shape (exactly 4
handles, `csrfProtection` at index 1, the limiter at index 2 — asserted unconditionally); forged multipart
with no token -> 403 with and without the victim's cookie; a control proving the same request reaches the
handler on the pre-fix limiter-only chain, so the rejection assertions are not vacuous; urlencoded missing
token -> 403; urlencoded tampered / cross-session token -> 403; valid token reaches the handler exactly
once with the right `params.id`; multipart carrying a valid `_csrf` part still -> 403; and a quota test
proving three rejected forged requests consume no limiter budget. Both listen on `127.0.0.1:0`, never a
`/tmp` socket (REW-90 / REW-98).

**Testing:** `npm test` on Windows — 549 tests, 547 pass, 2 fail; the 2 are the pre-existing
`EACCES /tmp/*.sock` cases in `src/csrf.integration.test.js` (REW-90 / REW-98), untouched by this diff.
Needs a fully green Linux run before merge. Regression sweep green, including
`cookbookVisibilityRoutes.test.js` / `mealPlanVisibilityRoutes.test.js` (visibility stack length still
exactly 3, proving the change did not leak sideways).

**Scope note:** `POST /meal-plans/:id/recipes/:recipeId/remove` was marked "REW-105 or REW-99" in the
REW-101 audit. It is not named in REW-105's description or acceptance criteria, so it was **not** folded
in; the audit table now assigns it to REW-99. It is the same one-line pattern if you want it here, but the
AC should be amended first.

**Documentation updated:** `docs/api/README.md` (both endpoint rows, the CSRF Protection paragraph, audit
list (b), both audit-table rows -> "Fixed in REW-105", the meal-plan `remove` row -> REW-99, the
Follow-ups paragraph — and the stale "REW-101 is branch-only" sentence corrected, since PR #62 merged);
`docs/api/cookbooks.md` and `docs/api/meal-plans.md` (Middleware line on each delete section, Security
CSRF bullet, dated changelog row); `README.md` (security bullet); `docs/RELEASE_NOTES_REW-105.md`.
**Still outstanding:** the Confluence plan page needs its as-shipped update and the Bug Fixes index row
needs updating.

**Deployment:** no migration, no new environment variable, no new dependency, no `vercel.json` change.
Standard deploy once merged.

---
