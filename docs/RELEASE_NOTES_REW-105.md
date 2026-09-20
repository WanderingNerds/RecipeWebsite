# Release Notes: REW-105 - Route-Level CSRF Protection on Cookbook and Meal Plan Delete

**Date:** 2026-09-20
**Jira Issue:** [REW-105](https://wanderingnerds.atlassian.net/browse/REW-105) (Bug, High, labels `csrf` / `security`)
**Branch:** `REW-105-cookbook-meal-plan-delete-csrf-protection` (from `main` at `fb27455`)
**Pipeline:** Planner → Developer. **The QA stage has not run.** Not pushed, no pull request, not merged.
**Confluence:** [REW-105 Bug Fix Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/33554444/REW-105+Route-Level+CSRF+Protection+on+Cookbook+and+Meal+Plan+Delete+-+Bug+Fix+Plan)

---

## Summary

`src/app.js` mounts `csrfProtectionExceptMultipart` globally. That wrapper skips token validation for
any `multipart/form-data` body, because `csrf-csrf` reads the token from `req.body._csrf` and that field
does not exist until Multer has parsed the body.

`POST /cookbooks/:id/delete` and `POST /meal-plans/:id/delete` relied on that wrapper alone, and neither
handler reads any body field — only `req.params.id`, `req.user.id` and `req.accessToken`. A forged
cross-site `multipart/form-data` POST from an attacker's page therefore reached each handler with
`req.body` undefined (Express 5 leaves it undefined when no body parser matched) and ran the delete.

Ownership scoping (`.eq("user_id", req.user.id)` on top of the owner-only RLS DELETE policies) limits the
blast radius to the victim deleting their **own** cookbook or meal plan — no cross-account deletion — but
that is exactly the CSRF scenario, and a destructive one. Same defect class and severity as
[REW-101](https://wanderingnerds.atlassian.net/browse/REW-101), which fixed the recipe-delete twin; these
two were deliberately left out of that diff so a one-line security fix did not become a three-router change.

The fix applies the REW-101 pattern twice, with one difference: both routes already carry a per-user rate
limiter, so `csrfProtection` goes **ahead of** the limiter (the `/recipes/:id/visibility` precedent), so a
forged request is rejected before it consumes any of the victim's 30-per-minute quota.

---

## User-Facing Changes

- **None for legitimate use.** Both delete forms (`views/cookbooks/view.ejs`, `views/meal-plans/view.ejs`)
  already post `application/x-www-form-urlencoded` with a hidden `_csrf`, so deleting from either page
  should behave exactly as before: confirm dialog, the "… deleted. Its recipes were not affected." flash,
  redirect to the index. **Unverified in a browser — QA has not run.**
- A forged cross-site request to either route now gets the 403 error page instead of deleting the victim's
  cookbook or meal plan.

---

## Technical Changes

### `src/routes/cookbookRoutes.js` and `src/routes/mealPlanRoutes.js`

Identical change in each file (+13 / −2 per file):

1. A named import of `csrfProtection` from `../middleware/csrfMiddleware.js` — neither file imported
   anything from that module before.
2. The route registration gains one middleware:
   `router.post("/:id/delete", requireAuth, csrfProtection, <limiter>, handler)`.
3. The one-line route comment expanded to record why the route-level check exists (the global wrapper
   skips multipart bodies and the handler reads no body fields), the ordering rule (CSRF **before** the
   limiter so forged requests burn no quota), that the form posts urlencoded with `_csrf` so the fix is
   transparent to it, and "do not add a Multer / body-parsing stage here".

Handler bodies, `UUID_PATTERN` guards, ownership filters, flash copy and redirects are unchanged. Neither
limiter's configuration changed — only its position in these two chains moves one slot right.

### Rejection behaviour

`csrf-csrf` calls `next()` with an `http-errors` 403 carrying `code: "EBADCSRFTOKEN"`, and
`src/middleware/errorHandler.js` renders the error page with that status — identical to
`/recipes/:id/delete` and every other CSRF failure. No custom flash-and-redirect, and no information leak:
neither cookbook nor meal-plan existence is revealed.

### `src/routes/cookbookDeleteRoutes.test.js` and `src/routes/mealPlanDeleteRoutes.test.js` (new, 8 cases each, 16 pass, 0 skipped)

Modeled on `src/routes/recipeDeleteRoutes.test.js` (merged with REW-101), each file covers:

1. **Chain shape** (no HTTP) — the `/:id/delete` POST layer is POST-only and has exactly 4 handles:
   `requireAuth` at 0, the exact `csrfProtection` export at 1 (`handles.indexOf(csrfProtection) === 1`),
   an `express-rate-limit` instance at 2 (asserted **unconditionally**, unlike the recipe test where no
   limiter exists), and the terminal handler at 3.
2. Forged multipart POST with no token → 403, handler not reached — both with the victim's `csrf-token`
   cookie attached and with no cookie at all.
3. **Control** — the same forged multipart POST against the *pre-fix* chain (the real router slice with
   `csrfProtection` filtered out, limiter still mounted) → 204, handler reached once. Without this the
   rejection assertions could pass vacuously, and it documents that the limiter is not a CSRF control.
4. Urlencoded POST with no `_csrf` → 403, handler not reached.
5. Urlencoded POST with an invalid `_csrf` — a tampered token, and a token issued for a second session
   sent with the first session's cookie → 403 both, handler not reached.
6. Urlencoded POST with a valid `_csrf` + matching cookie → 204, handler reached exactly once with the
   expected `req.params.id`.
7. Multipart POST carrying a valid `_csrf` part → still 403 (no Multer stage on the route; pins that one
   cannot be added silently).
8. **Quota** — after one valid request and three rejected forged requests, the next valid request's
   `RateLimit-Remaining` is exactly one lower than the first's, proving the forged requests consumed
   nothing. Relative delta, not an absolute number, because the limiter store is a module-level singleton.

Both files listen on `127.0.0.1:0` (ephemeral TCP), never a `/tmp` unix socket, and skip rather than fail
where the sandbox forbids listeners — avoiding the REW-90 / REW-98 `EACCES` trap.

### Explicitly unchanged

`src/middleware/csrfMiddleware.js`, `src/app.js`, both handler bodies, both ownership filters, both
`/:id/visibility` routes, every view and form, `package.json`, `database/migrations/`. No Multer or
`.none()` stage; no new or reconfigured rate limiter.

---

## Database Changes

**None.** No migration, no table or column change, no RLS implication. The ownership scoping in both
handlers and the owner-only RLS DELETE policies on `cookbooks` and `meal_plans` (cascading to
`cookbook_recipes` / `meal_plan_recipes`) are untouched — CSRF protection is a request-authenticity check
that sits in front of authorization, not a replacement for it.

---

## API Changes

No route added, removed or renamed; no request or response shape changed for legitimate traffic. The only
behavioural difference is that a request without a valid CSRF token is now rejected with 403 before
reaching either handler.

---

## Testing

`npm test` on Windows — **549 tests, 547 pass, 2 fail.** The 2 failures are the pre-existing
`EACCES /tmp/*.sock` cases in `src/csrf.integration.test.js` (REW-90 / REW-98), untouched by this diff.
Still needs a fully green run on a Linux runner before merge.

Regression sweep, all green: `cookbookVisibilityRoutes.test.js` and `mealPlanVisibilityRoutes.test.js`
(visibility stack length still exactly 3, proving the change did not leak into the neighbouring route),
`cookbookRoutes.test.js`, `mealPlanRoutes.test.js`, `recipeDeleteRoutes.test.js`, `cookbookSharing.test.js`,
`mealPlanSharing.test.js`, `cookbookApiRoutes.test.js`. No `express-rate-limit` `ERR_ERL_*` validation
warning appeared (the limiters key on `req.user.id`, not IP).

**No QA verification was performed.** Still pending a human, per the plan's manual pass: deleting a
cookbook and a meal plan through the real forms (confirm dialog, flash, redirect, contained recipes
survive); curl checks with the browser's session cookies for multipart-without-token, urlencoded
without/with a garbage token (403 each, nothing deleted) and urlencoded with the real token (succeeds);
and confirming a legitimate delete still works immediately after rejected forged requests.

---

## Related Tickets

- [REW-101](https://wanderingnerds.atlassian.net/browse/REW-101) — the recipe-delete fix this copies.
  Merged to `main` in PR #62 (`f8673b1`) but **its Jira status still reads In Progress**; it should be
  transitioned to Done.
- [REW-99](https://wanderingnerds.atlassian.net/browse/REW-99) — the central fix to the global
  `csrfProtectionExceptMultipart` wrapper. Deliberately untouched here; REW-105 is the route-level
  mitigation that should not wait for it.
- [REW-90](https://wanderingnerds.atlassian.net/browse/REW-90) /
  [REW-98](https://wanderingnerds.atlassian.net/browse/REW-98) — the `/tmp/*.sock` `EACCES` failures in
  `src/csrf.integration.test.js`. The new tests deliberately do not repeat that harness choice.
- `POST /meal-plans/:id/recipes/:recipeId/remove` — the audit's remaining "Medium" row. **Not** in
  REW-105's description or acceptance criteria, so it was not folded in; the audit table now assigns it to
  REW-99. Same pattern if it is wanted, but the AC should be amended first.

---

## Documentation

- `docs/api/README.md` — the `/cookbooks/:id/delete` and `/meal-plans/:id/delete` endpoint rows; the CSRF
  Protection paragraph (both routes added, and the stale "REW-101 is branch-only … not pushed or merged"
  sentence corrected — PR #62 merged); audit list (b); audit table (c), where both rows become
  **Fixed in REW-105** and the meal-plan `remove` row becomes REW-99's; the Follow-ups paragraph.
- `docs/api/cookbooks.md` / `docs/api/meal-plans.md` — a **Middleware** line on each delete section, the
  Security CSRF bullet, and a dated changelog row.
- `README.md` — the security bullet's route-level list, with the same stale-REW-101 correction.
- `docs/plans/rew-105-cookbook-meal-plan-delete-csrf-protection.md` — the plan.
- Confluence: the REW-105 plan page still needs its as-shipped update, and the Bug Fixes index row still
  needs updating. **Not yet done.**

---

## Deployment

No migration, no new environment variable, no new dependency, no `vercel.json` change. Standard deploy
once merged.
