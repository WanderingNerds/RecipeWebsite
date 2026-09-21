# Release: REW-102 - Route-Level CSRF Audit of src/routes/

*Confluence page body. **Published** at
[wiki/spaces/Recipe/pages/34242561](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/34242561),
as a child of
[REW-102: Route-Level CSRF Audit of src/routes/ - Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/34177025).
Kept here as the repo-side copy, following the `docs/confluence/` convention.*

---

Jira issue: [REW-102 — Add route-level csrfProtection to POST /recipes/:id/delete](https://wanderingnerds.atlassian.net/browse/REW-102) — Task, Priority High, labels `csrf` / `security` / `tech-debt`.

Branch: `REW-102-recipe-delete-csrf-protection` · Shipped 2026-09-20 · Plan page: [REW-102 Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/34177025).

**Pipeline: Planner → Developer → Reviewer (approved, no blocking issues) → Documentation. The QA stage was deliberately skipped. Nothing below has been verified in a browser or against a live database, and the Jira status stays In Progress.**

Repo artefacts: audit of record in `docs/api/README.md` ("Route-level CSRF audit (REW-101 / REW-105 / REW-102)"); full working in `docs/plans/rew-102-recipe-delete-csrf-audit.md`; release notes in `docs/RELEASE_NOTES_REW-102.md`.

## Why the diff is small relative to the ticket

REW-102's title and first three acceptance criteria are about `POST /recipes/:id/delete`. All three were already satisfied on `main` before this branch started, and were verified by reading the code rather than assumed:

- [REW-101](https://wanderingnerds.atlassian.net/browse/REW-101) added the route-level check and its test file, merged in PR #62 (`f8673b1`).
- [REW-105](https://wanderingnerds.atlassian.net/browse/REW-105) did the same for the cookbook and meal-plan deletes, merged in PR #63 (`28a0cf8`).

What was left was REW-102's **fourth** criterion — audit the remaining `router.post` handlers in `src/routes/` and note any others found. This release delivers that audit, plus a proportionate fix for what the audit found still open.

## What shipped

All **43 mutating handlers** in `src/routes/` were classified (39 `router.post` + 4 `router.delete`). The audit found one live destructive hole of exactly the REW-101 class and three low-severity ones on the same surface. All four now carry route-level `csrfProtection`:

| File · line | Route | Chain after the change |
| --- | --- | --- |
| `src/routes/mealPlanRoutes.js:623` | POST /meal-plans/:id/recipes/:recipeId/remove | requireAuth → csrfProtection → mealPlanLimiter → handler |
| `src/routes/cookbookRoutes.js:551` | POST /cookbooks/:id/recipes/:recipeId | requireAuth → csrfProtection → cookbookLimiter → handler |
| `src/routes/mealPlanApiRoutes.js:192` | POST /api/meal-plans/:id/recipes/:recipeId | requireApiAuth → csrfProtection → mealPlanApiLimiter → handler |
| `src/routes/likeRoutes.js:130` | POST /api/likes/:recipeId | requireApiAuth → csrfProtection → likeLimiter → handler |

The first was the only **destructive** one: it reads no body fields at all — unlike its cookbook twin, which reads `req.body.returnTo` and therefore throws on an unparsed body — so nothing stopped a forged multipart POST from deleting a `meal_plan_recipes` row. The other three are additive and reversible; `POST /api/cookbooks/:id/recipes/:recipeId` was already protected, so two of them are consistency rather than new policy.

`mealPlanApiRoutes.js` and `likeRoutes.js` gained a named `csrfProtection` import. Each route gained a rationale comment recording the why, the ordering rule, the caller's token path, and "do not add a Multer/body-parsing stage here".

**Nothing else changed.** No handler body, validator, ownership filter, UUID guard, flash string, redirect target, limiter configuration, view, RLS policy, dependency or environment variable. Zero lines in `src/middleware/csrfMiddleware.js` or `src/app.js`.

**Ordering is a security property, not style.** CSRF runs after auth and **before** the limiter on all four routes, so a forged request is rejected without consuming the victim's quota — all four limiters key on `req.user.id`, so an attacker who could burn quota could lock the victim out of a feature. The added middleware is the exact `doubleCsrfProtection` export; tests assert identity, not a function name, so a look-alike cannot pass.

## Deliberately deferred

- **[REW-106](https://wanderingnerds.atlassian.net/browse/REW-106)** — `POST /auth/logout`, `POST /admin/logout`, `POST /admin/login`. Session-lifecycle rather than content routes, they cross the admin auth boundary, and the right behaviour for a tokenless logout is a product decision. **New finding, contradicting the REW-101 audit:** `POST /admin/login` is not safe. `req.body.email` throws on the unparsed body, the outer `catch { return deny(); }` swallows the TypeError, and `deny()`'s first statement is `clearAuthCookies(res)`. The exception *causes* the mutation rather than preventing it, so a forged tokenless request logs out any signed-in user and burns the victim IP's 10-per-15-minutes admin-login quota.
- **[REW-99](https://wanderingnerds.atlassian.net/browse/REW-99) tripwire** — three routes are safe today **only** because a property access on an `undefined` body throws, with no validator behind the accident. They fail closed the moment `req.body` becomes `{}`, the wrapper starts parsing multipart, or someone rewrites a read as `req.body?.x`:
  - `POST /cookbooks/:id/visibility` (`cookbookRoutes.js:351`) and `POST /meal-plans/:id/visibility` (`mealPlanRoutes.js:416`) — `normalizeCookbookVisibility(undefined)` / `normalizeMealPlanVisibility(undefined)` fail closed to Private with no validity check, so the handler would run `UPDATE … SET is_public = false`, silently un-sharing the item and breaking every share link the owner distributed. Never able to force *Public*, so this is forced-state, not disclosure.
  - `POST /cookbooks/:id/recipes/:recipeId/remove` — `req.body.returnTo` is the first statement in the `try`; with `{}` it falls through to the default redirect and the delete runs. Destructive, identical to the hole just closed on the meal-plan side.

  Whoever works REW-99 must fix all three in the same change, and must **upgrade** `cookbookVisibilityRoutes.test.js` / `mealPlanVisibilityRoutes.test.js` (which assert `stack.length === 3`) to pin the exact export and its position — never relax or delete them.
- **The four DELETE-verb routes and the `/:id/clone` limiter-before-CSRF nit** — out of scope by design.

## Corrections to the REW-101 audit (now recorded in the repo)

1. The four routes fixed here were still listed as open holes assigned to REW-99.
2. `POST /admin/login` was classified safe. It is not — see above.
3. The visibility pair and the cookbook remove twin were rated "Incidental — body read precedes the mutation": right outcome, wrong reason, because there is no validation behind the thrown exception. Now the REW-99 tripwire.
4. `POST /auth/reset-password/session` was marked "not verified". Verified safe: `req.body || {}` then `type !== "recovery"` → 401 before any cookie is set.
5. The "REW-101 is branch-only and unmerged" note was stale.

## SameSite=Lax — a correction to earlier write-ups

Both auth cookies set `sameSite: "lax"` **explicitly** (`src/utils/authUtils.js:10-23`). Earlier CSRF documents in this repo, including REW-102's own plan, said the victim's cookies ride along on a cross-site multipart form POST. **They do not, in a current browser** — Lax sends cookies on a top-level navigation only for safe methods, and the Lax+POST grace window applies only to a cookie with no `SameSite` attribute.

So for routes needing the victim's cookie **on the request**, real-world exploitation needs a same-site attacker origin (any subdomain counts), a browser not enforcing Lax, or a non-browser client holding the cookies. "Forged cross-site multipart POST" is shorthand for the attack shape, not a claim that a stock browser tab attaches the session.

It does **not** blunt the REW-106 routes at all: those clear cookies on the **response** and need no request cookie, so a plain tokenless cross-site POST still forces a logout. None of this downgrades a severity — `SameSite` is browser behaviour this app does not control, while the route-level check is what the server enforces.

## Tests

**26 new cases across four files**, all following `recipeDeleteRoutes.test.js`: a no-HTTP chain-shape assertion plus an HTTP harness mounting the route's **real** middleware slice from the router's own stack, with a "never mount an empty slice" guard. Every harness binds `127.0.0.1:0` — never a unix socket (REW-90/REW-98) — and skips rather than fails where listeners are forbidden.

- `src/routes/mealPlanRecipeRemoveRoutes.test.js` (new, 8) — chain shape by identity; forged multipart with and without the victim's cookie → 403; urlencoded missing, tampered and cross-session tokens → 403; valid token → handler once with both params; multipart carrying a valid `_csrf` part → still 403; and a quota test proving rejected forged requests consume no limiter budget.
- `src/routes/likeRoutes.test.js` (new, 7) — POST chain; `GET /:recipeId` stays public with no auth, CSRF or limiter; `DELETE /:recipeId` annotated as deliberately unchanged; forged multipart → 403; the `x-csrf-token` header path still works; tokenless and tampered fetch POSTs → 403.
- `src/routes/mealPlanApiRoutes.test.js` (new, 7) — no test file existed for this router. Table-driven route coverage plus the same rejection and header cases; `POST /` and the DELETE annotated as deliberately unchanged with the reason.
- `src/routes/cookbookRoutes.test.js` (extended, 4) — chain shape, a forged multipart rejection, and the real urlencoded form still reaching the handler. The 10 existing REW-88 cases pass unmodified.

**Every file includes a control case** mounting the same real slice with `csrfProtection` filtered out, proving the identical forged request *does* reach the handler — without it the rejection assertions could pass vacuously.

**Suite: 575 tests, 573 passing, 2 failing.** Both failures are the pre-existing `listen EACCES /tmp/*.sock` cases in `src/csrf.integration.test.js`, untouched here — Windows cannot bind unix-domain sockets (REW-90/REW-98). A fully green Linux run is still owed. Regression sweep green, including both visibility test files passing **unmodified**, which is the proof the change did not leak outside its scope.

## Database and deployment

**No migration.** CSRF is a request-*authenticity* check, not an authorization change. The owner-only RLS policies on `cookbook_recipes`, `meal_plan_recipes` and `recipe_likes` remain the authorization layer and are untouched, as is every `ON DELETE CASCADE` relationship. **`020` remains the highest applied migration.**

Standard deploy once merged: no migration step, no new environment variable, no new dependency, no `vercel.json` change. Rolling back means reverting four middleware lists.

## Documentation updated in the repo

`docs/api/README.md` (the audit of record, the four endpoint rows, the REW-99 gap paragraph, the stale REW-101 merge note) · `docs/api/meal-plans.md` · `docs/api/cookbooks.md` · `docs/api/recipe-likes.md` (whose Security section still claimed CSRF was disabled repo-wide — false since REW-71) · `docs/api/cookbook-card.md` · `docs/api/meal-plan-card.md` · `database/README.md` · `README.md` · `docs/RELEASE_NOTES_REW-101.md` (superseded note) · `docs/RELEASE_NOTES_REW-102.md` (new).

This discharges scope items 1, 2, 4 and 5 of [REW-107](https://wanderingnerds.atlassian.net/browse/REW-107). **Item 3 is not done:** two stale `<%# %>` comments at `views/partials/recipe-summary-card.ejs:86-89` and `:328-338` still enumerate middleware chains that omit `csrfProtection`. They have zero runtime effect but are wrong, and were left alone because this pass does not touch `views/**`. REW-107 stays open for them.

## Outstanding

- **Manual verification of everything. QA was skipped.** The meal-plan card Remove round trip; add-to-cookbook from the recipe page; the "+ Meal Plan" modal add; the like/unlike toggle; an authenticated tokenless multipart POST to the remove route returning 403 with the membership row intact. Carried over and still owed from REW-101: Delete from the recipe detail page, My Recipes, My Favorites, a Cookbook page and a Meal Plan page.
- A fully green test run on Linux.
- REW-106, REW-99 and REW-107 (item 3) remain open.
- Jira hygiene: REW-101 is merged but still reads *In Progress*; REW-105 likewise. REW-102 stays *In Progress* until manual verification and REW-107 land.
