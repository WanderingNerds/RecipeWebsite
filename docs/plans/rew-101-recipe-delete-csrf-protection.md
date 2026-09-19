# REW-101: Route-level CSRF protection on POST /recipes/:id/delete (multipart bypass)

## Jira issue

[REW-101 — POST /recipes/:id/delete is missing route-level csrfProtection (multipart bypass)](https://wanderingnerds.atlassian.net/browse/REW-101)
Bug · Priority High · status **To Do** · relates to [REW-87](https://wanderingnerds.atlassian.net/browse/REW-87) (Done).
Branch: `REW-101-recipe-delete-csrf-protection` (from a clean `main` at `8f6eb30`).

**Also closed by this change (near-duplicate):**
[REW-102 — Add route-level csrfProtection to POST /recipes/:id/delete](https://wanderingnerds.atlassian.net/browse/REW-102)
Task · High · To Do · labels `csrf` / `security` / `tech-debt` · relates to REW-88. Filed later the
same day for the same defect. Its acceptance criteria are slightly broader than REW-101's — the
rejection must cover a missing **or invalid** token, the Cookbook page is a third delete surface
(REW-88), and every `router.post` in `src/routes/` must be audited — and they are folded into this
plan so one change satisfies both tickets. Developer/Reviewer should reference both keys in the
commit and PR, and flag one of the two for closure as a duplicate of the other. The planner does
not transition tickets.

Related, **not** in scope:

- [REW-99 — csrfProtectionExceptMultipart exempts every multipart POST, not just multer routes](https://wanderingnerds.atlassian.net/browse/REW-99)
  (Bug, High, To Do). The central fix to the global wrapper. **Do not touch
  `src/middleware/csrfMiddleware.js` or the global wiring in `src/app.js` here.** This ticket is
  the route-level mitigation in the meantime.
- [REW-90](https://wanderingnerds.atlassian.net/browse/REW-90) /
  [REW-98](https://wanderingnerds.atlassian.net/browse/REW-98) — `src/csrf.integration.test.js`
  binds `/tmp/*.sock` unix sockets and fails with `EACCES` on Windows. Relevant only because the
  new test must **not** repeat that harness choice.

## Confluence page

[REW-101: Route-Level CSRF Protection on Recipe Delete - Bug Fix Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/33456129/REW-101+Route-Level+CSRF+Protection+on+Recipe+Delete+-+Bug+Fix+Plan)
(created under *Bug Fixes*, matching the convention for Bug-type tickets; also indexed in the
Bug Fixes table.) The full audit table below is reproduced there so the Documentation agent can
carry it forward.

## Summary

`src/app.js` line 85 mounts `csrfProtectionExceptMultipart` globally. That wrapper
(`src/middleware/csrfMiddleware.js` lines 13-16) deliberately returns `next()` for any
`multipart/form-data` body, because `csrf-csrf` reads the token from `req.body._csrf` and that
field does not exist until Multer has parsed the body. The three genuine upload routes compensate
by running `csrfProtection` *after* Multer; the non-multipart siblings `POST /recipes/:id/clone`
(line 607) and `POST /recipes/:id/visibility` (line 967, with the explanatory comment at
958-966) — and every `/api/cookbooks*` mutation — compensate by re-applying `csrfProtection` at
the route level.

`POST /recipes/:id/delete` (`src/routes/recipeRoutes.js` line 972) never got either treatment.
Its chain is `requireAuth` → handler, full stop. The handler reads **no body fields** — only
`req.params.id`, `req.user.id` and `req.accessToken` — so a forged cross-site
`multipart/form-data` POST from an attacker's page reaches the handler with `req.body` undefined
and runs the delete. Ownership scoping (`.eq("id", id).eq("user_id", req.user.id)` on top of the
owner-only RLS DELETE policy) means an attacker can only make the **victim** delete the victim's
**own** recipe — no cross-account deletion — but that is precisely the CSRF scenario, and a
destructive one. The route is now reachable from five UI surfaces: the recipe detail page
(`views/recipes/view.ejs`), My Recipes (REW-86), My Favorites (REW-87), the Cookbook page
(REW-88) and the Meal Plan page (REW-89), the last four through the shared
`views/partials/recipe-summary-card.ejs`.

The fix is a one-line middleware change that copies the `/:id/visibility` precedent exactly:
`router.post("/:id/delete", requireAuth, csrfProtection, handler)`. `csrfProtection` is already
imported at line 10. All five delete forms already post `application/x-www-form-urlencoded` with a
hidden `_csrf`, so legitimate submissions are unaffected. A new route-level test proves the
multipart bypass no longer reaches the handler (and that missing/invalid urlencoded tokens are
rejected too), and the audit the ticket asks for is recorded below — it found two more destructive
routes with the identical gap, which are flagged for a follow-up ticket rather than folded into
this diff.

## Open questions / assumptions

1. **No rate limiter is added.** REW-101 says "order `csrfProtection` before any rate limiter, as
   `/:id/visibility` does" and REW-102's comment gives the pattern
   `requireAuth → csrfProtection → limiter → handler`. Both are conditional on a limiter existing;
   this route has none today, and adding one is scope creep on a security fix (the visibility
   route got one because a toggle is churnable; a delete is not). In production the general
   limiter in `app.js` still applies.
   *Assumption:* the chain becomes exactly `requireAuth → csrfProtection → handler`. If a limiter
   is ever added it **must** go after `csrfProtection`; the new chain test enforces that ordering
   whenever a limiter is present, and passes when none is.
2. **Rejection response shape is unchanged from every other CSRF failure.** `csrf-csrf` calls
   `next()` with an `http-errors` 403 carrying `code: "EBADCSRFTOKEN"`; `src/middleware/errorHandler.js`
   reads `err.status` and renders the error page with 403 (the same path
   `src/csrf.integration.test.js` line 34 already asserts for the app). No custom flash-and-redirect
   is added for this route — that would diverge from `/:id/visibility` and `/:id/clone`, and a
   real user only ever hits it from a stale tab.
3. **The handler is not extracted or refactored.** Extracting an injectable
   `handleRecipeDelete` (as `handleRecipeVisibilityUpdate` and `handleRecipeClone` were) would be
   nice for unit tests but is not needed to prove the CSRF property, and it would grow a one-line
   security diff. The HTTP test below replaces the terminal handler with a spy and reuses the
   *real* middleware between `requireAuth` and the handler, taken from the router's own stack.
   Optional follow-up.
4. **`SameSite=Lax` is not a control.** `setAuthCookies` in `src/utils/authUtils.js` sets both
   Supabase cookies `sameSite: "lax"`, so in current browsers a cross-site top-level POST usually
   does not carry the session and `requireAuth` bounces it to login. That is defense in depth
   (older user agents, same-site sibling origins, future cookie-policy changes), exactly as
   REW-99 notes. The route-level check is the deterministic control and the ticket stands.
5. **Multipart is rejected even when it carries a valid token.** Nothing on this route parses a
   multipart body (no Multer stage), so a `_csrf` part inside one is invisible to `csrf-csrf`
   and the request is rejected. That is correct — all five delete forms are urlencoded — and the
   test pins it so a Multer stage cannot be added to this route silently later.
6. **Audit scope.** Every `router.post` / `router.put` / `router.patch` / `router.delete` in
   `src/routes/` (there are no `put`/`patch` routes, and no `app.*` mutating routes outside the
   routers). Only `/recipes/:id/delete` is fixed in this change; everything else found is a
   follow-up recommendation (see the audit section).

None of these block implementation. Proceed on the stated assumptions and flag if any turns out
wrong.

## Tasks

Ordered so each step leaves the suite green.

1. **Add `csrfProtection` to the route.** In `src/routes/recipeRoutes.js` line 972, change the
   chain from `requireAuth, async (req, res) => {...}` to
   `requireAuth, csrfProtection, async (req, res) => {...}`. `csrfProtection` is already imported
   at line 10 — no new import. Do not change the handler body, the ownership filter, the flash
   copy or the redirects.
2. **Expand the route comment** (currently the single line at 971, `// POST /recipes/:id/delete - Delete a recipe`).
   Say why `csrfProtection` is re-applied at route level (the global wrapper skips multipart
   bodies), reference REW-101 and REW-102, note that all five delete forms post urlencoded with a
   hidden `_csrf` so this is transparent to them, and state the ordering rule — any future
   limiter goes **after** `csrfProtection` so a forged request cannot burn the victim's quota.
   Point at the `/:id/visibility` comment above rather than duplicating its full paragraph.
3. **Write the tests** in a new co-located file `src/routes/recipeDeleteRoutes.test.js` — see
   "Test plan". Name follows `recipeCloneRoutes.test.js` / `recipeVisibilityToggle.test.js`.
4. **Update the docs that describe this route and the CSRF posture.**
   - `docs/api/README.md` line 33: the `POST /recipes/:id/delete` row — note it is a urlencoded
     form post behind `requireAuth` and route-level `csrfProtection` (REW-101).
   - `docs/api/README.md` "CSRF Protection" section (line 305 onward): add
     `POST /recipes/:id/delete` to the list of routes that re-apply `csrfProtection`, and add a
     short "Route-level CSRF audit (REW-101)" subsection carrying the class (c) table below (or a
     condensed version of it), so the audit note lives somewhere a reader of the API docs will
     find it, not only in a plan file.
   - `README.md` line 336: add `POST /recipes/:id/delete` to the same list in the security
     bullet.
   - `docs/api/cookbook-card.md` "Security" section (lines 159-162) and the equivalent lines in
     `docs/api/my-recipes-card.md` / `docs/api/meal-plan-card.md` if they describe the delete
     route's enforcement: optional one-clause addition that the route is now route-level
     CSRF-protected. Do not rewrite these pages.
5. **Record the audit note in Jira.** The Developer (or Reviewer) posts a comment on REW-101
   summarising the audit outcome — the two equal-severity destructive routes, the bodiless
   non-destructive ones, and that the rest are REW-99's domain — and cross-references REW-102.
   The planner has read-only Jira access and cannot post it.
6. **Flag the follow-up ticket** for `POST /cookbooks/:id/delete` and `POST /meal-plans/:id/delete`
   (details under "Follow-ups"). The Developer creates it; do not fold those routes into this
   diff.
7. **Run `npm test`** and confirm the suite is green. On Windows the only failures allowed are the
   two pre-existing `EACCES` cases in `src/csrf.integration.test.js` (REW-90 / REW-98); the new
   test must not add to them. Re-run the precedents specifically:
   `src/routes/recipeVisibilityToggle.test.js`, `src/routes/recipeCloneRoutes.test.js`
   (asserts the clone route's stack length is exactly 4 — unaffected),
   `src/routes/cookbookApiRoutes.test.js`, and `src/views/recipeCard.test.js` (counts `_csrf`
   tokens in the card's delete forms).

## Affected files

### Changed

- `src/routes/recipeRoutes.js` — line 972: insert `csrfProtection` between `requireAuth` and the
  handler. Line 971: expand the comment. **Nothing else in this file changes.**
- `docs/api/README.md` — the delete endpoint row (line 33), the CSRF Protection section (line
  305 onward): route list plus the new audit subsection.
- `README.md` — the security bullet at line 336 (route list).
- `docs/api/cookbook-card.md` (optional, lines 159-162) — one clause, see task 4.
- `docs/plans/rew-101-recipe-delete-csrf-protection.md` — this plan.

### New

- `src/routes/recipeDeleteRoutes.test.js` — the route-level tests.

### Read / verify only (no edits)

- `src/middleware/csrfMiddleware.js` — **must not change.** The `getTokenFromRequest` at line 7
  (`req.body?._csrf || req.headers["x-csrf-token"]`) is why an unparsed multipart body yields no
  token and why the route-level check rejects it. REW-99 owns any change here.
- `src/app.js` — **must not change.** Lines 50-54 (cookie-parser, json, urlencoded) and 85 (the
  global wrapper) are the order the test harness mirrors.
- `src/middleware/errorHandler.js` — maps `err.status` to the response status; this is how the
  403 reaches the browser. No change.
- `views/recipes/view.ejs` lines 61-64 and `views/partials/recipe-summary-card.ejs` lines
  234-237 (my-recipes), 287-290 (favorites), 355-358 (cookbook), 410-413 (meal-plan) — the five
  delete forms. Each is `method="POST"` with no `enctype` (so urlencoded) and a hidden `_csrf`.
  Verify; do not edit.
- `src/routes/recipeVisibilityToggle.test.js` lines 281-322 and
  `src/routes/cookbookApiRoutes.test.js` lines 125-169 — the chain-shape test to copy.
- `src/csrf.integration.test.js` lines 44-57 — the multipart-over-HTTP technique to copy
  (boundary body, `EBADCSRFTOKEN` → 403 error middleware). **Copy the technique, not the
  `/tmp/*.sock` listener.**
- `src/utils/authUtils.js` lines 10-23 — `sameSite: "lax"` on both auth cookies (assumption 4).
- `package.json` — no change. Node `>=18`, `express ^5`, `csrf-csrf ^3.0.6`, `cookie-parser`
  already present; the test needs nothing new.

## Database changes

**None.** No migration, no table or column change, no RLS implication. The delete's ownership
scoping and the owner-only RLS DELETE policy on `recipes` are untouched — CSRF protection is a
request-authenticity check that sits in front of them, not a replacement for them. Nothing is
written to `database/migrations/`.

## Security considerations

- **This ticket *is* the security fix.** It strengthens the boundary; nothing is weakened. The
  Reviewer's job is to confirm the diff is as small as described.
- **Middleware order: `requireAuth` → `csrfProtection` → handler.** Auth first matches every
  sibling route and means an anonymous forged request is bounced to `/auth/login` without
  touching CSRF at all; an authenticated victim's forged request is stopped by `csrfProtection`
  before the handler. If a limiter is ever added it goes after `csrfProtection` (assumption 1).
- **Do not touch the global wrapper.** `csrfProtectionExceptMultipart` and `app.js` line 85 stay
  exactly as they are. REW-99 is the systemic fix and is explicitly out of scope.
- **Do not add a body-parsing stage to this route.** No `imageUpload`, no `multer().none()`. The
  route must keep rejecting multipart bodies outright (assumption 5).
- **Ownership enforcement is unchanged and still required.** `.eq("user_id", req.user.id)` plus
  RLS remain the authorization control; CSRF is orthogonal and the fix does not replace either.
- **No information leak on rejection.** The 403 goes through `errorHandler`, which shows a generic
  message in production. No recipe existence is revealed.
- **Why the delete route is exploitable when its siblings are not.** Express 5 leaves `req.body`
  **undefined** when no body parser matched the content type. The delete handler never reads
  `req.body`, so a bodiless forged request completes. Many other routes only *appear* safe
  because they destructure `req.body` inside a `try` before mutating and throw a `TypeError` on
  the forged request — that is an accident of the body parser, not a control, and it is why the
  audit below does not treat those routes as protected.
- **Forms are untouched.** All five delete forms already carry `_csrf` and post urlencoded; the
  existing view tests (`src/views/recipeCard.test.js`) keep asserting the token count.
- **The test harness must not create a false sense of security.** It re-mounts the real
  middleware slice from the router's stack and includes a *control* case proving that, without
  the route-level check, the same multipart request reaches the handler. Without that control, a
  harness that rejected multipart for some unrelated reason would make the rejection test pass
  vacuously.
- **Harness portability.** Listen on `127.0.0.1` port `0`, never a `/tmp` unix socket
  (REW-90 / REW-98). Skip, don't fail, if the sandbox forbids listeners (`EPERM`/`EACCES`), the
  way `csrf.integration.test.js` line 23 does.

## Test plan

Node's built-in runner; everything runs via `npm test` (`node --test`). Tests are co-located
`*.test.js` beside the code, per repo convention.

### `src/routes/recipeDeleteRoutes.test.js` (new)

Set `process.env.SUPABASE_URL ||= ...` and `SUPABASE_ANON_KEY ||= ...` before the dynamic
`import("./recipeRoutes.js")`, exactly as `recipeCloneRoutes.test.js` lines 4-7 do. Import
`csrfProtection`, `csrfProtectionExceptMultipart` and `generateCsrfToken` from
`../middleware/csrfMiddleware.js`. Use `express`, `cookie-parser` and `node:http`. Use a fixed
UUID for `RECIPE_ID`.

**Test 1 — chain shape (no HTTP).** Modeled line-for-line on
`recipeVisibilityToggle.test.js` lines 281-322:

- find the layer in `router.stack` whose `route.path === "/:id/delete"` and `route.methods.post`;
  assert it exists and that `route.methods.get` is undefined (POST-only);
- `handles = layer.route.stack.map((entry) => entry.handle)`;
- assert `handles[0].name === "requireAuth"` (auth runs first);
- assert `handles.indexOf(csrfProtection) === 1` — the **exact** export, not a look-alike, and
  directly after auth;
- assert that index is `< handles.length - 1` (it runs before the terminal handler);
- find any `express-rate-limit` instance by duck-typing (`typeof handle.resetKey === "function"
  && typeof handle.getKey === "function"`); **if one is present**, assert the csrf index is
  smaller than the limiter index, with a message explaining that a forged request must not burn
  the victim's quota. With no limiter present this assertion is simply not reached.

**Tests 2-7 — HTTP-level, through the real middleware slice.** Build a helper
`buildHarness({ withRouteCsrf = true } = {})` that returns an Express app assembled as:

- `cookieParser()`, `express.json()`, `express.urlencoded({ extended: true })`, then
  `csrfProtectionExceptMultipart` — the same order as `app.js` lines 50-54 and 85, so the
  harness reproduces the global wrapper faithfully;
- `GET /token` → responds with `generateCsrfToken(req, res)` (this also sets the `csrf-token`
  cookie), the same trick `csrf.integration.test.js` line 46 uses;
- `POST /recipes/:id/delete` → `stubAuth` (sets `req.user = { id: "owner-1" }` and
  `req.accessToken = "token"`, then `next()`), then — only when `withRouteCsrf` — the real slice
  `handles.slice(1, -1)` taken from the router layer in test 1 (after the fix that slice is
  exactly `[csrfProtection]`), then a spy terminal handler that records `req.params.id` and
  responds `204`. Assert inside the helper that the slice contains `csrfProtection`, so the
  harness can never quietly mount an empty slice;
- an error middleware `(err, _req, res, _next) => res.sendStatus(err.code === "EBADCSRFTOKEN" ? 403 : 500)`
  (copied from `csrf.integration.test.js` line 48).

Drive it with a `withServer(app, run, t)` helper that calls `server.listen(0, "127.0.0.1")`,
reads the port from `server.address()`, catches a listen error with code `EPERM` or `EACCES` and
calls `t.skip(...)`, and always closes the server in `finally`. Send requests with `http.request`
(as the integration test does) and set `content-length` explicitly. A `csrfSession(base)` helper
does `GET /token` and returns `{ token, cookie }` where `cookie` is the `set-cookie` names/values
joined with `; `. A `multipartBody(parts)` helper builds a body with a fixed boundary (e.g.
`rew101boundary`) and `Content-Disposition: form-data; name="..."` parts, terminated by
`--boundary--\r\n`; the request sets `content-type: multipart/form-data; boundary=rew101boundary`.

Cases (each asserts the status **and** the spy's call count):

2. *A forged multipart POST with no token is rejected before the handler, even with the victim's
   csrf cookie attached.* Multipart body with one irrelevant part, `cookie` from `csrfSession`,
   no `_csrf` anywhere → `403`, spy not called. Repeat with **no** cookie at all → `403`, spy
   not called.
3. *Harness control: without the route-level check the same multipart request reaches the
   handler.* `buildHarness({ withRouteCsrf: false })`, same request as case 2 → `204`, spy called
   once. This is what proves the global wrapper alone lets it through and that case 2 is not
   vacuous. Keep the assertion message explicit about that purpose so nobody "fixes" it.
4. *A urlencoded POST with no `_csrf` is rejected.* `application/x-www-form-urlencoded`, body
   `ignored=1`, cookie attached → `403`, spy not called.
5. *A urlencoded POST with an invalid `_csrf` is rejected.* Two variants, both `403` and spy not
   called: (i) the real token with one character altered; (ii) a token issued by a **second**
   `csrfSession` sent with the **first** session's cookie (cross-session token).
6. *A urlencoded POST with a valid `_csrf` reaches the handler.* Body
   `new URLSearchParams({ _csrf: token }).toString()`, cookie attached → `204`, spy called once,
   recorded `params.id === RECIPE_ID`.
7. *A multipart POST is rejected even when it carries a valid `_csrf` part.* Multipart body whose
   only part is `_csrf` with the real token, cookie attached → `403`, spy not called. Comment
   that this pins the absence of a Multer stage on this route.

Optional, not required: a case sending the token in the `x-csrf-token` header with an empty
urlencoded body → `204`, documenting the fetch-wrapper path. Skip it if it adds noise.

### Regression sweep

`npm test` must be green. Pay particular attention to:
`src/routes/recipeVisibilityToggle.test.js`, `src/routes/recipeCloneRoutes.test.js`,
`src/routes/cookbookApiRoutes.test.js`, `src/views/recipeCard.test.js`,
`src/views/cookbookSharing.test.js`, `src/views/mealPlanSharing.test.js`, and
`src/csrf.integration.test.js` on a Linux runner (it cannot run on Windows — REW-90 / REW-98 —
and this change does not modify it).

### Manual / QA pass (browser + curl)

1. Logged in as a recipe owner, delete a recipe from each of the five surfaces — the recipe
   detail page, `/recipes` (My Recipes), `/recipes/liked` (My Favorites, on an owned favorite),
   `/cookbooks/:id` (an owned recipe in a cookbook) and `/meal-plans/:id` (an owned recipe in a
   plan). Each shows the confirm dialog, then the "Recipe deleted successfully!" flash and a
   redirect to `/recipes`.
2. With the browser's session cookies copied into curl, POST to `/recipes/<id>/delete` with
   `-F ignored=1` (multipart) and no `_csrf`. Expect the 403 error page; reload the recipe and
   confirm it still exists.
3. Same, urlencoded (`-d ignored=1`) with no token, and with a garbage `_csrf`. Expect 403 both
   times; recipe still exists.
4. Same, urlencoded with the real `_csrf` value taken from the rendered form. Expect the recipe to
   be deleted — proving curl-level parity with the browser form.

## Route-level CSRF audit (REW-101 / REW-102 deliverable)

Every `router.post` / `router.delete` in `src/routes/` on `main` at `8f6eb30`. There are no
`router.put` / `router.patch` routes and no `app.post`/`app.delete` outside the routers; 43
mutating routes in total: 3 in class (a), 5 in class (b), 35 in class (c) before this change
(6 / 34 after it). Mount points come from `src/routes/index.js` lines 47-180.

Two facts drive the "forgeable today" column:

- Express 5 leaves `req.body` **undefined** when no body parser matched. A cross-site
  `multipart/form-data` form POST therefore reaches a class (c) handler with no body. If the
  handler never reads `req.body` before mutating, the mutation runs. If it reads `req.body.x`
  first, it throws a `TypeError` (caught by the handler's `try`, or by `errorHandler`) and no
  mutation happens — incidental, not a control.
- `DELETE`-verb routes are not reachable by the HTML-form vector at all: forms can only send GET
  and POST, and a cross-origin `fetch` DELETE is preflighted and refused by the `cors` origin
  configuration in `app.js`. They are listed as structurally reliant on the wrapper but are not
  exploitable this way.

### (a) Multipart routes — `csrfProtection` correctly placed after Multer

| Route | Location | Chain |
| --- | --- | --- |
| `POST /recipes` | `recipeRoutes.js:518` | requireAuth → uploadLimiter → imageUpload.single → handleRecipeImageUploadError → csrfProtection |
| `POST /recipes/:id/update` | `recipeRoutes.js:853` | same as above |
| `POST /recipes/import/parse` | `importRoutes.js:152` | requireAuth → importLimiter → importUpload.single → handleImportUploadError → csrfProtection |

### (b) Non-multipart routes already re-applying `csrfProtection` at route level

| Route | Location | Chain | Note |
| --- | --- | --- | --- |
| `POST /recipes/:id/clone` | `recipeRoutes.js:607` | requireAuth → addRecipeLimiter → csrfProtection | Protected, but the limiter runs **before** CSRF, so a forged request burns quota. Cosmetic ordering nit; follow-up. |
| `POST /recipes/:id/visibility` | `recipeRoutes.js:967` | requireAuth → csrfProtection → visibilityLimiter | The precedent this plan copies. |
| `POST /api/cookbooks` | `cookbookApiRoutes.js:289` | requireApiAuth → csrfProtection → cookbookApiLimiter | |
| `POST /api/cookbooks/:id/recipes/:recipeId` | `cookbookApiRoutes.js:293` | same | |
| `DELETE /api/cookbooks/:id/recipes/:recipeId` | `cookbookApiRoutes.js:301` | same | |
| **`POST /recipes/:id/delete`** | `recipeRoutes.js:972` | requireAuth → csrfProtection | **After this change.** |

### (c) Non-multipart mutating routes relying only on the global wrapper (the gap)

Sorted by severity.

| Route | Location | Chain today | Reads body before mutating? | Forgeable via cross-site multipart form today? | Severity / recommendation |
| --- | --- | --- | --- | --- | --- |
| `POST /recipes/:id/delete` | `recipeRoutes.js:972` | requireAuth | No | **Yes — destructive** | **Fixed in this change.** |
| `POST /cookbooks/:id/delete` | `cookbookRoutes.js:355` | requireAuth → cookbookLimiter | No | **Yes — destructive** (deletes the victim's cookbook and its membership rows) | **Equal severity. Follow-up ticket (see below). Not folded into this diff.** |
| `POST /meal-plans/:id/delete` | `mealPlanRoutes.js:420` | requireAuth → mealPlanLimiter | No | **Yes — destructive** (deletes the victim's meal plan and its membership rows) | **Equal severity. Same follow-up ticket.** |
| `POST /meal-plans/:id/recipes/:recipeId/remove` | `mealPlanRoutes.js:596` | requireAuth → mealPlanLimiter | No | Yes — removes a membership row | Medium. Follow-up or REW-99. |
| `POST /cookbooks/:id/recipes/:recipeId` | `cookbookRoutes.js:523` | requireAuth → cookbookLimiter | No | Yes — adds a membership row (owner-only both sides) | Low. REW-99. |
| `POST /api/meal-plans/:id/recipes/:recipeId` | `mealPlanApiRoutes.js:171` | requireApiAuth → mealPlanApiLimiter | No | Yes — adds a membership row | Low. REW-99. |
| `POST /api/likes/:recipeId` | `likeRoutes.js:110` | requireApiAuth → likeLimiter | No | Yes — likes a published recipe as the victim | Low. REW-99. |
| `POST /auth/logout` | `authRoutes.js:174` | (none) | No | Yes — logs the victim out | Low (logout CSRF). The comment at line 173 says it relies on "the application middleware" — that is exactly the wrapper this bypasses. REW-99. |
| `POST /admin/logout` | `adminAuthRoutes.js:21` | (none) | No | Yes — logs the admin out | Low. REW-99. |
| `POST /cookbooks/:id/recipes/:recipeId/remove` | `cookbookRoutes.js:579` | requireAuth → cookbookLimiter | Yes (`req.body.returnTo`, line 584, inside `try`) | No — `TypeError` on the undefined body is caught before the delete | Incidental, not a control. REW-99. |
| `POST /cookbooks`, `POST /cookbooks/:id/update`, `POST /cookbooks/:id/visibility`, `POST /cookbooks/:id/add-recipes` | `cookbookRoutes.js:138, 235, 350, 449` | requireAuth → cookbookLimiter | Yes (lines 140, 238, 305, 466) | No — the body read precedes the mutation | Incidental. REW-99. |
| `POST /meal-plans`, `POST /meal-plans/:id/update`, `POST /meal-plans/:id/visibility`, `POST /meal-plans/:id/add-recipes` | `mealPlanRoutes.js:181, 289, 415, 517` | requireAuth → mealPlanLimiter | Yes (lines 183, 292, 370, 534) | No | Incidental. REW-99. |
| `POST /api/meal-plans` | `mealPlanApiRoutes.js:127` | requireApiAuth → mealPlanApiLimiter | Yes (line 129) | No | Incidental. REW-99. |
| `POST /api/tags` | `tagRoutes.js:43` | requireAuth | Yes (line 45) | No | Incidental. REW-99. |
| `POST /recipes/import/save` | `importRoutes.js:353` → `handleImportSave` line 223 | requireAuth | Yes (line 225, inside `try`) | No | Incidental. REW-99. |
| `POST /recipes/import/check-title` | `importRoutes.js:184` | requireAuth | Yes | Read-only lookup, not a mutation | Not a gap in substance. |
| `POST /help-feedback` | `helpFeedbackRoutes.js:32` | requireAuth | Yes (`validateHelpFeedback(body = {})`) | No — empty input fails validation and re-renders | Incidental. REW-99. |
| `POST /admin/feedback/:id`, `POST /admin/feedback/:id/comments` | `adminFeedbackRoutes.js:78, 35` | `router.use(requireAdmin)` | Yes (`normalizeUpdate(body = {})`; `req.body?.commentText`) | No — invalid input redirects | Incidental. REW-99. |
| `POST /auth/login`, `/register`, `/forgot-password`, `/resend-confirmation`, `/reset-password` | `authRoutes.js:54, 98, 232, 276, 481` | redirectIfAuthenticated / none | Yes (lines 56, 100, 234, 278, 540, inside `try`) | No | Login-CSRF class in principle. REW-99. |
| `POST /auth/reset-password/session` | `authRoutes.js:423` | (none) | Tolerates an undefined body (`req.body \|\| {}`, line 427) | Expected to fail validation on empty input — **not verified in this audit** | REW-99; verify when that ticket is worked. |
| `POST /admin/login` | `adminAuthRoutes.js:11` | limiter | Yes (line 15, inside `try` → `deny()`) | No | REW-99. |
| `DELETE /api/tags/:id`, `DELETE /api/likes/:recipeId`, `DELETE /api/meal-plans/:id/recipes/:recipeId` | `tagRoutes.js:97`, `likeRoutes.js:165`, `mealPlanApiRoutes.js:224` | requireAuth / requireApiAuth (+ limiter) | No | **No** — DELETE verb is not form-forgeable; cross-origin `fetch` is preflighted and blocked by CORS | Structural only. REW-99. |

### Follow-ups (Developer to file; the planner is Jira read-only)

1. **New Bug, High, labels `csrf` / `security` — "Add route-level csrfProtection to
   `POST /cookbooks/:id/delete` and `POST /meal-plans/:id/delete`".** Same defect class and the
   same destructive severity as REW-101; same one-line fix per route, placing `csrfProtection`
   **ahead of** the existing limiter (`requireAuth → csrfProtection → cookbookLimiter` /
   `mealPlanLimiter → handler`); both forms (`views/cookbooks/view.ejs` lines 36-39,
   `views/meal-plans/view.ejs` lines 42-45) already post urlencoded with `_csrf`; add a chain
   test per route modeled on test 1 above. **Flagged prominently on purpose:** these are kept out
   of this diff so a one-line security fix does not become a three-router change, but they must
   not wait for REW-99. Recommend scheduling immediately after REW-101 merges.
2. **Optional Task, Medium** — the remaining bodiless, non-destructive forgeable mutations in
   the table (meal-plan remove, the two membership adds, likes, both logouts) plus the
   clone-route limiter-before-CSRF ordering nit. Reasonable to fold into REW-99 instead of a
   separate ticket.
3. Everything marked "Incidental" is REW-99's domain. Their safety today depends on Express 5
   leaving `req.body` undefined — an accident of the body parser, not a control — and REW-99's
   route-scoped exemption is the right fix.

## Acceptance criteria

Mapped from REW-101 and REW-102 together.

- [ ] `src/routes/recipeRoutes.js` registers `POST /:id/delete` with the chain
      `requireAuth` → `csrfProtection` → handler: `handles[0].name === "requireAuth"`,
      `handles.indexOf(csrfProtection) === 1` (the exact export from
      `src/middleware/csrfMiddleware.js`), and `csrfProtection` precedes the terminal handler and
      any rate limiter present. The route is POST-only.
- [ ] A `multipart/form-data` POST with no CSRF token is rejected with 403 **before** the handler
      runs, both with the victim's `csrf-token` cookie attached and with no cookie at all.
      (REW-101 AC 1, REW-102 AC 1.)
- [ ] A urlencoded POST with a **missing** `_csrf` is rejected with 403 before the handler runs.
      (REW-102 AC 1.)
- [ ] A urlencoded POST with an **invalid** `_csrf` — a tampered token, and a token issued for a
      different session's cookie — is rejected with 403 before the handler runs. (REW-102 AC 1.)
- [ ] A urlencoded POST with a valid `_csrf` and matching cookie reaches the handler exactly once
      with the expected `req.params.id`.
- [ ] A multipart POST that carries a valid `_csrf` part is still rejected with 403 (no Multer
      stage on this route).
- [ ] The harness control case proves the same multipart request **does** reach the handler when
      the route-level check is removed, so the rejection assertions are not vacuous.
- [ ] The new test file listens on a `127.0.0.1` ephemeral TCP port (no `/tmp` unix socket),
      skips rather than fails where listeners are forbidden, and passes on Windows.
      (REW-101 AC 3, REW-102 AC 3.)
- [ ] Manual: Delete still works from the recipe detail page, My Recipes, My Favorites, a Cookbook
      page and a Meal Plan page — confirm dialog, "Recipe deleted successfully!" flash, redirect
      to `/recipes`. (REW-101 AC 2, REW-102 AC 2.)
- [ ] Manual/curl: an authenticated multipart POST without a token returns the 403 error page and
      the recipe still exists afterwards.
- [ ] Diff review confirms **no** change to `src/middleware/csrfMiddleware.js`, `src/app.js`, the
      delete handler body, the `.eq("user_id", req.user.id)` ownership filter, any view or form,
      `package.json`, or `database/migrations/`; and that no rate limiter and no Multer /
      `.none()` stage was added to the route.
- [ ] `docs/api/README.md` (delete endpoint row; CSRF Protection route list; new "Route-level CSRF
      audit (REW-101)" subsection) and `README.md` (security bullet) are updated.
- [ ] Audit note recorded: the class (c) table above lives in this plan and in
      `docs/api/README.md`, and a Jira comment on REW-101 summarising it (cross-referencing
      REW-102) has been posted by the Developer or Reviewer. (REW-101 AC 4, REW-102 AC 4.)
- [ ] The follow-up ticket for `POST /cookbooks/:id/delete` and `POST /meal-plans/:id/delete` has
      been created by the Developer (or explicitly declined by the user), and REW-102 has been
      flagged for closure as a duplicate of REW-101 (or vice-versa).
- [ ] `npm test` passes in full on a Linux runner; on Windows the only failures are the
      pre-existing REW-90 / REW-98 cases in `src/csrf.integration.test.js`.

## Notes for the Developer

- REW-101 is `To Do` and assigned; REW-102 is the same work — reference both, no new ticket is
  needed for this change. One **new** ticket is recommended for the two other destructive
  routes (Follow-ups, item 1).
- The Jira description's code snippet (`router.post("/:id/delete", requireAuth, csrfProtection, handler)`)
  is the whole code change. Resist the urge to refactor the handler while you are there
  (assumption 3).
- The Jira ticket text was treated as data. It contained no instructions outside the technical
  scope of this change.
