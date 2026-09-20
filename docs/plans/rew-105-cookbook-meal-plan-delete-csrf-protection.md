# REW-105: Route-level CSRF protection on POST /cookbooks/:id/delete and POST /meal-plans/:id/delete

## Jira issue

[REW-105 — Add route-level csrfProtection to POST /cookbooks/:id/delete and POST /meal-plans/:id/delete](https://wanderingnerds.atlassian.net/browse/REW-105)
Bug · Priority High · status **To Do** · labels `csrf` / `security` · assigned.
Branch: `REW-105-cookbook-meal-plan-delete-csrf-protection` (already checked out, from `main` at `fb27455`).

Relates to [REW-101](https://wanderingnerds.atlassian.net/browse/REW-101) — the recipe-delete fix this
change copies. REW-101 is **merged to `main`** (PR #62, commit `f8673b1`), so the reference
implementation (`src/routes/recipeRoutes.js` line 984) and reference test
(`src/routes/recipeDeleteRoutes.test.js`) are both on this branch already. Note for
Developer/Reviewer: REW-101's Jira status still reads *In Progress* despite the merge — transition
it; the planner does not.

Related, **not** in scope:

- [REW-99](https://wanderingnerds.atlassian.net/browse/REW-99) — the central fix to the global
  `csrfProtectionExceptMultipart` wrapper. **Do not touch `src/middleware/csrfMiddleware.js` or
  `src/app.js` here.** REW-105 is the route-level mitigation that must not wait for REW-99.
- [REW-90](https://wanderingnerds.atlassian.net/browse/REW-90) /
  [REW-98](https://wanderingnerds.atlassian.net/browse/REW-98) — `src/csrf.integration.test.js`
  binds `/tmp/*.sock` and fails with `EACCES` on Windows. The new tests must **not** repeat that
  harness choice.
- `POST /meal-plans/:id/recipes/:recipeId/remove` — listed in the REW-101 audit as "Medium,
  REW-105 or REW-99". It is **not** in REW-105's description or acceptance criteria and is not
  folded in (see Open questions, item 1).

## Confluence page

[REW-105: Route-Level CSRF Protection on Cookbook and Meal Plan Delete - Bug Fix Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/33554444/REW-105+Route-Level+CSRF+Protection+on+Cookbook+and+Meal+Plan+Delete+-+Bug+Fix+Plan)
(created under *Bug Fixes*, matching the convention for Bug-type tickets, and added to the Bug
Fixes index table. The Documentation agent updates it to as-shipped after review, following the
REW-101 page's pattern.)

## Summary

`src/app.js` line 85 mounts `csrfProtectionExceptMultipart` globally. That wrapper
(`src/middleware/csrfMiddleware.js` lines 13-16) returns `next()` for any `multipart/form-data`
body without validating a token, because `csrf-csrf` reads the token from `req.body._csrf`
(line 7) and that field does not exist until Multer has parsed the body. Two destructive routes
rely on the wrapper alone and read **no body fields** before mutating — only `req.params.id`,
`req.user.id` and `req.accessToken` — so a forged cross-site `multipart/form-data` POST from an
attacker's page reaches the handler with `req.body` undefined (Express 5 leaves it undefined when
no body parser matched) and runs the delete:

- `POST /cookbooks/:id/delete` — `src/routes/cookbookRoutes.js` line 355, chain
  `requireAuth → cookbookLimiter → handler`. Deletes the victim's `cookbooks` row and, via
  `ON DELETE CASCADE`, its `cookbook_recipes` membership rows.
- `POST /meal-plans/:id/delete` — `src/routes/mealPlanRoutes.js` line 420, chain
  `requireAuth → mealPlanLimiter → handler`. Deletes the victim's `meal_plans` row and its
  `meal_plan_recipes` membership rows.

Ownership scoping (`.eq("id", id).eq("user_id", req.user.id)` on top of the owner-only RLS DELETE
policies) limits the impact to the victim deleting their **own** cookbook or meal plan — no
cross-account deletion — but that is exactly the CSRF scenario, and a destructive one. Same defect
class and severity as REW-101; deliberately kept out of that diff so a one-line security fix did
not become a three-router change.

The fix is the REW-101 pattern applied twice, with one difference: these routes already carry a
per-user rate limiter, so `csrfProtection` is inserted **ahead of** the limiter
(`requireAuth → csrfProtection → <limiter> → handler`, the `/recipes/:id/visibility` precedent) so
a forged request is rejected before it consumes any of the victim's 30-per-minute quota. Each
route file also needs a one-line import, because neither imports `csrfProtection` today. Both
delete forms already post `application/x-www-form-urlencoded` with a hidden `_csrf`, so legitimate
submissions are unaffected. Two new route-level test files, modeled on
`recipeDeleteRoutes.test.js`, pin the chain and prove the multipart bypass no longer reaches
either handler.

## Open questions / assumptions

1. **`POST /meal-plans/:id/recipes/:recipeId/remove` stays out.** The audit marked it "Medium,
   REW-105 or REW-99", but the REW-105 ticket names only the two delete routes in its description
   and acceptance criteria. *Assumption:* it is REW-99's, and the Documentation agent corrects the
   `docs/api/README.md` audit row (line 337) to say so. If the user wants it folded in it is the
   same pattern (`requireAuth → csrfProtection → mealPlanLimiter → handler`, plus a third test
   file), but the ticket's AC should be amended first by whoever owns Jira edits. Flagging rather
   than expanding a security diff unasked.
2. **Two test files, not one.** `src/routes/cookbookDeleteRoutes.test.js` and
   `src/routes/mealPlanDeleteRoutes.test.js`, following the per-router naming of
   `cookbookVisibilityRoutes.test.js` / `mealPlanVisibilityRoutes.test.js`. They will be
   near-identical copies of `recipeDeleteRoutes.test.js` with the router, path and fixture changed.
   *Assumption:* the harness duplication is accepted (it is already duplicated once by REW-101).
   Extracting the shared harness into a helper module is optional and non-blocking; if done, the
   helper must **not** match `*.test.js` or `node --test` will try to run it.
3. **The control case mounts the pre-fix chain, not an empty slice.** `recipeDeleteRoutes.test.js`
   proves non-vacuity by mounting nothing between the auth stub and the spy. Here the pre-fix
   chain has a limiter in it, so the stronger control is to mount the router's real slice with
   `csrfProtection` filtered out — i.e. the limiter alone — and show the forged multipart POST
   still reaches the spy. That also documents that the limiter is not a CSRF control.
4. **No rate limiter is added or changed.** `cookbookLimiter` (`cookbookRoutes.js` lines 22-30)
   and `mealPlanLimiter` (`mealPlanRoutes.js` lines 27-35) keep their configuration exactly; only
   their position in these two chains moves one slot to the right.
5. **Rejection response shape is unchanged.** `csrf-csrf` calls `next()` with an `http-errors`
   403 carrying `code: "EBADCSRFTOKEN"`, and `src/middleware/errorHandler.js` renders the error
   page with that status — identical to `/recipes/:id/delete` and every other CSRF failure. No
   custom flash-and-redirect.
6. **Handlers are not extracted or refactored.** As with REW-101, the HTTP tests swap the terminal
   handler for a spy and reuse the *real* middleware slice from the router's stack, so no
   injectable handler is needed. Optional follow-up, not part of a security diff.
7. **The `/:id/visibility` routes in both files are not touched.** The audit classifies them as
   "incidental" (they read `req.body` before mutating) and REW-99's domain, and their existing
   tests assert a stack length of exactly 3 (`cookbookVisibilityRoutes.test.js` lines 201-205,
   `mealPlanVisibilityRoutes.test.js` lines 215-219). Adding `csrfProtection` there would be scope
   creep and would break those tests.
8. **`SameSite=Lax` is not a control.** Same reasoning as REW-101 assumption 4: defense in depth,
   not the deterministic check. The route-level `csrfProtection` is the control.

None of these block implementation. Proceed on the stated assumptions and flag if any turns out
wrong.

## Tasks

Ordered so each step leaves the suite green. Ownership is marked so the pipeline can hand off
cleanly: **[Dev]** Developer agent, **[Docs]** Documentation agent, **[Rev]** Reviewer, **[QA]** QA.

1. **[Dev] `src/routes/cookbookRoutes.js` — import.** Add a named import of `csrfProtection` from
   `../middleware/csrfMiddleware.js` alongside the existing middleware import on line 3. The file
   does not import anything from `csrfMiddleware.js` today.
2. **[Dev] `src/routes/cookbookRoutes.js` — chain.** On line 355 change the registration from
   `requireAuth, cookbookLimiter, handler` to `requireAuth, csrfProtection, cookbookLimiter, handler`
   (the ticket's own snippet). Do not change the handler body, the `UUID_PATTERN` guard
   (lines 359-362), the ownership filter (lines 366-370), the flash copy or the redirects.
3. **[Dev] `src/routes/cookbookRoutes.js` — comment.** Expand the one-line comment on line 354.
   Say that `csrfProtection` is re-applied at route level because the global wrapper skips
   multipart bodies and this handler reads no body fields; reference REW-105; note the form in
   `views/cookbooks/view.ejs` posts urlencoded with `_csrf` so this is transparent to it; state the
   ordering rule (CSRF runs **before** `cookbookLimiter` so a forged request cannot burn the
   victim's quota, enforced by `cookbookDeleteRoutes.test.js`); and say "do not add a Multer /
   body-parsing stage here". Point at the fuller comment on `POST /recipes/:id/delete`
   (`recipeRoutes.js` lines 971-983) rather than duplicating it.
4. **[Dev] `src/routes/mealPlanRoutes.js` — same three edits.** Import next to line 3; chain on
   line 420 becomes `requireAuth, csrfProtection, mealPlanLimiter, handler`; expand the comment on
   line 419 the same way, naming `views/meal-plans/view.ejs` and `mealPlanDeleteRoutes.test.js`.
   Guard (lines 424-427), ownership filter (lines 431-435), flash and redirects unchanged.
5. **[Dev] Write `src/routes/cookbookDeleteRoutes.test.js`** — see "Test plan".
6. **[Dev] Write `src/routes/mealPlanDeleteRoutes.test.js`** — same design, meal-plan router and
   path.
7. **[Dev] Run `npm test`.** Full suite green on Linux; on Windows the only permitted failures are
   the two pre-existing `EACCES` cases in `src/csrf.integration.test.js` (REW-90 / REW-98). Run the
   regression sweep listed under "Test plan" explicitly. Watch the output for any
   `express-rate-limit` `ERR_ERL_*` validation warning from the harness (none is expected — the
   limiters key on `req.user.id`, not IP); if one appears, report it rather than changing the
   limiter config, which is out of scope.
8. **[Docs] Update the documentation** listed under "Affected files → Documentation", update the
   Confluence plan page to as-shipped, and update the REW-105 row in the Bug Fixes index. Produce
   `docs/RELEASE_NOTES_REW-105.md` / `docs/confluence/JIRA_COMMENT_REW-105.md` if the pipeline's
   convention calls for them (REW-101 produced both).
9. **[Rev] Diff review.** Confirm the code diff is exactly: two import lines, two signature lines,
   two comment expansions, two new test files. Confirm no change to `src/middleware/csrfMiddleware.js`,
   `src/app.js`, either handler body, either ownership filter, either `/:id/visibility` route,
   any view, `package.json`, or `database/migrations/`. Confirm no Multer / `.none()` stage and no
   new or reconfigured limiter.
10. **[QA] Manual pass** per "Test plan → Manual / QA pass".
11. **[Dev/Rev] Jira.** Transition REW-105 per the pipeline's convention, and transition REW-101
    to Done (it is merged). The planner has read-only Jira access.

## Affected files

### Changed (code — Developer)

- `src/routes/cookbookRoutes.js` — new `csrfProtection` import (near line 3); line 355 chain gains
  `csrfProtection` between `requireAuth` and `cookbookLimiter`; line 354 comment expanded.
  **Nothing else in this file changes.**
- `src/routes/mealPlanRoutes.js` — new `csrfProtection` import (near line 3); line 420 chain gains
  `csrfProtection` between `requireAuth` and `mealPlanLimiter`; line 419 comment expanded.
  **Nothing else in this file changes.**

### New (tests — Developer)

- `src/routes/cookbookDeleteRoutes.test.js`
- `src/routes/mealPlanDeleteRoutes.test.js`

### Changed (documentation — Documentation agent)

- `docs/api/README.md`
  - Line 77 (`POST /cookbooks/:id/delete` row) and line 119 (`POST /meal-plans/:id/delete` row):
    note each is a urlencoded form post behind `requireAuth`, route-level `csrfProtection`, and
    the per-user limiter, in that order (REW-105), matching the wording of the recipe row on
    line 33.
  - Line 317, "CSRF Protection" paragraph: add both routes to the list of routes that re-apply
    `csrfProtection`. The sentence "On every one of these except `POST /recipes/:id/clone`, CSRF
    runs *before* the route's rate limiter" remains true. The trailing "REW-101 is branch-only …
    not pushed or merged" sentence is stale (PR #62 merged) — correct it while there.
  - Line 328, audit list (b): add both routes "— since REW-105".
  - Lines 335-336, audit table (c): change both rows to "**Fixed in REW-105** (chain is now
    requireAuth → csrfProtection → limiter → handler)".
  - Line 337, the `POST /meal-plans/:id/recipes/:recipeId/remove` row: "REW-105 or REW-99" →
    "REW-99" (Open questions, item 1).
  - Line 348, "Follow-ups" paragraph: REW-105 is done; the remaining items are REW-99's.
- `docs/api/cookbooks.md`
  - Lines 82-84, the `POST /cookbooks/:id/delete` section: add a **Middleware** line —
    `requireAuth`, then route-level `csrfProtection` (re-applied because the global wrapper skips
    multipart bodies and this handler reads no body — REW-105), then the existing
    `cookbookLimiter`. Mirror the phrasing already used on line 60 for the visibility route.
  - Line 276, Security "CSRF" bullet: add that the delete route additionally re-applies
    `csrfProtection` at the route level, ahead of the limiter, and why.
  - Changelog table (around line 328): dated REW-105 row.
- `docs/api/meal-plans.md`
  - Lines 103-105, the `POST /meal-plans/:id/delete` section: same Middleware line, naming
    `mealPlanLimiter` (mirror line 81).
  - Line 261, Security "CSRF" bullet: same addition.
  - Changelog table (around line 349): dated REW-105 row.
- `README.md` line 336 (security bullet): add both routes to the route-level list, replace "the
  two remaining destructive routes … are tracked as REW-105" with the fixed state, and correct the
  stale "REW-101, on branch — … not pushed or merged" parenthetical.
- `docs/plans/rew-105-cookbook-meal-plan-delete-csrf-protection.md` — this plan.
- Confluence: the REW-105 plan page (as-shipped update) and its row in the *Bug Fixes* index.

### Read / verify only (no edits)

- `src/middleware/csrfMiddleware.js` — **must not change.** `csrfProtection` is exported on
  line 12; `csrfProtectionExceptMultipart` (lines 13-16) is REW-99's. The test's identity check
  (`handles.indexOf(csrfProtection)`) depends on the route files importing this exact export.
- `src/app.js` — **must not change.** Lines 50, 53, 54 (cookie-parser, json, urlencoded) and 85
  (the global wrapper) are the order the test harness mirrors.
- `src/routes/recipeRoutes.js` lines 971-984 — the merged REW-101 pattern and comment to copy.
- `src/routes/recipeDeleteRoutes.test.js` — the reference test (317 lines); see "Test plan" for
  the exact deltas.
- `src/routes/index.js` lines 167 and 170 — mount points `/cookbooks` and `/meal-plans` (the
  harness paths).
- `src/middleware/errorHandler.js` — maps `err.status` to the response; how the 403 reaches the
  browser. No change.
- `views/cookbooks/view.ejs` lines 36-39 and `views/meal-plans/view.ejs` lines 42-45 — the two
  delete forms. Each is `method="POST"` with no `enctype` (so urlencoded), a hidden `_csrf`, and
  a `confirm()` dialog. Verify; do not edit.
- `src/routes/cookbookVisibilityRoutes.test.js` lines 190-206 and
  `src/routes/mealPlanVisibilityRoutes.test.js` lines 204-220 — assert the **visibility** routes'
  stack length is 3. Unaffected by this change as long as assumption 7 holds.
- `src/routes/cookbookRoutes.test.js`, `src/routes/mealPlanRoutes.test.js` — import exported
  handlers only; unaffected.
- `src/views/cookbookSharing.test.js` line 95, `src/views/mealPlanSharing.test.js` line 117 —
  assert the owner views still carry `_csrf`; unaffected (no view change).
- `package.json` — no change. `express ^5`, `csrf-csrf ^3.0.6`, `cookie-parser ^1.4.6`,
  `express-rate-limit ^8.6.0` already present; the tests need nothing new.

## Database changes

**None.** No migration, no table or column change, no RLS implication. The ownership scoping in
both handlers and the owner-only RLS DELETE policies on `cookbooks` and `meal_plans` (with cascade
to `cookbook_recipes` / `meal_plan_recipes`) are untouched — CSRF protection is a
request-authenticity check that sits in front of them, not a replacement for them. Nothing is
written to `database/migrations/`.

## Security considerations

- **This ticket *is* the security fix.** It strengthens the boundary; nothing is weakened. The
  Reviewer's job is to confirm the diff is as small as described in task 9.
- **Middleware order: `requireAuth` → `csrfProtection` → limiter → handler.** Auth first, as on
  every sibling route, so an anonymous forged request is bounced to `/auth/login` without touching
  CSRF. CSRF second, so an authenticated victim's forged request is rejected **before** it reaches
  the limiter (no quota burned — the limiters are keyed on `req.user.id`, so a burst of forged
  requests would otherwise lock the victim out of every cookbook / meal-plan mutation for a
  minute) and before the handler. The chain tests pin the limiter's position **unconditionally**,
  unlike the recipe test where the limiter check is conditional because none exists.
- **Do not touch the global wrapper.** `csrfProtectionExceptMultipart` and `app.js` line 85 stay
  exactly as they are. REW-99 is the systemic fix and is explicitly out of scope.
- **Do not add a body-parsing stage to either route.** No Multer, no `.none()`. Both routes must
  keep rejecting multipart bodies outright, even ones that carry a valid `_csrf` part; a test pins
  this.
- **Do not touch the `/:id/visibility` routes** in either file (assumption 7).
- **Ownership enforcement is unchanged and still required.** `.eq("user_id", req.user.id)` plus
  RLS remain the authorization control; CSRF is orthogonal and does not replace either. The
  `UUID_PATTERN` guard inside each handler is also unchanged.
- **No information leak on rejection.** The 403 goes through `errorHandler`, which shows a generic
  message in production. Neither cookbook nor meal-plan existence is revealed.
- **Why these routes are exploitable when their siblings are not.** Express 5 leaves `req.body`
  undefined when no body parser matched. The create / update / visibility / add-recipes siblings
  read `req.body` before mutating and throw a `TypeError` on the forged request — an accident of
  the body parser, not a control, which is why the audit does not treat them as protected and why
  REW-99 still matters. The two delete handlers never read `req.body`, so the forged request
  completes today.
- **Forms are untouched.** Both delete forms already carry `_csrf` and post urlencoded; the
  sharing view tests keep asserting the token is present.
- **The test harness must not create a false sense of security.** It re-mounts the router's real
  middleware slice and includes a control case proving that, with only the limiter in place, the
  same multipart request reaches the handler. Without that control a harness that rejected
  multipart for some unrelated reason would make the rejection tests pass vacuously.
- **Harness portability.** Listen on `127.0.0.1` port `0`, never a `/tmp` unix socket
  (REW-90 / REW-98). Skip, don't fail, if the sandbox forbids listeners (`EPERM` / `EACCES`).

## Test plan

Node's built-in runner; everything runs via `npm test` (`node --test`). Tests are co-located
`*.test.js` beside the code, per repo convention. `node --test` runs each file in its own process,
so the two limiter singletons never see each other's traffic.

### `src/routes/cookbookDeleteRoutes.test.js` (new) and `src/routes/mealPlanDeleteRoutes.test.js` (new)

Copy `src/routes/recipeDeleteRoutes.test.js` and apply these deltas. Everything not listed here
stays as it is in the reference file (env stubs before the dynamic import, `findDeleteLayer`,
`isRateLimiter` duck-typing on `resetKey` / `getKey`, `withServer` on `127.0.0.1:0` with the
`EPERM` / `EACCES` skip, `request`, `csrfSession`, `multipartBody`, the `EBADCSRFTOKEN` → 403
error middleware).

- Header comment: REW-105, and name the route.
- Dynamic import of `./cookbookRoutes.js` (default export) / `./mealPlanRoutes.js` (default
  export). Both files set `SUPABASE_URL` / `SUPABASE_ANON_KEY` the same way the existing
  `cookbookRoutes.test.js` / `mealPlanRoutes.test.js` do, before the import.
- Fixture id: a fixed valid UUID (the handlers' `UUID_PATTERN` guard never runs, because the spy
  replaces the handler, but keep the path realistic). `DELETE_PATH` is `/cookbooks/<id>/delete` /
  `/meal-plans/<id>/delete`; the harness mounts the route at that literal path with `:id`.
- Boundary string: something route-specific (e.g. `rew105boundary`).

**Test 1 — chain shape (no HTTP).** Tighter than the recipe test because a limiter is present:

- the `/:id/delete` POST layer exists and is POST-only (`methods.get` undefined);
- `handles.length === 4`;
- `handles[0].name === "requireAuth"`;
- `handles.indexOf(csrfProtection) === 1` — the **exact** export from `csrfMiddleware.js`, directly
  after auth;
- `handles.findIndex(isRateLimiter) === 2` — **unconditional** (the recipe test's `if (limiterIndex > -1)`
  guard becomes a hard assertion), with a message saying CSRF must run before the limiter so a
  forged request cannot burn the victim's quota;
- index 3 is the terminal handler (neither `csrfProtection` nor a limiter).

**HTTP harness.** `buildHarness({ withRouteCsrf = true } = {})` as in the reference: cookie-parser,
json, urlencoded, then `csrfProtectionExceptMultipart` (mirrors `app.js` 50 / 53 / 54 / 85);
`GET /token` issuing `generateCsrfToken`; then the delete route as `stubAuth` (sets
`req.user = { id: "owner-1" }` and `req.accessToken`) → slice → spy (`204`, records `req.params.id`).

- With `withRouteCsrf: true` the slice is the router's real `handles.slice(1, -1)`, which after the
  fix is `[csrfProtection, <limiter>]`. Keep the guard that the slice includes `csrfProtection`;
  add a guard that it includes a limiter (`some(isRateLimiter)`), so the harness can never mount a
  slice that silently lost the limiter either.
- With `withRouteCsrf: false` (the control) the slice is the same real slice **with
  `csrfProtection` filtered out** — i.e. the pre-fix chain, limiter included (assumption 3).
- `stubAuth` must run before the slice because both limiters key on `req.user?.id`.

**Tests 2-7 — HTTP-level.** Same seven-case shape as the reference, each asserting status **and**
spy call count:

2. Forged multipart POST, no token, **with** the victim's csrf cookie → 403, spy not called. Repeat
   **without** any cookie → 403, spy not called.
3. **Control:** `buildHarness({ withRouteCsrf: false })`, same forged multipart POST → 204, spy
   called once. Keep the assertion message explicit that this is expected to succeed and proves
   the limiter-only chain lets the request through, so nobody "fixes" it.
4. Urlencoded, no `_csrf`, cookie attached → 403, spy not called.
5. Urlencoded, invalid `_csrf`: (i) real token with one character altered; (ii) a token issued for
   a **second** session sent with the **first** session's cookie → 403 both, spy not called.
6. Urlencoded, valid `_csrf` + cookie → 204, spy called once, recorded `params.id` equals the
   fixture id.
7. Multipart carrying a valid `_csrf` part, cookie attached → 403, spy not called (no Multer stage
   on the route; pins that one cannot be added silently).

**Test 8 — forged requests do not burn the victim's limiter quota (recommended).** This is the
property that justifies the ordering, and it is cheap to pin at the HTTP level:

- `buildHarness()` (real slice), one `csrfSession`;
- send a valid urlencoded request → 204; read the `ratelimit-remaining` response header
  (`express-rate-limit` 8.x with `standardHeaders: true` emits draft-6 `RateLimit-Limit` /
  `RateLimit-Remaining` / `RateLimit-Reset`; `legacyHeaders: false` means no `X-RateLimit-*`) and
  parse it as `r1`;
- send three forged multipart requests with no token → all 403, spy still at 1;
- send a second valid urlencoded request (csrf-csrf tokens are reusable within a session, so the
  same token and cookie work) → 204; read `ratelimit-remaining` as `r2`;
- assert `r2 === r1 - 1`, i.e. the three forged requests consumed nothing.

Use relative deltas rather than absolute numbers: the limiter is a module-level singleton whose
in-memory store persists across tests in the file, so `r1` depends on how many valid and control
requests ran earlier. The 60-second window makes the delta deterministic in practice.

Optional, not required: a case sending the token in the `x-csrf-token` header with an empty
urlencoded body → 204, documenting the fetch-wrapper path. Skip it if it adds noise (REW-101
skipped it).

### Regression sweep

`npm test` must be green. Pay particular attention to:

- `src/routes/cookbookVisibilityRoutes.test.js` and `src/routes/mealPlanVisibilityRoutes.test.js`
  — the visibility routes' stack length must still be exactly 3 (proves the change did not leak
  into the neighbouring route);
- `src/routes/cookbookRoutes.test.js`, `src/routes/mealPlanRoutes.test.js` (handler-level, same
  modules);
- `src/routes/recipeDeleteRoutes.test.js` (the reference; unchanged);
- `src/views/cookbookSharing.test.js`, `src/views/mealPlanSharing.test.js` (`_csrf` still in the
  owner views);
- `src/routes/cookbookApiRoutes.test.js` (sibling router with the same CSRF-before-limiter shape);
- `src/csrf.integration.test.js` on a Linux runner (cannot run on Windows — REW-90 / REW-98 — and
  this change does not modify it).

### Manual / QA pass (browser + curl)

1. Logged in as the owner, open `/cookbooks/:id` for a cookbook that contains at least one recipe
   and click **Delete Cookbook**. Expect the confirm dialog, then the flash "Cookbook deleted. Its
   recipes were not affected." and a redirect to `/cookbooks`. Open `/recipes` and confirm the
   recipes that were in it still exist.
2. Same on `/meal-plans/:id` with **Delete Meal Plan**. Expect "Meal plan deleted. Its recipes were
   not affected." and a redirect to `/meal-plans`; the recipes still exist.
3. With the browser's session cookies copied into curl, POST to `/cookbooks/<id>/delete` with
   `-F ignored=1` (multipart) and no `_csrf`. Expect the 403 error page; reload `/cookbooks/<id>`
   and confirm the cookbook still exists. Repeat for `/meal-plans/<id>/delete`.
4. Same, urlencoded (`-d ignored=1`) with no token, and with a garbage `_csrf`. Expect 403 both
   times, both routes; nothing deleted.
5. Same, urlencoded with the real `_csrf` value taken from the rendered form. Expect the delete to
   succeed — curl-level parity with the browser form.
6. Rate-limit interaction: after step 3's rejected requests, an immediate legitimate delete from
   the browser still works (the forged requests did not consume the user's 30-per-minute quota).

## Acceptance criteria

Mapped from REW-105's five acceptance criteria, plus the diff-hygiene criteria the pipeline uses.

- [ ] `src/routes/cookbookRoutes.js` registers `POST /:id/delete` as exactly four handles:
      `requireAuth` → `csrfProtection` → `cookbookLimiter` → handler, where `csrfProtection` is the
      exact export from `src/middleware/csrfMiddleware.js` (`handles.indexOf(csrfProtection) === 1`)
      and the `express-rate-limit` instance is at index 2. The route is POST-only. (REW-105 AC 1.)
- [ ] `src/routes/mealPlanRoutes.js` registers `POST /:id/delete` the same way with
      `mealPlanLimiter`. (REW-105 AC 1.)
- [ ] For **each** route, a `multipart/form-data` POST with no CSRF token is rejected with 403
      **before** the handler runs, both with the victim's `csrf-token` cookie attached and with no
      cookie at all. (REW-105 AC 2.)
- [ ] For each route, a urlencoded POST with a **missing** `_csrf` is rejected with 403 before the
      handler runs.
- [ ] For each route, a urlencoded POST with an **invalid** `_csrf` — a tampered token, and a token
      issued for a different session's cookie — is rejected with 403 before the handler runs.
- [ ] For each route, a urlencoded POST with a valid `_csrf` and matching cookie reaches the handler
      exactly once with the expected `req.params.id`.
- [ ] For each route, a multipart POST that carries a valid `_csrf` part is still rejected with 403
      (no Multer stage on the route).
- [ ] For each route, the control case proves the same forged multipart POST **does** reach the
      handler when only the limiter is mounted (the pre-fix chain), so the rejection assertions are
      not vacuous.
- [ ] Forged requests do not consume limiter quota: after a valid request and three rejected forged
      requests, the next valid request's `RateLimit-Remaining` is exactly one lower than the first
      valid request's.
- [ ] Both new test files listen on a `127.0.0.1` ephemeral TCP port (no `/tmp` unix socket), skip
      rather than fail where listeners are forbidden, and pass on Windows. (REW-105 AC 4.)
- [ ] Existing tests still pass, in particular `cookbookVisibilityRoutes.test.js` and
      `mealPlanVisibilityRoutes.test.js` (visibility stack length still 3).
- [ ] Manual: deleting a cookbook from `/cookbooks/:id` and a meal plan from `/meal-plans/:id` still
      works through the existing forms — confirm dialog, the "… deleted. Its recipes were not
      affected." flash, redirect to the index — and the recipes they contained still exist.
      (REW-105 AC 3.)
- [ ] Manual/curl: an authenticated multipart POST without a token to either route returns the 403
      error page and the cookbook / meal plan still exists afterwards.
- [ ] Diff review confirms the code change is limited to: one import line and one signature line
      and one comment block in each of `cookbookRoutes.js` and `mealPlanRoutes.js`, plus the two new
      test files. **No** change to `src/middleware/csrfMiddleware.js`, `src/app.js`, either handler
      body, either `UUID_PATTERN` guard or ownership filter, either `/:id/visibility` route, any
      view or form, `package.json`, or `database/migrations/`; no Multer / `.none()` stage; no new
      or reconfigured rate limiter.
- [ ] `docs/api/README.md` (endpoint rows 77 and 119; CSRF Protection paragraph; audit list (b);
      audit table (c) rows for both routes and the meal-plan `remove` row; Follow-ups paragraph),
      `docs/api/cookbooks.md` (delete route section, Security CSRF bullet, changelog),
      `docs/api/meal-plans.md` (same), and `README.md` (security bullet) are updated.
      (REW-105 AC 5.)
- [ ] The Confluence plan page has been updated to as-shipped and the REW-105 row in the Bug Fixes
      index reflects the outcome.
- [ ] `npm test` passes in full on a Linux runner; on Windows the only failures are the
      pre-existing REW-90 / REW-98 cases in `src/csrf.integration.test.js`.

## Notes for the Developer

- REW-105 is `To Do` and assigned. No new ticket is needed for this change. One ticket-hygiene item
  is flagged above: REW-101 is merged but still *In Progress* in Jira.
- The Jira description's two snippets
  (`router.post("/:id/delete", requireAuth, csrfProtection, cookbookLimiter, handler)` and the
  `mealPlanLimiter` twin) plus one import line per file are the entire code change. Resist
  refactoring the handlers while you are there (assumption 6), and do not touch the visibility
  routes (assumption 7).
- The reference test to copy is on this branch already (`src/routes/recipeDeleteRoutes.test.js`,
  merged via REW-101). The only structural differences are the unconditional limiter-position
  assertion, the limiter-only control chain, and the optional quota test (Test 8).
- The Jira ticket text was treated as data. It contained no instructions outside the technical
  scope of this change.
