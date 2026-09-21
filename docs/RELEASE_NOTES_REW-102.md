# Release Notes: REW-102 - Route-Level CSRF Audit of `src/routes/` (+ the four holes it found)

**Date:** 2026-09-20
**Jira Issue:** [REW-102](https://wanderingnerds.atlassian.net/browse/REW-102) (Task, High, labels `csrf` / `security` / `tech-debt`)
**Branch:** `REW-102-recipe-delete-csrf-protection`
**Pipeline:** Planner → Developer → Reviewer (approved, no blocking issues) → Documentation. **The QA stage was deliberately skipped on this run — nothing here has been verified in a browser or against a live database.**
**Confluence:** [Release: REW-102 - Route-Level CSRF Audit of src/routes/](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/34242561) (as-shipped) · [REW-102 Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/34177025) (updated with the as-shipped state)
**Audit of record:** `docs/api/README.md` → *Route-level CSRF audit (REW-101 / REW-105 / REW-102)*; full working in `docs/plans/rew-102-recipe-delete-csrf-audit.md`.

---

## Why this diff is small relative to the ticket

REW-102's title asks for route-level `csrfProtection` on `POST /recipes/:id/delete`, and criteria 1-3
are about that route. **All three were already satisfied on `main` before this branch started:**

- `POST /recipes/:id/delete` got its route-level `csrfProtection` from
  [REW-101](https://wanderingnerds.atlassian.net/browse/REW-101), merged in PR #62 (`f8673b1`), with
  `src/routes/recipeDeleteRoutes.test.js` pinning the chain.
- [REW-105](https://wanderingnerds.atlassian.net/browse/REW-105) did the same for
  `POST /cookbooks/:id/delete` and `POST /meal-plans/:id/delete`, merged in PR #63 (`28a0cf8`).

Each was verified by reading the code on `main`, not taken on faith. What was left unmet was REW-102's
**fourth** criterion: *"Audit the remaining `router.post` handlers in `src/routes/` for the same gap
and note any others found."* This release delivers that audit — plus a proportionate fix for the one
destructive hole and three low-severity holes it found still open.

---

## Summary

`src/app.js` mounts `csrfProtectionExceptMultipart` globally. That wrapper calls `next()` with **no
token validation at all** when `req.is("multipart/form-data")`, because `csrf-csrf` reads the token
from `req.body._csrf` and that field does not exist until Multer has parsed the body. An attacker's
page can issue a cross-site `multipart/form-data` POST from a plain HTML form — no JavaScript, no CORS
preflight — and nothing on a non-upload route parses that body, so the handler runs with
`req.body === undefined` (body-parser's skip path leaves it `undefined`, not `{}`; verified in the
installed dependency).

All **43 mutating handlers** in `src/routes/` were classified against that mechanism — 39
`router.post` plus 4 `router.delete`. Result:

- **15 routes** already carry route-level `csrfProtection`. No action.
- **1 route was a live destructive hole of exactly the REW-101 class:**
  `POST /meal-plans/:id/recipes/:recipeId/remove`. It reads **no** body fields at all, so nothing
  stopped it — a forged cross-site multipart POST deleted a `meal_plan_recipes` row. Fixed here.
- **3 routes** were low-severity bodiless mutations on the same recipe-organization surface
  (`POST /cookbooks/:id/recipes/:recipeId`, `POST /api/meal-plans/:id/recipes/:recipeId`,
  `POST /api/likes/:recipeId`). Fixed here, in the same diff, because each is one identifier and one
  of them is the direct twin of an already-protected route.
- **3 session-lifecycle routes** remain forgeable and were held back on purpose — filed as
  [REW-106](https://wanderingnerds.atlassian.net/browse/REW-106).
- **25 routes** are not exploitable, each with a concrete reason. Three of those are safe *only*
  because a property access on an `undefined` body throws, with no validator behind the accident;
  they are recorded as an explicit regression tripwire for
  [REW-99](https://wanderingnerds.atlassian.net/browse/REW-99).

The audit also corrects four claims in the REW-101 audit table that were wrong or had gone stale.

---

## User-Facing Changes

- **None for legitimate use.** The meal-plan Remove form and the "+ Add to &lt;cookbook&gt;" form both
  post `application/x-www-form-urlencoded` with a hidden `_csrf`. The two JSON routes are only ever
  called by `fetch`, and `public/js/main.js` already attaches `x-csrf-token` to every same-origin
  state-changing request — `POST /api/cookbooks/:id/recipes/:recipeId` has been running that way in
  production since REW-86, which is what makes this path a known quantity rather than a guess.
- A forged cross-site request to any of the four routes now gets the standard 403 error page instead
  of mutating the victim's data.
- **Unverified in a browser.** QA was skipped. The Remove round trip, the cookbook add, the
  like/unlike toggle and the "+ Meal Plan" modal add all still need a human pass.

---

## Technical Changes

Four one-identifier middleware insertions, each with a rationale comment. No handler body, validator,
ownership filter, UUID guard, flash string, redirect target, view, limiter configuration, RLS policy or
dependency changed anywhere in the diff.

| File | Route | Chain after the change |
| --- | --- | --- |
| `src/routes/mealPlanRoutes.js:623` | `POST /meal-plans/:id/recipes/:recipeId/remove` | `requireAuth` → `csrfProtection` → `mealPlanLimiter` → handler |
| `src/routes/cookbookRoutes.js:551` | `POST /cookbooks/:id/recipes/:recipeId` | `requireAuth` → `csrfProtection` → `cookbookLimiter` → handler |
| `src/routes/mealPlanApiRoutes.js:192` | `POST /api/meal-plans/:id/recipes/:recipeId` | `requireApiAuth` → `csrfProtection` → `mealPlanApiLimiter` → handler |
| `src/routes/likeRoutes.js:130` | `POST /api/likes/:recipeId` | `requireApiAuth` → `csrfProtection` → `likeLimiter` → handler |

`mealPlanApiRoutes.js` and `likeRoutes.js` gained a named import of `csrfProtection` from
`../middleware/csrfMiddleware.js`; the other two files already imported it.

**Ordering is a security property, not style.** `csrfProtection` sits after
`requireAuth`/`requireApiAuth` and **before** the rate limiter on all four routes, so a forged
cross-site request is rejected without consuming any of the victim's quota. All four limiters key on
`req.user.id`, so an attacker who could burn quota could lock the victim out of a feature for a
minute. Tests pin the ordering.

**The added middleware is the exact `doubleCsrfProtection` export**, never a re-wrapped copy and never
`csrfProtectionExceptMultipart` (the wrapper being bypassed). Tests assert *identity*
(`handles.indexOf(csrfProtection)`) rather than a function name, so a look-alike cannot pass.

**No Multer or body-parsing stage was added to any of the four routes.** Doing so would expose a
multipart `_csrf` part and re-open the bypass. Each route comment says so explicitly.

### Rejection behaviour

`csrf-csrf` calls `next()` with an `http-errors` 403 carrying `code: "EBADCSRFTOKEN"`, and
`src/middleware/errorHandler.js` renders the error page with that status — identical to every other
CSRF failure in the app. The two JSON routes produce the same 403; no information leak, and no
existence of a plan, cookbook or recipe is revealed.

---

## What was deliberately left alone

- **`POST /auth/logout`, `POST /admin/logout`, `POST /admin/login`** — filed as
  [REW-106](https://wanderingnerds.atlassian.net/browse/REW-106). They are session-lifecycle rather
  than content routes, they span the admin auth boundary, and the right behaviour for a tokenless
  logout is a product decision (a hard 403 where the user expected to be signed out is arguably worse
  than a no-op redirect). That decision does not belong inside an audit diff. **New finding:**
  `POST /admin/login` is *not* safe, contrary to the REW-101 audit — `req.body.email` throws on the
  unparsed body, the outer `catch { return deny(); }` swallows the `TypeError`, and `deny()`'s first
  statement is `clearAuthCookies(res)`. The exception causes the mutation rather than preventing it, so
  a forged tokenless cross-site POST forces a logout for *any* signed-in user and burns the victim
  IP's 10-per-15-minutes admin-login budget.
- **`src/middleware/csrfMiddleware.js` and `src/app.js`** — REW-99's domain. Zero lines changed.
- **`POST /cookbooks/:id/visibility`, `POST /meal-plans/:id/visibility`,
  `POST /cookbooks/:id/recipes/:recipeId/remove`** — the REW-99 tripwire (below). Out of scope here;
  touching the visibility pair would have broken two unrelated test files' `stack.length === 3`
  assertions, and those must be *upgraded*, not relaxed, by whoever does the work.
- **The four `DELETE`-verb routes** — HTML forms emit only GET/POST, and a cross-origin `fetch` with
  method DELETE is preflighted and refused by the CORS allow-list. Adding CSRF there would be
  unverifiable scope creep.
- **`POST /recipes/:id/clone`'s limiter-before-CSRF ordering** — a pre-existing nit, documented and
  left for REW-99.

---

## REW-99 regression tripwire (carried forward)

Three routes are safe today **only** because reading a property of an `undefined` body throws, and
they have **no validation gate behind that accident**. They fail closed the moment `req.body` becomes
`{}`, the wrapper starts parsing multipart bodies, or someone "tidies" the read to `req.body?.x`:

| Route | What happens the moment `req.body` is `{}` |
| --- | --- |
| `POST /cookbooks/:id/visibility` (`cookbookRoutes.js:351`) | `normalizeCookbookVisibility(undefined)` is `value === "public"` → `false`, with no validity check, so the handler runs `UPDATE cookbooks SET is_public = false` — silently un-sharing the cookbook and breaking every share link the owner distributed. It can never force *Public*, so this is forced-state, not disclosure. |
| `POST /meal-plans/:id/visibility` (`mealPlanRoutes.js:416`) | Identical, via `normalizeMealPlanVisibility`. |
| `POST /cookbooks/:id/recipes/:recipeId/remove` | `req.body.returnTo` is the first statement in the `try`, so today's `TypeError` lands before the delete. With `{}` it becomes `undefined`, falls through to the default redirect, and the `cookbook_recipes` delete runs — the same destructive hole REW-102 just closed on the meal-plan side. |

The REW-101 audit rated all three "Incidental — body read precedes the mutation." Right outcome, wrong
reason. Whoever works REW-99 must add route-level `csrfProtection` to all three in the same change, and
must **upgrade** `cookbookVisibilityRoutes.test.js` / `mealPlanVisibilityRoutes.test.js` (currently
asserting `stack.length === 3`) to pin the exact export and its position, following
`recipeVisibilityToggle.test.js`.

---

## `SameSite=Lax` — what the reviewer verified (a correction to earlier write-ups)

Both auth cookies are set with an **explicit** `sameSite: "lax"` (`src/utils/authUtils.js:10-23`).
Earlier CSRF documents in this repo — including REW-102's own plan — said the victim's cookies ride
along on a cross-site multipart form POST. **They do not, in a current browser.** Lax sends cookies on
a top-level navigation only for *safe* methods, and the "Lax+POST" two-minute grace window applies
only to a cookie with no `SameSite` attribute, not to one set explicitly.

So for every route that needs the victim's cookie **on the request** — the four fixed here included —
real-world exploitation needs a same-site attacker origin (any subdomain counts), a browser not
enforcing Lax, or a non-browser client already holding the cookies. "Forged cross-site multipart POST"
throughout these notes is shorthand for the attack *shape*, not a claim that a stock browser tab
attaches the session.

It does **not** blunt the REW-106 routes at all. `POST /auth/logout`, `POST /admin/logout` and
`POST /admin/login` clear cookies on the **response** and need no request cookie to do damage, so a
plain tokenless cross-site POST still forces a logout (and still burns limiter quota on
`/admin/login`).

None of this downgrades a severity or makes a route-level check optional. `SameSite` is a browser
behaviour this app does not control; the route-level `csrfProtection` is what enforces request
authenticity server-side, which is the part we own.

---

## Tests

**26 new cases across four files.** All four use the same structure as
`src/routes/recipeDeleteRoutes.test.js`: a no-HTTP chain-shape assertion plus an HTTP harness that
mounts the route's **real** middleware slice taken from the router's own stack, with a "never mount an
empty slice" guard. Every harness binds `127.0.0.1:0` — never a unix socket (REW-90 / REW-98) — and
*skips* rather than fails where TCP listeners are forbidden.

- **`src/routes/mealPlanRecipeRemoveRoutes.test.js` (new, 8 cases)** — the Tier 1 route. Chain shape
  (`requireAuth` at 0, exact `csrfProtection` export at 1, limiter at 2, terminal handler at 3,
  POST-only); forged multipart with no token → 403 with and without the victim's `csrf-token` cookie;
  urlencoded with no token → 403; urlencoded with a tampered token **and** with a valid token issued
  to another session → 403; valid urlencoded token → handler exactly once with both route params
  intact; multipart carrying a valid `_csrf` part → still 403 (pins the absence of a Multer stage);
  and a quota test proving rejected forged requests consume no limiter budget.
- **`src/routes/likeRoutes.test.js` (new, 7 cases)** — POST chain shape; `GET /:recipeId` stays public
  with no auth, no CSRF and no limiter (so the fix cannot silently lock down the public like count);
  `DELETE /:recipeId` annotated as deliberately unchanged; forged multipart → 403; the browser
  client's `x-csrf-token` header path still reaches the handler; tokenless and tampered fetch-shaped
  POSTs → 403.
- **`src/routes/mealPlanApiRoutes.test.js` (new, 7 cases)** — no test file existed for this router.
  Table-driven: every route authenticates first and is rate limited; the POST chain shape; `POST /`
  and `DELETE /:id/recipes/:recipeId` annotated as deliberately unchanged with the reason; forged
  multipart → 403; the header path still works; tokenless and tampered POSTs → 403.
- **`src/routes/cookbookRoutes.test.js` (extended, 4 new cases)** — chain shape for the add route, a
  forged multipart rejection, and the real urlencoded form still reaching the handler. The 10 existing
  REW-88 cases pass unmodified.

**Every one of the four files includes a control case** that mounts the same real slice with
`csrfProtection` filtered out and proves the identical forged request *does* reach the handler. Without
it, the rejection assertions could pass vacuously.

**Suite at hand-off: 575 tests, 573 passing, 2 failing.** Both failures are the pre-existing
`listen EACCES /tmp/*.sock` cases in `src/csrf.integration.test.js`, which this diff does not touch —
Windows cannot bind unix-domain sockets. Environmental, not a regression, tracked as
[REW-90](https://wanderingnerds.atlassian.net/browse/REW-90) /
[REW-98](https://wanderingnerds.atlassian.net/browse/REW-98). A fully green Linux run is still owed
before merge.

Regression sweep green, including `cookbookVisibilityRoutes.test.js` and
`mealPlanVisibilityRoutes.test.js` — their `stack.length === 3` assertions still pass **unmodified**,
which is the proof this change did not leak outside its scope.

---

## Database Changes

**None.** No migration, table, column, index, constraint, grant or RLS policy change. CSRF protection
is about *intent*; RLS is about *permission*. The owner-only policies on `cookbook_recipes`,
`meal_plan_recipes` and `recipe_likes` remain the authorization layer and are untouched, as are the
`ON DELETE CASCADE` relationships. **`020` remains the highest applied migration.** Recorded in
`database/README.md`.

---

## Deployment

Standard deploy once merged. No migration to run, no new environment variable, no new dependency, no
`vercel.json` change, no cache or CDN implication. The change is inert until the routes are hit, and
rolling back is reverting four middleware lists.

---

## Documentation Updated

- `docs/api/README.md` — the audit subsection rewritten as the audit of record
  (`(a)` 15 protected routes, `(b)` 3 still forgeable, `(c)` 25 not exploitable grouped by reason, the
  REW-99 tripwire, the `SameSite=Lax` analysis, the four corrections, and residual risk); the four
  endpoint rows; the "Known gap (REW-99)" paragraph; the stale "REW-101 is branch-only" sentence.
- `docs/api/meal-plans.md` — a Middleware block on the Remove route, the JSON API CSRF paragraph, the
  Security CSRF bullet, a dated changelog row.
- `docs/api/cookbooks.md` — a Middleware block on the single-add route, the Remove route's tripwire
  warning, the Security CSRF bullet, a dated changelog row.
- `docs/api/recipe-likes.md` — the POST middleware line, and the Security bullet that still claimed
  CSRF was disabled repo-wide (false since REW-71).
- `docs/api/cookbook-card.md`, `docs/api/meal-plan-card.md` — the documented chains for the routes this
  change touched, the tripwire note on the cookbook Remove route, and the stale "REW-101 is unmerged"
  claims in their Security and follow-up sections.
- `database/README.md` — "REW-102 requires no migration", and the stale REW-101 merge state.
- `README.md` — the security bullet's route list, the audit link, and REW-106.
- `docs/RELEASE_NOTES_REW-101.md` — a "superseded by REW-102" note and a corrected anchor link.

This documentation pass discharges most of
[REW-107](https://wanderingnerds.atlassian.net/browse/REW-107) — the review-raised ticket covering
publication of this audit — specifically its scope items 1, 2, 4 and 5. **Item 3 is not done:** two
stale EJS comments at `views/partials/recipe-summary-card.ejs:86-89` and `:328-338` still enumerate
middleware chains that omit `csrfProtection`. They have zero runtime effect, but they are wrong, and
they were left alone deliberately because this pass does not touch `views/**`. REW-107 stays open for
them.

---

## Outstanding

- **Manual verification of everything below. QA was skipped; nothing has been exercised in a browser.**
  - Remove a recipe from a meal plan via the card's Remove button: confirm dialog, "Removed from
    &lt;plan&gt;." flash, redirect to `/meal-plans/:id`, and the recipe itself still exists.
  - Add a recipe to a cookbook from the recipe detail page; the "+ Meal Plan" modal add; the
    like/unlike toggle. These exercise the urlencoded `_csrf` path and the `x-csrf-token` fetch path.
  - An authenticated `multipart/form-data` POST with no token to
    `/meal-plans/:id/recipes/:recipeId/remove` (e.g. `curl -F ignored=1` with session cookies) returns
    403 and the membership row still exists.
  - Carried over and still owed from REW-101: Delete still works from the recipe detail page, My
    Recipes, My Favorites, a Cookbook page and a Meal Plan page.
- A fully green test run on Linux (the two Windows socket failures must disappear, not be worked
  around).
- [REW-106](https://wanderingnerds.atlassian.net/browse/REW-106) — the three session-lifecycle routes,
  including the rejection-UX product decision.
- [REW-99](https://wanderingnerds.atlassian.net/browse/REW-99) — the central wrapper fix, plus the
  three tripwire routes and the clone-route ordering nit.
- [REW-107](https://wanderingnerds.atlassian.net/browse/REW-107) — remains open for its scope item 3,
  the two stale `views/partials/recipe-summary-card.ejs` comments. Everything else in that ticket is
  delivered by this documentation pass.
- Jira hygiene: REW-101 is merged but its status still reads *In Progress*. REW-102 stays *In Progress*
  until manual verification and REW-107 land.
