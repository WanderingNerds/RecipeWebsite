# Release Notes: REW-101 - Route-Level CSRF Protection on POST /recipes/:id/delete

**Date:** 2026-09-19
**Jira Issue:** [REW-101](https://wanderingnerds.atlassian.net/browse/REW-101) (Bug, High) — also addresses
[REW-102](https://wanderingnerds.atlassian.net/browse/REW-102) (Task, High), which is linked in Jira as a
duplicate of REW-101
**Branch:** `REW-101-recipe-delete-csrf-protection`
**Pipeline:** Planner → Developer → Reviewer (approved on round 1, no blocking findings). **The QA stage was
deliberately skipped on this run.** The change exists only on the local branch — not pushed, no pull request,
not merged. Jira status deliberately left at **In Progress**; REW-102 and REW-105 were not transitioned.
**Confluence:** [Release: REW-101 - Route-Level CSRF Protection on Recipe Delete](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/33619969)
· [Bug Fix Plan (as shipped)](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/33456129)

---

## Summary

`src/app.js` mounts `csrfProtectionExceptMultipart` globally. That wrapper deliberately skips token
validation for any `multipart/form-data` body, because `csrf-csrf` reads the token from `req.body._csrf`
and that field does not exist until Multer has parsed the body. The upload routes compensate by running
`csrfProtection` after Multer; `POST /recipes/:id/clone`, `POST /recipes/:id/visibility` and every
`/api/cookbooks*` mutation compensate by re-applying `csrfProtection` at the route level.

`POST /recipes/:id/delete` had neither. Its chain was `requireAuth` → handler, and the handler reads no
body fields — only `req.params.id`, `req.user.id` and `req.accessToken` — so a forged cross-site
`multipart/form-data` POST from an attacker's page reached the handler with `req.body` undefined and ran
the delete. Ownership scoping (`.eq("user_id", req.user.id)` on top of the owner-only RLS DELETE policy)
meant an attacker could only make the victim delete the victim's **own** recipe, which is precisely the
CSRF scenario, and a destructive one. The route is reachable from five UI surfaces: the recipe detail
page, My Recipes (REW-86), My Favorites (REW-87), the Cookbook page (REW-88) and the Meal Plan page
(REW-89).

The fix copies the `/:id/visibility` precedent exactly:
`router.post("/:id/delete", requireAuth, csrfProtection, handler)`.

---

## User-Facing Changes

- **None for legitimate use.** All five delete forms already post `application/x-www-form-urlencoded`
  with a hidden `_csrf`, so deleting a recipe from any surface should behave exactly as before: confirm
  dialog, "Recipe deleted successfully!" flash, redirect to `/recipes`. **This is unverified in a browser —
  QA was skipped.**
- A forged cross-site request to the delete route now gets the 403 error page instead of deleting the
  victim's recipe.
- A submission from a stale tab whose CSRF token has rotated gets the same 403 page every other form in
  the app produces in that case.

---

## Technical Changes

### `src/routes/recipeRoutes.js`

- `POST /recipes/:id/delete` is now mounted as `requireAuth` → `csrfProtection` → handler.
  `csrfProtection` is the exact `doubleCsrfProtection` export from `src/middleware/csrfMiddleware.js`,
  already imported by the router; no new import.
- The single-line route comment was expanded to explain why the check is re-applied at route level, to
  reference REW-101 / REW-102, to note that all five delete forms post urlencoded with a hidden `_csrf`,
  and to state the ordering rule: any future rate limiter must go **after** `csrfProtection` so a forged
  request cannot burn the victim's quota, and no Multer / body-parsing stage may be added to this route.
- The handler body, the `.eq("id", id).eq("user_id", req.user.id)` ownership filter, the flash copy and
  the redirects are byte-for-byte unchanged. The diff to this file is +14 / −2: the comment and the
  signature line.
- **No rate limiter was added.** The route had none; adding one is scope creep on a security fix, and the
  production-only general limiter in `app.js` still applies.
- **No Multer stage was added.** A multipart body is rejected even if it carries a `_csrf` part, because
  nothing on this route parses it; a test pins that so a `.none()` stage cannot be added silently later.

### Rejection behaviour

Unchanged from every other CSRF failure in the app: `csrf-csrf` raises an `http-errors` 403 with
`code: "EBADCSRFTOKEN"` and `src/middleware/errorHandler.js` renders the error page with that status. No
custom flash-and-redirect was added; a real user only reaches this from a stale tab. No recipe existence
is revealed.

### `src/routes/recipeDeleteRoutes.test.js` (new, 7 cases, 7 pass, 0 skipped)

1. **Chain shape (no HTTP).** The `/:id/delete` POST layer exists, is POST-only, has `requireAuth` at
   index 0 and the exact `csrfProtection` export at index 1, ahead of the terminal handler; if an
   `express-rate-limit` instance is ever present it must sit after CSRF.
2. **A forged multipart POST with no token is rejected (403) before the handler**, both with the victim's
   `csrf-token` cookie attached and with no cookie at all.
3. **Harness control:** with the route-level check removed, the same forged multipart request reaches the
   handler (204, handler called once). This proves the global wrapper alone lets it through, so the
   rejection cases are not passing vacuously.
4. A urlencoded POST with no `_csrf` → 403, handler not called.
5. A urlencoded POST with an invalid `_csrf` (a tampered token, and a token issued for a different
   session's cookie) → 403, handler not called.
6. A urlencoded POST with a valid `_csrf` and matching cookie → 204, handler called exactly once with the
   expected `req.params.id`.
7. A multipart POST carrying a valid `_csrf` part → still 403 (no Multer stage on this route).

The harness mirrors the `app.js` parser order (cookie-parser → json → urlencoded →
`csrfProtectionExceptMultipart`), mounts the route's **real** middleware slice taken from `router.stack`
(guarded so it can never mount an empty slice), listens on `127.0.0.1` port `0` — **not** a `/tmp` unix
socket (REW-90 / REW-98) — and skips rather than fails where the sandbox forbids listeners.

### Decisions and tradeoffs

| Decision | Rationale |
|----------|-----------|
| Route-level `csrfProtection`, not a fix to the global wrapper | The wrapper fix is REW-99 and touches every multipart route. This ticket is the deterministic mitigation for the one destructive route it names; a one-line security diff should not become a middleware refactor. |
| No rate limiter added | Both tickets say "order CSRF before any limiter" conditionally; this route has none. A visibility toggle is churnable; a delete is not. The test enforces the ordering whenever a limiter is present. |
| No Multer / `.none()` stage | All five forms are urlencoded. Parsing multipart here would widen the surface for nothing; a test pins its absence. |
| Handler not extracted | An injectable `handleRecipeDelete` would be nice for unit tests but is not needed to prove the CSRF property. The test reuses the real middleware slice from the router's stack instead. Optional follow-up. |
| Rejection shape unchanged | Diverging from `/:id/visibility` and `/:id/clone` with a custom flash-and-redirect would add code to a security fix for a case only a stale tab reaches. |
| Harness control case included | Without it, a harness that rejected multipart for an unrelated reason would make the rejection tests pass vacuously. |
| TCP port `0` on `127.0.0.1`, not a `/tmp` socket | The existing `csrf.integration.test.js` cannot run on Windows (REW-90 / REW-98). The new test must not repeat that. |
| Cookbook and meal-plan delete routes not folded in | Same defect, same severity, but a three-router change is a bigger review and a bigger revert. Filed as REW-105 and flagged prominently so it does not wait for REW-99. |

### Explicitly unchanged

`src/middleware/csrfMiddleware.js`, `src/app.js`, `src/middleware/errorHandler.js`, `package.json`,
every view and form (`views/recipes/view.ejs`, `views/partials/recipe-summary-card.ejs`), `database/`,
`vercel.json`, the delete handler body, and the `.eq("user_id", req.user.id)` ownership filter. Verified by
the reviewer's `git diff --stat`: five files touched (`README.md`, `docs/api/README.md`,
`docs/api/cookbook-card.md`, `docs/api/meal-plan-card.md`, `src/routes/recipeRoutes.js`) plus the new
test and the plan, before the documentation pass added the files listed under Documentation below.

---

## Route-Level CSRF Audit (REW-101 AC 4 / REW-102 AC 4)

Every `router.post` / `router.delete` in `src/routes/` was audited on `main` at `8f6eb30`: 43 mutating
routes, no `put`/`patch`, none outside the routers. Two facts drive the findings. Express 5 leaves
`req.body` **undefined** when no body parser matched, so a cross-site multipart form POST reaches a
handler with no body — if the handler never reads `req.body` before mutating, the mutation runs; if it
reads `req.body.x` first it throws a `TypeError` and nothing happens, which is incidental, not a control.
And `DELETE`-verb routes are not reachable by the HTML-form vector (forms only send GET/POST; a
cross-origin `fetch` DELETE is preflighted and refused by CORS).

| Class | Routes | Outcome |
|-------|--------|---------|
| (a) Multipart routes, `csrfProtection` correctly after Multer | `POST /recipes`, `POST /recipes/:id/update`, `POST /recipes/import/parse` | Correct. |
| (b) Non-multipart routes re-applying `csrfProtection` at route level | `POST /recipes/:id/clone`, `POST /recipes/:id/visibility`, `POST /api/cookbooks`, `POST /api/cookbooks/:id/recipes/:recipeId`, `DELETE /api/cookbooks/:id/recipes/:recipeId`, and now `POST /recipes/:id/delete` | Protected. `/:id/clone` runs `addRecipeLimiter` before CSRF — cosmetic ordering nit, REW-99. |
| (c) Destructive, bodiless, forgeable today | `POST /cookbooks/:id/delete`, `POST /meal-plans/:id/delete` | **Equal severity to REW-101.** Follow-up [REW-105](https://wanderingnerds.atlassian.net/browse/REW-105) (Bug, High). Same one-line fix per route with CSRF ahead of the existing limiter. Should not wait for REW-99. |
| (c) Non-destructive, bodiless, forgeable today | `POST /meal-plans/:id/recipes/:recipeId/remove` (Medium); `POST /cookbooks/:id/recipes/:recipeId`, `POST /api/meal-plans/:id/recipes/:recipeId`, `POST /api/likes/:recipeId`, `POST /auth/logout`, `POST /admin/logout` (Low) | REW-99's domain, or fold into REW-105. |
| (c) Incidentally safe (read `req.body` before mutating) | cookbook / meal-plan create, update, visibility, add-recipes; `/api/meal-plans`; `/api/tags`; import save; help-feedback; admin feedback; admin login; the auth forms | Not a control. REW-99. `POST /auth/reset-password/session` tolerates an undefined body and was **not verified**. |
| (c) Structural only | `DELETE /api/tags/:id`, `DELETE /api/likes/:recipeId`, `DELETE /api/meal-plans/:id/recipes/:recipeId` | Not form-forgeable. REW-99. |

The full per-route table with file and line locations lives in
`docs/plans/rew-101-recipe-delete-csrf-protection.md`, on the Confluence plan page, and in
[`docs/api/README.md`](api/README.md#route-level-csrf-audit-rew-101).

---

## Database Changes

**None.** No migration, no table or column change, no RLS or grant change. The delete's ownership scoping
and the owner-only RLS DELETE policy on `recipes` are untouched — CSRF protection is a request-authenticity
check in front of them, not a replacement. Nothing was added to `database/migrations/`; `database/README.md`
gained a one-line "requires no migration" note. **020 remains the highest applied migration.**

---

## API Changes

`POST /recipes/:id/delete` — same URL, same auth, same success behaviour (flash and redirect to
`/recipes`), same failure redirect. What changed: a request without a valid `_csrf` (missing, tampered,
cross-session, or carried inside a multipart body) now receives the 403 error page **before** the handler
runs, where it previously ran the delete.

**Is this breaking?** No. This is a browser form post with no JSON contract, and every form that targets it
already sends the token. Full description: [API docs](api/README.md#recipes).

---

## Configuration and Deployment

- **No new environment variables.**
- **No new dependencies.**
- **No migrations to run.**
- **No `vercel.json` change.**
- **No security middleware changes** — the global wrapper, helmet, CORS and the auth middleware are
  untouched.

Standard application deployment once merged. **Before merge:** confirm `npm test` is fully green on a Linux
runner (Windows cannot run the two `csrf.integration.test.js` cases), and have a human do the five-surface
manual pass below.

---

## Testing

**Automated.** `npm test` on Windows: **533 tests, 531 pass, 2 fail.** Both failures are the pre-existing
`EACCES /tmp/*.sock` cases in `src/csrf.integration.test.js` (REW-90 / REW-98), a file this change does
not touch. The 7 new cases pass with 0 skipped. The reviewer independently confirmed the numbers and that
the regression sweep the plan named passes: `src/routes/recipeVisibilityToggle.test.js`,
`src/routes/recipeCloneRoutes.test.js` (which asserts the clone route's stack length is exactly 4 and is
unaffected), `src/routes/cookbookApiRoutes.test.js`, and `src/views/recipeCard.test.js` (which counts the
`_csrf` tokens in the card's delete forms).

**QA: not performed.** The QA stage was deliberately skipped on this run. Still pending a human:

1. Logged in as an owner, delete a recipe from each of the five surfaces — the recipe detail page,
   `/recipes` (My Recipes), `/recipes/liked` (My Favorites, on an owned favorite), `/cookbooks/:id` (an
   owned recipe in a cookbook) and `/meal-plans/:id` (an owned recipe in a plan). Each should show the
   confirm dialog, then the "Recipe deleted successfully!" flash and a redirect to `/recipes`.
2. With the browser's session cookies in curl, `POST /recipes/<id>/delete` with `-F ignored=1` (multipart)
   and no `_csrf`: expect the 403 error page, and the recipe still exists.
3. Same, urlencoded (`-d ignored=1`) with no token, and with a garbage `_csrf`: 403 both times, recipe
   still exists.
4. Same, urlencoded with the real `_csrf` from the rendered form: the recipe is deleted, proving curl-level
   parity with the browser form.

---

## Reviewer Findings (round 1, approved)

No blocking findings. Four non-blocking items:

1. `docs/api/README.md` and `README.md` claimed CSRF runs before the rate limiter "in each case" — false
   for `/:id/clone` (`requireAuth` → `addRecipeLimiter` → `csrfProtection`). **Fixed** in the documentation
   pass; both now name the clone route as the exception.
2. `docs/api/cookbook-card.md` and `docs/api/meal-plan-card.md` still said the delete route "has" no
   route-level `csrfProtection` in the present tense. **Fixed** — past tense, with the REW-101 outcome.
3. The same two pages' follow-up lists cited REW-102 as open. **Fixed** — marked as addressed by REW-101.
4. `findDeleteLayer()` in the new test duplicates `deleteRouteHandles()`. **Left as is** — code is outside
   the documentation pass's remit.

---

## Related Tickets

- **[REW-102](https://wanderingnerds.atlassian.net/browse/REW-102)** — filed the same day for the same
  defect with slightly broader acceptance criteria (missing **or invalid** token; the Cookbook page as a
  third delete surface; audit every `router.post`). All covered by this branch. Linked in Jira as a
  duplicate of REW-101; its status was not changed — close it when REW-101 merges.
- **[REW-105](https://wanderingnerds.atlassian.net/browse/REW-105)** — **new** (Bug, High, labels `csrf` /
  `security`): route-level `csrfProtection` on `POST /cookbooks/:id/delete` and
  `POST /meal-plans/:id/delete`. Same defect class, same destructive severity, found by this ticket's
  audit. Recommend scheduling immediately after REW-101 merges.
- **[REW-99](https://wanderingnerds.atlassian.net/browse/REW-99)** — the central fix to
  `csrfProtectionExceptMultipart`. Out of scope here and untouched. Owns everything marked "incidental" in
  the audit, the clone-route ordering nit, and the low-severity bodiless routes.
- **[REW-90](https://wanderingnerds.atlassian.net/browse/REW-90)** /
  **[REW-98](https://wanderingnerds.atlassian.net/browse/REW-98)** — the two Windows unix-socket failures
  in `src/csrf.integration.test.js`.
- **[REW-87](https://wanderingnerds.atlassian.net/browse/REW-87)** (Done),
  **[REW-88](https://wanderingnerds.atlassian.net/browse/REW-88)**,
  **[REW-89](https://wanderingnerds.atlassian.net/browse/REW-89)** — the card tickets that put a Delete
  button on the second, third and fourth pages and whose docs flagged the gap.

---

## Documentation

- `docs/api/README.md` — the `POST /recipes/:id/delete` row and a new status paragraph beneath the Recipes
  table; the CSRF Protection route list, now stating the `/:id/clone` ordering exception correctly; the
  new "Route-level CSRF audit (REW-101)" subsection.
- `README.md` — the CSRF security bullet, with the same correction and pointers to the audit and REW-105.
- `docs/api/cookbook-card.md`, `docs/api/meal-plan-card.md` — Security sections moved to past tense;
  follow-up lists mark REW-102 as addressed by REW-101.
- `docs/RELEASE_NOTES_REW-88.md`, `docs/RELEASE_NOTES_REW-89.md` — one dated annotation each on their
  REW-102 follow-up bullets; left as point-in-time records.
- `database/README.md` — a "REW-101 requires no migration" note.
- `docs/plans/rew-101-recipe-delete-csrf-protection.md` — the plan, unchanged (point-in-time record; the
  Confluence plan page carries the as-shipped update).
- `docs/confluence/JIRA_COMMENT_REW-101.md` — the Jira comment posted on REW-101.
- `docs/RELEASE_NOTES_REW-101.md` — this file.
- Confluence: [Release: REW-101 - Route-Level CSRF Protection on Recipe Delete](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/33619969)
  (new, under Releases); the [Bug Fix Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/33456129)
  updated to as-shipped; the [Bug Fixes index](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/24477697)
  row updated.
