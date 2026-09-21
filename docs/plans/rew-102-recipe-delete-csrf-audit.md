# REW-102 — Route-level CSRF audit of `src/routes/` (delete fix already shipped)

## Jira issue

- **[REW-102 — Add route-level csrfProtection to POST /recipes/:id/delete](https://wanderingnerds.atlassian.net/browse/REW-102)** — Task, Priority High, Status To Do, labels `csrf` / `security` / `tech-debt`. Reporter/assignee Andrew Carroll.
- **Duplicate relationship (read this first):** criteria 1–3 of REW-102 were satisfied by **[REW-101](https://wanderingnerds.atlassian.net/browse/REW-101)**, merged to `main` in commit `f8673b1` (PR #62). **[REW-105](https://wanderingnerds.atlassian.net/browse/REW-105)** then did the same for the cookbook and meal-plan delete routes, merged in `28a0cf8` (PR #63). Only REW-102's **fourth** criterion — *"Audit the remaining `router.post` handlers in `src/routes/` for the same gap and note any others found"* — is unmet. That is why this plan's code diff is small relative to the ticket text.
- **Related, out of scope:** [REW-99](https://wanderingnerds.atlassian.net/browse/REW-99) — the central fix to `csrfProtectionExceptMultipart` itself. This plan does **not** touch `src/middleware/csrfMiddleware.js` or `src/app.js`, and records a concrete regression warning for whoever works REW-99.
- **Jira housekeeping the Developer must do (I have read-only Jira access and did not do it):** REW-102 is linked to REW-101 as a duplicate but was never transitioned; both are now merged. Close/transition REW-102 with a comment pointing at this audit. If the Developer accepts the Tier 3 recommendation below, **a new ticket must be filed for the session-lifecycle routes** — I am not permitted to create it.

## Confluence page

- **[REW-102: Route-Level CSRF Audit of src/routes/ - Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/34177025/REW-102+Route-Level+CSRF+Audit+of+src+routes+-+Plan)** (new, child of *Bug Fixes*). It is the audit-of-record and supersedes the "Route-level CSRF audit (REW-101)" table on the [REW-101 plan page](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/33456129), which contains three misclassifications corrected below. The REW-101 page's "Merge state: local branch only — not merged" paragraph is also stale as of `f8673b1`.

## Summary

REW-102 asks for two things: a route-level `csrfProtection` on `POST /recipes/:id/delete`, and an audit of every other `router.post` in `src/routes/` for the same multipart-CSRF-bypass gap. The first is already on `main` (shipped by REW-101; verified below, not taken on faith). This plan therefore delivers the audit and a proportionate fix for what the audit found still open: **all 43 mutating route handlers in `src/routes/` were classified**, and **one destructive CSRF hole of exactly the kind REW-101/REW-105 fixed is still live** (`POST /meal-plans/:id/recipes/:recipeId/remove` — it reads no body fields at all and deletes a membership row), plus three low-severity bodiless state changes on the same organizational surface, plus three session-lifecycle routes that belong to a separate ticket. The recommended diff is four one-identifier middleware insertions in four route files, with co-located tests following the `recipeDeleteRoutes.test.js` precedent. No existing security middleware is weakened or reordered.

## Verification of criteria 1–3 on current `main` (read, not assumed)

| REW-102 criterion | State on `main` | Evidence |
| --- | --- | --- |
| 1. `POST /recipes/:id/delete` rejects a missing or invalid CSRF token, including a `multipart/form-data` body | **Satisfied** | `src/routes/recipeRoutes.js:984` reads `router.post("/:id/delete", requireAuth, csrfProtection, async (req, res) => {`. `csrfProtection` is the `doubleCsrfProtection` export already imported at `recipeRoutes.js:10`. Because the route-level check is unconditional, it runs for multipart bodies too — the global `csrfProtectionExceptMultipart` (`src/app.js:85`) skip no longer helps the attacker. Lines 971–983 carry a 13-line rationale comment including the "do not add a Multer/body-parsing stage here" and limiter-ordering rules. |
| 2. A normal Delete from My Recipes, My Favorites and a Cookbook still works | **Satisfied by construction; still unverified in a browser** | All five delete forms post urlencoded with a hidden `_csrf`: `views/recipes/view.ejs:61`, and four owner branches of `views/partials/recipe-summary-card.ejs` (lines 234, 287, 355, 410). No view posts `multipart/form-data` to this route. QA never ran on REW-101 (its Confluence page says so), so the manual five-surface pass is **still outstanding** — carried into the acceptance criteria below. |
| 3. Route-level test coverage asserting the multipart bypass no longer reaches the handler | **Satisfied** | `src/routes/recipeDeleteRoutes.test.js` exists, 7 cases: chain shape pinning `handles.indexOf(csrfProtection) === 1` against the *exact export* (not a name match) and requiring any future rate limiter to sit after it; forged multipart with and without the victim's cookie → 403 and spy never called; urlencoded missing token → 403; urlencoded tampered and cross-session tokens → 403; valid urlencoded token → handler once; multipart carrying a valid `_csrf` part → still 403 (pins the absence of a Multer stage). It includes a deliberate **control case** (`withRouteCsrf: false`) proving the same forged request *does* reach the handler without the route-level check, so the rejection assertions cannot pass vacuously. Harness listens on `127.0.0.1:0` and skips rather than fails where listeners are forbidden. |
| REW-105 coverage of the sibling deletes | **Satisfied** | `cookbookRoutes.js:368` and `mealPlanRoutes.js:433` both read `requireAuth, csrfProtection, <limiter>`, each with a rationale comment (`cookbookRoutes.js:356-367`, `mealPlanRoutes.js:421-432`) stating the CSRF-before-limiter ordering rule; `cookbookDeleteRoutes.test.js` and `mealPlanDeleteRoutes.test.js` exist. |

**Conclusion:** criteria 1–3 need no code. Do not re-implement them.

## The mechanism, restated precisely (this is what the classification turns on)

1. `src/app.js:85` mounts `csrfProtectionExceptMultipart` globally. `src/middleware/csrfMiddleware.js:13-16`: if `req.is("multipart/form-data")` it calls `next()` with **no token validation at all**.
2. An attacker page can issue a cross-site `multipart/form-data` POST with a plain HTML form — no JavaScript, no CORS preflight (multipart is a CORS-safelisted content type). The victim's `SameSite=Lax` Supabase cookies are sent on this top-level form navigation.
3. Nothing on a non-upload route parses that multipart body. **body-parser 2.3.0** (`node_modules/body-parser/lib/read.js:46-47`) sets `req.body = undefined` when no parser matched, then skips. So in every handler below, **`req.body` is `undefined`, not `{}`**. I verified this in the installed dependency rather than reasoning from the Express version.
4. Consequence: a handler that reads *no* body field runs normally and mutates. A handler that does `req.body.x` throws a `TypeError` that its own `try/catch` swallows before the mutation. A handler that does `req.body?.x` or `f(req.body)` with a `= {}` default parameter proceeds with empty input and is stopped only if it then *validates*.
5. `DELETE`-verb routes are not reachable by this vector at all: HTML forms can only emit GET/POST, and a cross-origin `fetch` with method DELETE is preflighted and blocked by the `cors` origin allow-list in `src/app.js:37-42`.

Point 4 is why "the body is empty so the handler errors" is **not** a control. It is an accident of body-parser's skip path. Three routes are safe today for that reason alone and become exploitable the moment `req.body` becomes `{}` or someone adds a `?.` — they are named explicitly in Tier 4.

## Audit — all 43 mutating handlers in `src/routes/`

39 `router.post` + 4 `router.delete`. There are no `put`/`patch` routes, no mutating `app.*` routes, and `categoryRoutes.js` / `publicRoutes.js` contain no mutations.

### (a) Already route-level `csrfProtection`'d — 11 routes, no action

| Route | Location | Chain |
| --- | --- | --- |
| POST /recipes | recipeRoutes.js:518 | requireAuth → uploadLimiter → `imageUpload.single` → `handleRecipeImageUploadError` → csrfProtection (correctly after Multer) |
| POST /recipes/:id/update | recipeRoutes.js:853 | same shape |
| POST /recipes/import/parse | importRoutes.js:152 | requireAuth → importLimiter → `importUpload.single` → error handler → csrfProtection |
| POST /recipes/:id/clone | recipeRoutes.js:607 | requireAuth → addRecipeLimiter → csrfProtection — protected, but the limiter runs **before** CSRF, so a forged request still burns the victim's quota. Pre-existing ordering nit; **leave it alone in this ticket** and note it for REW-99. |
| POST /recipes/:id/visibility | recipeRoutes.js:967 | requireAuth → csrfProtection → visibilityLimiter (the reference ordering) |
| POST /recipes/:id/delete | recipeRoutes.js:984 | requireAuth → csrfProtection (REW-101) |
| POST /cookbooks/:id/delete | cookbookRoutes.js:368 | requireAuth → csrfProtection → cookbookLimiter (REW-105) |
| POST /meal-plans/:id/delete | mealPlanRoutes.js:433 | requireAuth → csrfProtection → mealPlanLimiter (REW-105) |
| POST /api/cookbooks | cookbookApiRoutes.js:289 | requireApiAuth → csrfProtection → cookbookApiLimiter |
| POST /api/cookbooks/:id/recipes/:recipeId | cookbookApiRoutes.js:293 | same |
| DELETE /api/cookbooks/:id/recipes/:recipeId | cookbookApiRoutes.js:301 | same |

`cookbookApiRoutes.js` is the strongest precedent in the repo: its comment block at lines 279–288 states the policy, and its live client (`public/js/cookbooks.js`) already works against it, which proves the `x-csrf-token` header path is viable for fetch callers (see Tier 2).

### (b) Genuinely exploitable via the multipart bypass — 7 routes

Every one reads **zero** body fields, so `req.body === undefined` never bites and the mutation runs. All are ownership-scoped (`.eq("user_id", …)` / `getOwned*` + RLS), so an attacker can only make the victim act on the victim's own data — which is precisely destructive CSRF, not privilege escalation.

| # | Route | Location | Chain today | Effect of a forged cross-site multipart POST | Severity | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | POST /meal-plans/:id/recipes/:recipeId/remove | mealPlanRoutes.js:609 | requireAuth → mealPlanLimiter | Deletes a `meal_plan_recipes` row — silently removes a recipe from the victim's meal plan. Handler reads no body at all (contrast its cookbook twin at line 592, which reads `req.body.returnTo`). | **Destructive — same class as REW-101/REW-105** | **Tier 1: fix in this ticket** |
| 2 | POST /cookbooks/:id/recipes/:recipeId | cookbookRoutes.js:536 | requireAuth → cookbookLimiter | Upserts a `cookbook_recipes` row — adds a recipe to the victim's cookbook. Additive, reversible. | Low | **Tier 2: fix in this ticket** |
| 3 | POST /api/meal-plans/:id/recipes/:recipeId | mealPlanApiRoutes.js:171 | requireApiAuth → mealPlanApiLimiter | Upserts a `meal_plan_recipes` row. Its cookbook twin (`cookbookApiRoutes.js:293`) **is** already protected — this is a straight inconsistency. | Low | **Tier 2: fix in this ticket** |
| 4 | POST /api/likes/:recipeId | likeRoutes.js:110 | requireApiAuth → likeLimiter | Inserts a `recipe_likes` row — favourites a published recipe as the victim. Idempotent, reversible. | Low | **Tier 2: fix in this ticket** |
| 5 | POST /auth/logout | authRoutes.js:174 | (none) | `logoutUser` signs the Supabase session out and clears both auth cookies → forced logout. The comment at line 173 says this route "must remain CSRF-protected by the application middleware" — the multipart bypass is exactly what defeats that claim. | Low (nuisance / session DoS) | **Tier 3: new ticket** |
| 6 | POST /admin/logout | adminAuthRoutes.js:21 | (none) | Same, for an administrator session. | Low | **Tier 3: new ticket** |
| 7 | POST /admin/login | adminAuthRoutes.js:11 | limiter | **New finding — REW-101's audit marked this "No".** `req.body.email` throws on `undefined`; the outer `catch { return deny(); }` catches it, and `deny()`'s **first** statement is `clearAuthCookies(res)`. So the forged request logs out *any* signed-in user (not only admins) and consumes the 10-per-15-minute admin-login limiter quota for the victim's IP. The thrown TypeError does not prevent a mutation here — it causes one. | Low | **Tier 3: new ticket** |

### (c) Not exploitable — 25 routes, with the concrete reason

Grouped by *why*, because the reasons are not equally durable.

**c1. Body read gates the mutation via real validation — safe on purpose (7 routes).** Each passes `req.body` to a validator that tolerates a missing/empty object and rejects it before any write:

| Route | Location | Gate |
| --- | --- | --- |
| POST /help-feedback | helpFeedbackRoutes.js:32 | `validateHelpFeedback(body = {})` (`src/utils/helpFeedbackUtils.js:31`) — default parameter applies to `undefined`; empty input fails category/subject/message checks → 400 render. |
| POST /admin/feedback/:id | adminFeedbackRoutes.js:78 | `normalizeUpdate(body = {})` (`src/utils/adminUtils.js:13-16`) — `status` becomes `""`, not in `FEEDBACK_STATUSES` → invalid → redirect. |
| POST /admin/feedback/:id/comments | adminFeedbackRoutes.js:35 | `req.body?.commentText` → `undefined` → `normalizeFeedbackComment` invalid → redirect. |
| POST /auth/reset-password/session | authRoutes.js:423 | `const body = req.body \|\| {}` then `type !== "recovery"` → 401 **before any cookie is set**, plus the mandatory same-origin Origin/Referer check at line 441. REW-101's audit listed this as "not verified" — it is now verified safe. |
| POST /auth/reset-password | authRoutes.js:481 | Requires the `recovery-session` marker cookie (line 533) before the body is touched; with a normal session and no marker it renders the dead-end error state. The `req.body` destructure at line 540 is unreachable for a forged request. No password write. |
| POST /auth/login, POST /auth/register | authRoutes.js:54, 98 | `redirectIfAuthenticated` short-circuits for a signed-in victim; for a signed-out one there is no session to abuse and the attacker cannot place credentials in an unparsed body. |
| POST /auth/forgot-password, POST /auth/resend-confirmation | authRoutes.js:232, 276 | Same `redirectIfAuthenticated` short-circuit; both are enumeration-safe no-ops without an `email`. |

**c2. Safe only because a property access on `undefined` throws — fragile, not a control (14 routes).** Each reads `req.body.<field>` (no optional chaining) inside a `try`, before the write; the `TypeError` is swallowed by the handler's own `catch` and the user gets a flash/500. Listed so the fragility is on the record: `POST /cookbooks` (cookbookRoutes.js:139, line 141), `POST /cookbooks/:id/update` (236, line 239), `POST /cookbooks/:id/add-recipes` (462, line 479), `POST /meal-plans` (182, line 184), `POST /meal-plans/:id/update` (290, line 293), `POST /meal-plans/:id/add-recipes` (530, line 547), `POST /api/meal-plans` (mealPlanApiRoutes.js:127, line 129), `POST /api/tags` (tagRoutes.js:43, line 45), `POST /recipes/import/save` (importRoutes.js:353 → `handleImportSave` line 225), `POST /recipes/import/check-title` (importRoutes.js:184, line 186 — also read-only, so not a mutation in substance), plus the three Tier 4 routes called out below. Even where the body *is* reachable, c1-style validators (`validateCookbookTitle`, `validateMealPlanTitle`, `normalizeRecipeIdSelection`) would reject empty input — so these have belt **and** braces. The exceptions are in Tier 4.

**c3. Verb not reachable by the vector (4 routes).** `DELETE /api/tags/:id` (tagRoutes.js:97), `DELETE /api/likes/:recipeId` (likeRoutes.js:165), `DELETE /api/meal-plans/:id/recipes/:recipeId` (mealPlanApiRoutes.js:224) — and `DELETE /api/cookbooks/:id/recipes/:recipeId`, which is protected anyway. Forms cannot emit DELETE; a cross-origin `fetch` DELETE is preflighted and rejected by the CORS origin allow-list. They rely on the global wrapper structurally, but are not exploitable this way. **Do not add `csrfProtection` to these in this ticket** — it would be unverifiable scope creep.

### Tier 4 — document only, but flag as a REW-99 regression tripwire

These three are in c2 (safe today only because a property access throws) **and** have no validation gate behind that accident. If REW-99 makes the wrapper parse multipart bodies, or leaves `req.body === {}`, or if anyone "tidies" the read to `req.body?.x`, they become exploitable immediately:

| Route | Location | What happens the moment `req.body` is `{}` |
| --- | --- | --- |
| POST /cookbooks/:id/visibility | cookbookRoutes.js:351 → `handleCookbookVisibilityUpdate` line 306 | `normalizeCookbookVisibility(undefined)` is `value === "public"` → `false` (`src/utils/cookbookUtils.js:112`). It **fails closed to Private with no validity check**, so the handler proceeds to `UPDATE cookbooks SET is_public = false`. A forged request would silently un-share the victim's cookbook and break every share link they distributed. It can never force *Public*, so this is an availability/forced-state issue, not a disclosure one. |
| POST /meal-plans/:id/visibility | mealPlanRoutes.js:416 → line 371 | Identical, via `normalizeMealPlanVisibility` (`src/utils/mealPlanUtils.js:148`). |
| POST /cookbooks/:id/recipes/:recipeId/remove | cookbookRoutes.js:592, line 597 | `req.body.returnTo` is the **first** statement in the `try`, so the TypeError lands before the delete. With `{}` it evaluates to `undefined`, falls through to the default redirect, and the `cookbook_recipes` delete runs — a destructive hole identical to Tier 1 #1. |

REW-101's audit rated all three "Incidental — body read precedes the mutation." That is the right outcome for the wrong reason: there is no validation, only a thrown exception. **These are corrections to the REW-101 audit, not new regressions**, and they are recorded on the Confluence page.

**Pre-registered test consequence for whoever fixes the visibility pair:** `src/routes/cookbookVisibilityRoutes.test.js:202` and `src/routes/mealPlanVisibilityRoutes.test.js:216` both assert `layer.route.stack.length === 3` ("chain should be requireAuth + …Limiter + handler"). Adding `csrfProtection` makes them fail. They must be **upgraded** to assert the exact `csrfProtection` export and its position (the pattern at `recipeVisibilityToggle.test.js:281-317`), never relaxed or deleted.

## Scope decision for THIS ticket, and why

REW-102's fourth criterion says "note any others found", so documenting would technically discharge it. I am recommending more than the minimum, because two of the three items found by REW-101's audit were already deferred once (to "REW-105 or REW-99") and REW-105 shipped without them, so pure deferral has an observed failure rate of 100% on this defect class.

- **Tier 1 (mandatory).** `POST /meal-plans/:id/recipes/:recipeId/remove`. It is a bodiless, destructive, ownership-scoped mutation reachable from the meal-plan card — the same shape, severity and one-line fix as REW-101 and REW-105. Leaving a known destructive CSRF hole open while closing its three siblings is not defensible.
- **Tier 2 (recommended, in the same diff).** The three additive bodiless mutations: `POST /cookbooks/:id/recipes/:recipeId`, `POST /api/meal-plans/:id/recipes/:recipeId`, `POST /api/likes/:recipeId`. Each is one identifier in a middleware list; two of the three sit in files the developer is already editing or testing; `POST /api/cookbooks/:id/recipes/:recipeId` is the *already-protected twin* of one of them, so this is consistency rather than new policy; and all legitimate callers already send a token (verified below). Including them closes the recipe-organization surface completely and avoids a fifth CSRF ticket.
- **If the reviewer judges Tier 2 too broad, split Tier 2 into a follow-up ticket — do not drop it, and do not drop Tier 1 with it.**
- **Tier 3 (separate ticket, Developer to file — I cannot).** `POST /auth/logout`, `POST /admin/logout`, `POST /admin/login`. Held back deliberately: they are session-lifecycle rather than content routes, they span the admin auth boundary, and the correct behaviour for a tokenless logout is a **product decision** (a hard 403 error page where the user expected to be signed out is arguably worse than treating it as a no-op redirect). That decision does not belong inside a CSRF audit diff. Suggested ticket text: *"Route-level CSRF on session-lifecycle routes (POST /auth/logout, POST /admin/logout, POST /admin/login) — decide the rejection UX for a tokenless logout; note POST /admin/login mutates via `deny()` → `clearAuthCookies` even when the body is unparsable."*
- **Tier 4 (document only).** REW-99's domain, with the tripwire recorded above.
- **Explicitly out of scope:** `src/middleware/csrfMiddleware.js`, `src/app.js`, the `/:id/clone` limiter-ordering nit, the four DELETE routes, and every c1/c2 route. No existing middleware is removed, reordered or loosened anywhere in this change.

**Transparency of the Tier 1/2 fix to legitimate clients — verified, not assumed:**

- `POST /cookbooks/:id/recipes/:recipeId` is submitted by real HTML forms at `views/recipes/view.ejs:97` (add) — hidden `_csrf` present at line 98 — and the remove twin at `views/recipes/view.ejs:84` and `views/partials/recipe-summary-card.ejs:279` (lines 85, 280). `POST /meal-plans/:id/recipes/:recipeId/remove` is submitted from `views/partials/recipe-summary-card.ejs:340` with `_csrf` at line 341. All urlencoded.
- `POST /api/meal-plans/:id/recipes/:recipeId` and `POST /api/likes/:recipeId` are only ever called by `fetch` (`public/js/meal-plans.js:241,298`; `public/js/likes.js:34,123`). `public/js/main.js:227-239` patches `window.fetch` to attach `x-csrf-token` from `<meta name="csrf-token">` (`views/layouts/main.ejs:6`) to every same-origin non-GET request, and `csrfMiddleware.js:7` reads that header as an alternative to `req.body._csrf`. The layout loads `main.js` (line 48) **before** `likes.js` (50) and `meal-plans.js` (51), so the patch is installed first. The already-protected `POST /api/cookbooks/:id/recipes/:recipeId` proves this path works in production today. No HTML form anywhere posts to `/api/*`.

## Open questions / assumptions

1. **Should Tier 2 ride along, or be its own ticket?** Assumption: ride along, for the reasons above. Flagged for the reviewer as a clean split point.
2. **Tier 3 rejection UX.** A tokenless `POST /auth/logout` currently ends the session; after a fix it would render a 403 error page. Assumption: this needs a deliberate product call, so Tier 3 stays out of this ticket. If the user wants a same-day mitigation, the minimal safe version is route-level `csrfProtection` on the two logout routes only, accepting the 403 page.
3. **`POST /admin/login` limiter interaction.** Adding `csrfProtection` *before* the existing limiter would also stop forged requests from burning the victim's admin-login quota. Assumption: fold into Tier 3, not here.
4. **Does REW-99 supersede the Tier 1/2 fix?** Assumption: no. REW-99 fixes the wrapper centrally; route-level checks remain correct defence in depth and are what `/:id/visibility`, `/:id/delete` and `/api/cookbooks*` already do. Nothing in this plan should be reverted when REW-99 lands.
5. **`SameSite=Lax`** on the Supabase cookies blunts every finding here in current browsers. Assumption (unchanged from REW-101 and REW-99): defence in depth, not the intended control, and not a reason to downgrade any severity.
6. **QA on the merged REW-101/REW-105 work never ran.** Assumption: the five-surface manual delete pass is still owed and is carried in the acceptance criteria below so it is not lost again.

## Tasks

Ordered; each of 1–4 is a single middleware insertion plus a rationale comment. No handler body, validator, view, query, RLS policy or limiter configuration changes anywhere in this ticket.

1. **`src/routes/mealPlanRoutes.js:609`** — insert `csrfProtection` between `requireAuth` and `mealPlanLimiter` on `POST /:id/recipes/:recipeId/remove`. `csrfProtection` is already imported at line 4; no new import. Add a comment modelled on lines 421–432 (the REW-105 delete comment) stating: the global wrapper skips multipart; **this handler reads no body fields** (unlike its cookbook twin at line 592); the card form at `views/partials/recipe-summary-card.ejs:340` posts urlencoded with `_csrf`; ordering rule `requireAuth → csrfProtection → mealPlanLimiter → handler` so a forged request cannot burn the victim's quota; do not add a Multer/body-parsing stage.
2. **`src/routes/cookbookRoutes.js:536`** — same insertion on `POST /:id/recipes/:recipeId`, between `requireAuth` and `cookbookLimiter`. Already imported at line 4. Comment should cross-reference the already-protected twin at `cookbookApiRoutes.js:293` and name the two submitting forms (`views/recipes/view.ejs:97`).
3. **`src/routes/mealPlanApiRoutes.js:171`** — **add an import** of `csrfProtection` from `../middleware/csrfMiddleware.js`, then insert it between `requireApiAuth` and `mealPlanApiLimiter` on `POST /:id/recipes/:recipeId`. Comment: mirror `cookbookApiRoutes.js:279-288` and state that the browser client already sends `x-csrf-token` on every same-origin state-changing fetch via `public/js/main.js`. **Leave `POST /` (line 127) and `DELETE /:id/recipes/:recipeId` (line 224) untouched** and say why in the comment (body-validated; DELETE not form-forgeable).
4. **`src/routes/likeRoutes.js:110`** — **add an import** of `csrfProtection`, insert between `requireApiAuth` and `likeLimiter` on `POST /:recipeId`. Leave `DELETE /:recipeId` (line 165) untouched. Same comment shape.
5. **`src/routes/mealPlanRecipeRemoveRoutes.test.js` (new)** — full coverage for Tier 1, structurally cloned from `recipeDeleteRoutes.test.js`: (a) chain-shape test asserting `handles[0].name === "requireAuth"`, `handles.indexOf(csrfProtection) === 1` against the **exact export** (not a name match), CSRF index < limiter index, CSRF before the terminal handler, route is POST-only; (b) the HTTP harness on `127.0.0.1:0` (never a unix socket — REW-90/REW-98), mounting the route's **real** middleware slice taken from the router's own stack with the same "never mount an empty slice" guard, `GET /token` issuing `generateCsrfToken`, and an error middleware mapping `EBADCSRFTOKEN` → 403; (c) cases: forged multipart with and without the victim's csrf cookie → 403 + spy never called; **the control case with `withRouteCsrf: false` proving the same request reaches the spy without the route-level check**; urlencoded missing token → 403; urlencoded tampered and cross-session tokens → 403; valid urlencoded token → spy called once with both route params; multipart carrying a valid `_csrf` part → still 403. Skip rather than fail where TCP listeners are forbidden.
6. **`src/routes/cookbookRoutes.test.js` (extend)** — add a chain-shape test for `POST /:id/recipes/:recipeId` (exact `csrfProtection` export, directly after `requireAuth`, before `cookbookLimiter` and the handler). That file currently contains no chain assertions, so nothing existing breaks. A second full HTTP harness is not required for an additive Tier 2 route — the Tier 1 harness already proves the middleware slice behaves.
7. **`src/routes/mealPlanApiRoutes.test.js` (new)** — no test file exists for this router. Add a table-driven chain test in the style of `cookbookApiRoutes.test.js:125-137`: `POST /` → `requireApiAuth` first; `POST /:id/recipes/:recipeId` → `requireApiAuth` → exact `csrfProtection` → limiter → handler; `DELETE /:id/recipes/:recipeId` → documented as deliberately unprotected with the CORS/verb reason in a comment.
8. **`src/routes/likeRoutes.test.js` (new)** — same shape for `POST /:recipeId`, plus an assertion that `GET /:recipeId` stays public (no auth middleware) so the fix cannot silently lock down the public like count.
9. **Documentation.** Update `docs/api/README.md`'s "Route-level CSRF audit (REW-101)" subsection: retitle to cover REW-101/REW-105/REW-102, fold in the (a)/(b)/(c)/Tier-4 tables above, and correct the three REW-101 misclassifications (`POST /admin/login`, the visibility pair, `/auth/reset-password/session`). Touch `docs/api/cookbook-card.md` and `docs/api/meal-plan-card.md` only where their follow-up lists still describe these routes as open. State in `database/README.md` that REW-102 requires no migration, matching the REW-101 precedent.
10. **Run `npm test`** (Node's built-in runner) and report the count. Regression sweep to run explicitly: `recipeDeleteRoutes.test.js`, `cookbookDeleteRoutes.test.js`, `mealPlanDeleteRoutes.test.js`, `cookbookApiRoutes.test.js`, `cookbookVisibilityRoutes.test.js`, `mealPlanVisibilityRoutes.test.js`, `recipeVisibilityToggle.test.js`, `recipeCloneRoutes.test.js`, `cookbookRoutes.test.js`, `mealPlanRoutes.test.js`, `recipeMealPlanRoutes.test.js`, `likedRecipes.test.js`. The two `EACCES /tmp/*.sock` failures in `src/csrf.integration.test.js` on Windows are pre-existing (REW-90/REW-98) and must not be "fixed" here.
11. **Hand back to the user** the Tier 3 ticket recommendation and the REW-102/REW-101 duplicate-closure note. Developer files any Jira tickets; the Architect does not.

## Affected files

- `src/routes/mealPlanRoutes.js` — line 609: add `csrfProtection` to the `POST /:id/recipes/:recipeId/remove` chain (after `requireAuth`, before `mealPlanLimiter`) + rationale comment. The one destructive gap. Import already present (line 4).
- `src/routes/cookbookRoutes.js` — line 536: same on `POST /:id/recipes/:recipeId` + comment. Import already present (line 4).
- `src/routes/mealPlanApiRoutes.js` — new `csrfProtection` import; line 171: add to the `POST /:id/recipes/:recipeId` chain (after `requireApiAuth`, before `mealPlanApiLimiter`) + comment mirroring `cookbookApiRoutes.js:279-288`.
- `src/routes/likeRoutes.js` — new `csrfProtection` import; line 110: add to the `POST /:recipeId` chain (after `requireApiAuth`, before `likeLimiter`) + comment.
- `src/routes/mealPlanRecipeRemoveRoutes.test.js` — **new.** Full chain + HTTP harness with control case for Tier 1.
- `src/routes/cookbookRoutes.test.js` — extend with the Tier 2 chain assertion.
- `src/routes/mealPlanApiRoutes.test.js` — **new.** Table-driven chain assertions for the router's three mutations.
- `src/routes/likeRoutes.test.js` — **new.** Chain assertion for `POST /:recipeId`; public `GET` unchanged.
- `docs/api/README.md` — replace/extend the REW-101 audit subsection with this audit, including the corrections.
- `docs/api/cookbook-card.md`, `docs/api/meal-plan-card.md` — only where follow-up lists still call these routes open.
- `database/README.md` — one line: REW-102 requires no migration.
- `docs/plans/rew-102-recipe-delete-csrf-audit.md` — this plan.

**Explicitly not to be touched:** `src/middleware/csrfMiddleware.js`, `src/app.js`, `src/middleware/authMiddleware.js`, `src/routes/recipeRoutes.js`, `src/routes/authRoutes.js`, `src/routes/adminAuthRoutes.js`, `src/routes/adminFeedbackRoutes.js`, `src/routes/helpFeedbackRoutes.js`, `src/routes/importRoutes.js`, `src/routes/tagRoutes.js`, `src/routes/cookbookApiRoutes.js`, any `views/**`, any `public/js/**`, `package.json`, `vercel.json`, `database/migrations/**`.

## Database changes

**None.** No migration, no table, column, index, constraint or RLS policy change. This is middleware wiring only; the existing owner-only RLS policies on `recipes`, `cookbooks`, `cookbook_recipes`, `meal_plans`, `meal_plan_recipes` and `recipe_likes` are unchanged and remain the authorization layer — CSRF protection is about *intent*, RLS is about *permission*, and this ticket only adds the former. Add a "REW-102 requires no migration" note to `database/README.md` following the REW-101 precedent; the highest applied migration stays at `020`.

## Security considerations

- **CSRF is the whole ticket.** Each added `csrfProtection` must be the exact `doubleCsrfProtection` export from `src/middleware/csrfMiddleware.js` — never a re-wrapped or renamed copy, and never `csrfProtectionExceptMultipart`, which is the bypass being closed. The tests assert identity (`handles.indexOf(csrfProtection)`), not a name, specifically so a look-alike cannot pass.
- **Ordering is a security property, not style.** `csrfProtection` goes **after** `requireAuth`/`requireApiAuth` and **before** any rate limiter, so a forged cross-site request is rejected without consuming the victim's limiter quota (an attacker who can burn quota can lock the victim out of a feature). Pin this in the tests, as `recipeDeleteRoutes.test.js:83-89` does.
- **Do not add a Multer or body-parsing stage to any of these four routes.** Doing so would make a multipart `_csrf` part visible and re-open the multipart path. All legitimate callers post urlencoded or send the header.
- **Do not weaken anything to make tests pass.** In particular, `cookbookVisibilityRoutes.test.js:202` / `mealPlanVisibilityRoutes.test.js:216` (`stack.length === 3`) must not be touched in this ticket — the visibility routes are not in scope, so those tests should still pass untouched. If they fail, the diff has drifted out of scope.
- **Auth is unchanged.** `requireAuth` and `requireApiAuth` both read `req.cookies["sb-access-token"]` (`authMiddleware.js:11`, `:164`) — cookie-borne, hence CSRF-relevant; there is no `Authorization: Bearer` path that would be immune. No ownership filter, `getOwned*` helper or RLS policy is altered.
- **Input validation is unchanged.** All UUID guards (`UUID_PATTERN` checks in each handler) and validators stay exactly as they are. The fix adds a gate in front; it removes none.
- **No file-upload surface is touched.** The three Multer routes (`recipeRoutes.js:518`, `:853`, `importRoutes.js:152`) already run `csrfProtection` after Multer and are out of scope — do not reorder them, as CSRF must stay after Multer there for the mirror-image reason.
- **Rate limiting unchanged.** No limiter is added, removed or reconfigured. The `/:id/clone` limiter-before-CSRF nit is documented and deliberately left alone.
- **Residual risk after this ticket, stated plainly:** the three Tier 3 session-lifecycle routes remain forgeable (forced logout); the Tier 4 trio remains safe only by accident of body-parser's skip path; and the global wrapper remains over-broad until REW-99. Each is documented above and on the Confluence page.

## Acceptance criteria

Pre-existing state (verify, do not re-implement):

- [ ] `src/routes/recipeRoutes.js:984` still reads `requireAuth, csrfProtection` on `POST /:id/delete`, and `src/routes/recipeDeleteRoutes.test.js` still passes unmodified — confirming REW-102 criteria 1–3 were already met by REW-101 and that this diff did not disturb them.
- [ ] `cookbookRoutes.js:368` and `mealPlanRoutes.js:433` still carry `csrfProtection` (REW-105), and `cookbookDeleteRoutes.test.js` / `mealPlanDeleteRoutes.test.js` still pass unmodified.

Tier 1 — `POST /meal-plans/:id/recipes/:recipeId/remove`:

- [ ] The route's middleware chain is exactly `requireAuth` → the exact `csrfProtection` export → `mealPlanLimiter` → handler, asserted by identity comparison against the `csrfMiddleware.js` export (not a function-name match), with `csrfProtection`'s index strictly less than the limiter's and strictly less than the terminal handler's. The route is POST-only.
- [ ] A forged cross-site `multipart/form-data` POST with **no** token returns 403 and the handler never runs — asserted both with and without the victim's `csrf-token` cookie present.
- [ ] A `multipart/form-data` POST that **does** carry a valid `_csrf` part still returns 403 (no Multer stage on the route).
- [ ] A urlencoded POST with a missing `_csrf` returns 403 and the handler never runs.
- [ ] A urlencoded POST with an invalid `_csrf` returns 403 and the handler never runs, for both invalidity modes: a tampered token, and a valid token issued to a different session.
- [ ] A urlencoded POST with a valid `_csrf` reaches the handler exactly once, with both `:id` and `:recipeId` intact.
- [ ] The test file includes a control case proving that with the route-level check removed the same forged multipart POST **does** reach the handler (so the rejection assertions cannot pass vacuously).
- [ ] The test harness binds `127.0.0.1` port `0` and skips (does not fail) where listeners are forbidden; it binds no unix socket.

Tier 2 — the three additive routes:

- [ ] `POST /cookbooks/:id/recipes/:recipeId` chain is `requireAuth` → exact `csrfProtection` → `cookbookLimiter` → handler.
- [ ] `POST /api/meal-plans/:id/recipes/:recipeId` chain is `requireApiAuth` → exact `csrfProtection` → `mealPlanApiLimiter` → handler.
- [ ] `POST /api/likes/:recipeId` chain is `requireApiAuth` → exact `csrfProtection` → `likeLimiter` → handler.
- [ ] `GET /api/likes/:recipeId` still has no auth or CSRF middleware (the public like count is unchanged).
- [ ] `POST /api/meal-plans`, `DELETE /api/meal-plans/:id/recipes/:recipeId`, `DELETE /api/likes/:recipeId` and `DELETE /api/tags/:id` are **unchanged**, with the reason recorded in a comment or test annotation.

Scope discipline:

- [ ] `git diff --stat` shows changes only to the four route files, the four test files and the documentation files listed under *Affected files*. Zero lines changed in `src/middleware/csrfMiddleware.js`, `src/app.js`, `src/routes/recipeRoutes.js`, any `views/**`, any `public/js/**`, `package.json` or `database/migrations/**`.
- [ ] No handler body, ownership filter, UUID guard, validator, flash string, redirect target or rate-limiter configuration is modified anywhere in the diff.
- [ ] `cookbookVisibilityRoutes.test.js` and `mealPlanVisibilityRoutes.test.js` pass **unmodified** (their `stack.length === 3` assertions confirm the visibility routes stayed out of scope).
- [ ] No test assertion anywhere in the repo is weakened, skipped or deleted to accommodate this change.

Audit deliverable (REW-102's actual unmet criterion):

- [ ] The audit covers all 43 mutating handlers in `src/routes/` (39 `router.post` + 4 `router.delete`), each classified (a) already protected, (b) exploitable, or (c) not exploitable with a concrete reason, and is published in `docs/api/README.md` and on the Confluence page.
- [ ] The three corrections to REW-101's audit are recorded with their reasons: `POST /admin/login` mutates via `deny()` → `clearAuthCookies` even with an unparsable body; the two visibility routes are gated only by a thrown `TypeError`, not by validation, and would forcibly un-share if `req.body` were `{}`; `POST /auth/reset-password/session` is verified safe.
- [ ] The Tier 3 recommendation (a new ticket for `POST /auth/logout`, `POST /admin/logout`, `POST /admin/login`) is reported to the user, with the note that the Architect cannot file it.

Testing and manual verification:

- [ ] `npm test` passes, with the pre-existing `src/csrf.integration.test.js` `EACCES /tmp/*.sock` failures (REW-90/REW-98) as the only Windows failures, and the total test count reported before and after.
- [ ] Manual: removing a recipe from a meal plan via the card's Remove button still works (confirm dialog, "Removed from <plan>." flash, redirect to `/meal-plans/:id`), and the recipe itself still exists.
- [ ] Manual: adding a recipe to a cookbook from `views/recipes/view.ejs`, the "+ Meal Plan" modal add, and the like/unlike toggle all still work in a browser (these exercise the urlencoded `_csrf` form path and the `x-csrf-token` fetch path).
- [ ] Manual: an authenticated `multipart/form-data` POST with no token to `/meal-plans/:id/recipes/:recipeId/remove` (e.g. `curl -F ignored=1` with the session cookies) returns 403 and the membership row still exists.
- [ ] Manual (carried over, still owed from REW-101 — QA never ran): Delete still works from the recipe detail page, My Recipes, My Favorites, a Cookbook page and a Meal Plan page.
