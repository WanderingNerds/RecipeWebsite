# Jira Comment for REW-102

*Posted to the REW-102 Jira issue.*

---

## Audit Published — Four Routes Fixed — QA Not Run, Status Stays In Progress

REW-102's fourth acceptance criterion (*"Audit the remaining `router.post` handlers in `src/routes/`
for the same gap and note any others found"*) is now discharged. All **43 mutating handlers** are
classified and published in `docs/api/README.md` and on Confluence. Criteria 1-3 were already
satisfied on `main` before this branch started — by REW-101 (PR #62, `f8673b1`) and REW-105 (PR #63,
`28a0cf8`) — which is why the code diff is small relative to the ticket text. Each was verified by
reading the code, not assumed.

Caveats before anyone reads this as finished:

- **The QA stage was deliberately skipped.** No browser pass, no curl verification, no live-database
  check. Every manual acceptance criterion is still owed.
- **REW-107 is not fully closed.** This pass delivers its scope items 1, 2, 4 and 5; item 3 (two
  stale `<%# %>` comments in `views/partials/recipe-summary-card.ejs`) is untouched, because the
  documentation pass does not edit `views/**`.
- **Status deliberately left at In Progress.**

**Audit result.** One live destructive CSRF hole of exactly the REW-101 class was still open, plus
three low-severity bodiless mutations on the same recipe-organization surface. All four now carry
route-level `csrfProtection`, placed **before** the rate limiter so a forged request burns none of
the victim's quota:

- `POST /meal-plans/:id/recipes/:recipeId/remove` (`mealPlanRoutes.js:623`) — **the destructive
  one.** It reads no body fields at all, unlike its cookbook twin which reads `req.body.returnTo` and
  therefore throws on an unparsed body, so nothing stopped a forged multipart POST from deleting a
  `meal_plan_recipes` row.
- `POST /cookbooks/:id/recipes/:recipeId` (`cookbookRoutes.js:551`)
- `POST /api/meal-plans/:id/recipes/:recipeId` (`mealPlanApiRoutes.js:192`)
- `POST /api/likes/:recipeId` (`likeRoutes.js:130`)

The last three are additive and reversible; `POST /api/cookbooks/:id/recipes/:recipeId` was already
protected, so two of them are consistency rather than new policy. Handler bodies, validators,
ownership filters, UUID guards, flash copy, redirects, limiter configuration, views and RLS are all
unchanged. Zero lines in `src/middleware/csrfMiddleware.js` or `src/app.js`.

**Deferred, with reasons.** `POST /auth/logout`, `POST /admin/logout` and `POST /admin/login` are
filed as REW-106 — session-lifecycle rather than content routes, crossing the admin auth boundary,
and the right behaviour for a tokenless logout is a product decision. **New finding:**
`POST /admin/login` is *not* safe, contrary to the REW-101 audit. `req.body.email` throws on the
unparsed body, the outer `catch { return deny(); }` swallows it, and `deny()`'s first statement is
`clearAuthCookies(res)` — the exception causes the mutation rather than preventing it, so a forged
tokenless request logs out any signed-in user and burns the victim IP's admin-login quota.

**REW-99 tripwire, now on the record.** `POST /cookbooks/:id/visibility`,
`POST /meal-plans/:id/visibility` and `POST /cookbooks/:id/recipes/:recipeId/remove` are safe today
**only** because a property access on an `undefined` body throws — there is no validator behind that
accident. They become exploitable the moment `req.body` is `{}`, or the wrapper parses multipart, or
someone rewrites a read as `req.body?.x`; the visibility pair would silently un-share the owner's
cookbook or plan. Whoever works REW-99 must fix all three in the same change and **upgrade** (never
relax) the two visibility test files' `stack.length === 3` assertions.

**Corrections to the REW-101 audit table**, all now recorded: the four routes above were still listed
as open holes; `POST /admin/login` was classified safe; the tripwire trio was rated "incidental" for
the wrong reason; `POST /auth/reset-password/session` was marked "not verified" (it is verified safe);
and the "REW-101 is branch-only" note was stale. One further correction: earlier write-ups claimed the
victim's `SameSite=Lax` cookies ride along on a cross-site multipart POST. They do not in a current
browser — but `SameSite` does nothing for the REW-106 routes, which clear cookies on the *response*.

**Tests:** 26 new cases across `mealPlanRecipeRemoveRoutes.test.js` (new, 8),
`likeRoutes.test.js` (new, 7), `mealPlanApiRoutes.test.js` (new, 7) and `cookbookRoutes.test.js`
(extended, 4). Each pins the chain by **identity** against the exact `csrfProtection` export, asserts
CSRF before the limiter, and includes a **control case** proving the same forged request reaches the
handler without the route-level check, so no rejection assertion can pass vacuously. All harnesses
bind `127.0.0.1:0`, never a unix socket (REW-90/REW-98).

`npm test` on Windows — **575 tests, 573 pass, 2 fail**; the 2 are the pre-existing
`EACCES /tmp/*.sock` cases in `src/csrf.integration.test.js`, untouched by this diff. A fully green
Linux run is still owed. Regression sweep green, including both visibility test files passing
**unmodified** — the proof the change did not leak outside its scope.

**Database:** no migration. CSRF is a request-authenticity check, not an authorization change; the
owner-only RLS policies remain the authorization layer and `020` stays the highest applied migration.

**Deployment:** standard deploy once merged. No migration step, no new environment variable, no new
dependency, no `vercel.json` change.

**Documentation updated:** `docs/api/README.md` (audit of record, endpoint rows, the REW-99 gap
paragraph, the stale REW-101 merge note), `docs/api/meal-plans.md`, `docs/api/cookbooks.md`,
`docs/api/recipe-likes.md`, `docs/api/cookbook-card.md`, `docs/api/meal-plan-card.md`,
`database/README.md`, `README.md`, `docs/RELEASE_NOTES_REW-101.md` and the new
`docs/RELEASE_NOTES_REW-102.md`.

**Still outstanding:** all manual verification (the card Remove round trip, add-to-cookbook, the
"+ Meal Plan" modal add, like/unlike, a tokenless multipart POST returning 403 with the membership
row intact, and the five-surface delete pass carried over from REW-101); a green Linux run; REW-106;
REW-99; REW-107 item 3. Ticket hygiene: REW-101 and REW-105 are both merged but still read
*In Progress*.

---
