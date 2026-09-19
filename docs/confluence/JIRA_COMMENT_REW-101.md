# Jira Comment for REW-101

*Posted to the REW-101 Jira issue after documentation review:*

---

## Documentation Complete — Reviewer-Approved, Not Pushed, No PR, QA Skipped

`POST /recipes/:id/delete` now runs `requireAuth -> csrfProtection -> handler`
(`src/routes/recipeRoutes.js`), closing the multipart CSRF bypass on the one destructive route that had
no route-level check. The change is code-reviewed (approved on round 1, no blocking findings — see the
review comment above) and is now documented in the repo and on Confluence. Three caveats before anyone
reads this as finished:

- **The change is committed on the local branch `REW-101-recipe-delete-csrf-protection` only. It has NOT
  been pushed, and there is no pull request.** Nothing is merged; `main` still carries the unprotected
  route.
- **The QA stage was skipped in this automated run.** No browser or curl verification was performed.
  Manual verification of the five delete surfaces — the recipe detail page, My Recipes, My Favorites, the
  Cookbook card and the Meal Plan card — is still pending a human: confirm dialog, "Recipe deleted
  successfully!" flash, redirect to `/recipes` on each; plus the curl checks in the plan (authenticated
  multipart POST with no token -> 403 error page and the recipe survives; urlencoded with no token or a
  garbage token -> 403; urlencoded with the real token -> deleted).
- Leaving this issue **In Progress** deliberately. REW-102 and REW-105 were not transitioned either.

**What shipped:**
- `src/routes/recipeRoutes.js`: `csrfProtection` (the exact `csrfMiddleware.js` export, already imported)
  inserted between `requireAuth` and the delete handler; the route comment expanded with the why, the
  REW-101 / REW-102 references, the five urlencoded delete forms, and the ordering rule (any future
  limiter goes after CSRF; no Multer stage on this route). Handler body, ownership filter, flash copy and
  redirects unchanged (+14 / -2).
- `src/routes/recipeDeleteRoutes.test.js` (new, 7 cases, 7 pass, 0 skipped): chain shape; forged
  multipart with no token -> 403, with and without the victim's cookie; a harness control proving the
  same request reaches the handler when the route-level check is removed; urlencoded missing token ->
  403; urlencoded tampered / cross-session token -> 403; a valid token reaches the handler exactly once;
  multipart carrying a valid `_csrf` part still -> 403. Listens on `127.0.0.1:0`, never a `/tmp` socket
  (REW-90 / REW-98).
- No rate limiter added, no Multer stage added, no change to `src/middleware/*`, `src/app.js`,
  `package.json`, `database/`, or any view or form.
- Rejection is the same 403 error page every other CSRF failure produces. No information leak.

**Testing:** `npm test` on Windows — 533 tests, 531 pass, 2 fail; the 2 are the pre-existing
`EACCES /tmp/*.sock` cases in `src/csrf.integration.test.js` (REW-90 / REW-98), untouched by this diff.
Still needs a fully green run on a Linux runner before merge. **No QA verification was performed this
run.**

**Audit outcome and follow-ups:** the route-level audit (comment above) found two equal-severity
destructive routes with the same gap — `POST /cookbooks/:id/delete` and `POST /meal-plans/:id/delete` —
tracked as REW-105 (Bug, High), which should not wait for REW-99. REW-102 (same defect, broader
acceptance criteria — all covered on this branch) is linked as a duplicate of this ticket; close it when
this merges. REW-99 (the global wrapper fix) remains separate and owns the clone-route limiter-before-CSRF
ordering nit and everything the audit marked "incidental".

**Documentation updated:**
- `docs/api/README.md` — the delete row plus a status paragraph under the Recipes table; the CSRF
  Protection route list, which now states the `/:id/clone` limiter-first exception correctly instead of
  claiming CSRF runs first "in each case"; the new "Route-level CSRF audit (REW-101)" subsection.
- `README.md` — the CSRF security bullet, same correction.
- `docs/api/cookbook-card.md`, `docs/api/meal-plan-card.md` — the "pre-existing gap" bullets moved to
  past tense; the follow-up lists mark REW-102 as addressed by REW-101. (That is all three of the
  reviewer's non-blocking doc findings fixed. The `findDeleteLayer()` test-helper nit is code and was
  left as is.)
- `docs/RELEASE_NOTES_REW-88.md`, `docs/RELEASE_NOTES_REW-89.md` — a dated annotation on their REW-102
  follow-up bullets; left as point-in-time records.
- `database/README.md` — a "REW-101 requires no migration" note. There are no database changes.
- `docs/RELEASE_NOTES_REW-101.md` — full release notes, including the pending manual checks.
- Confluence: [Release: REW-101 - Route-Level CSRF Protection on Recipe Delete](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/33619969)
  (new, under Releases) and the [REW-101 Bug Fix Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/33456129)
  updated from planned to as-shipped, including the audit table and the REW-102 / REW-105 / REW-99
  cross-references; the [Bug Fixes index](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/24477697)
  row updated.

**Deployment:** no migration, no new environment variable, no new dependency, no `vercel.json` change.
Standard deploy once merged.

---
