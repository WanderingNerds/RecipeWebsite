# Release Notes: REW-100 - Allow Adding Another User's Published Recipe to a Cookbook

**Date:** 2026-09-23
**Jira Issue:** [REW-100](https://wanderingnerds.atlassian.net/browse/REW-100) (Task, Medium, epic [REW-2](https://wanderingnerds.atlassian.net/browse/REW-2))
**Branch:** `REW-100-add-published-recipe-to-cookbook` (from `main` at `0a7a10b`)
**Pipeline:** Planner → Developer → Reviewer (**Approved over two rounds, no blocking issues**) → Documentation.
**The QA stage was deliberately excluded from this run.** QA did not run.
**Confluence:** [Release: REW-100](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/35586049) ·
[REW-100 plan page](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/35487745) ·
[Cookbooks (REW-62, REW-19)](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25067521)

## Merge status — read as a point-in-time statement

**As of 2026-09-23 this change is committed on the branch above and nowhere else** — not pushed, no
pull request, not merged into `main`. Do not read this line as current on a later date: confirm with
`git merge-base --is-ancestor <commit> main` before relying on it, and correct it here when the
branch lands. ([REW-108](https://wanderingnerds.atlassian.net/browse/REW-108) exists because notes
of exactly this kind were left behind after the work they described had shipped.)

**Migration `021` has not been applied to any Supabase project. `020` remains the highest applied
migration.** See "Deployment" below — the ordering of the app deploy and the migration matters.

---

## Summary

`+ Cookbook` renders on every My Favorites card, including cards for recipes the viewer does not own
(REW-87). Clicking it for someone else's recipe used to fail with a generic `404 Recipe not found`,
surfaced as an error toast. Two layers enforced own-recipes-only and both moved together:

1. The application check in `handleCookbookRecipeAdd` (`src/routes/cookbookApiRoutes.js`).
2. The `cookbook_recipes` INSERT policy created by migration `010`.

Each one's **recipe** half is now "the caller's own recipe at any status **or** anyone's
`status = 'published'` recipe". Each one's **cookbook-ownership** half is unchanged: the target
cookbook must still belong to the caller. Migration `012` (`meal_plan_recipes`) is the in-repo
precedent — `+ Meal Plan` has always worked this way — and `021` copies its clause shape verbatim.

This is a **knowing relaxation of a guarantee migration `010` documents as deliberate**. `010`'s
header states that a user cannot add someone else's recipe into their own cookbook "even if
application code were buggy." That sentence is historical from `021` onward. `010` itself was not
edited; it has already been applied.

Nothing about the endpoint's security posture changed. `requireApiAuth` → `csrfProtection` →
`cookbookApiLimiter` → handler, both UUID guards, the cookbook-owner lookup, the duplicate-safe
`ignoreDuplicates` upsert and the JSON response shape are all byte-for-byte as they were, and the
existing middleware layer-order test passes unmodified.

---

## User-Facing Changes

All of the following are **unverified in a browser** — QA did not run, and migration `021` is not
applied anywhere, so the behaviour described in the first bullet cannot happen yet in any live
environment.

- **`+ Cookbook` on another user's Public recipe is now expected to succeed** from My Favorites
  (and any other surface that renders the shared card's `+ Cookbook` action for a recipe you do not
  own). The button flips to "Remove" exactly as it does for your own recipes, and the recipe appears
  on the chosen cookbook's page at `/cookbooks/:id`.
- **A cookbook is now a genuinely mixed-ownership collection**, like a meal plan already was. Cards
  for recipes you do not own keep the title, heart, chips, metadata, `+ Meal Plan`, Share and
  Remove, and show no Edit, no Delete and no Private/Public pill. No view restructuring was needed
  — REW-88 already computed `isOwner` per card.
- **Another user's Private recipe still cannot be added**, at either layer, and the rejection is
  still the same generic "Recipe not found" with no hint that the recipe exists.
- **One copy fix.** A non-owner looking at a card for a recipe that is not published used to get a
  disabled heart labelled "Make this recipe Public to add it to favorites" — an instruction that
  only makes sense to an owner, and a claim about someone else's recipe's visibility. Non-owners now
  get the same disabled heart with neutral wording in both `aria-label` and `title`: **"Favorites
  are unavailable for this recipe"**. The owner keeps the original explanatory label. This is
  defence in depth rather than a currently reachable state (see "Technical Changes").
- **Nothing else changed.** Removing a recipe from a cookbook, deleting a cookbook, cookbook
  sharing, and every recipe's own Private/Public lifecycle behave exactly as before.

---

## Technical Changes

### `database/migrations/021_allow_published_recipes_in_cookbooks.sql` (new)

Drops and recreates exactly one policy — the `cookbook_recipes` INSERT policy — **keeping its name**
(`"Users can insert own cookbook recipes"`), because `012`'s analogous policy is likewise named
"own" while admitting published rows; keeping it avoids leaving documentation pointing at a policy
name that no longer exists and keeps the rollback text simple. `DROP POLICY IF EXISTS` first, so the
file is re-runnable.

In the recreated `WITH CHECK`:

- The cookbook-ownership `EXISTS` is unchanged from `010`.
- The recipe `EXISTS` widens to `(recipes.user_id = auth.uid() OR recipes.status = 'published')`.
- **The `OR` sits strictly inside the recipe `EXISTS`, and the two `EXISTS` clauses are `AND`ed.**
  An `OR` at the top level would let a user insert into a cookbook they do not own. The migration
  header says so explicitly, and a test asserts the SQL's content.

Untouched: `010`'s SELECT and DELETE policies (both still cookbook-owner-scoped, so a recipe's
author still cannot read or remove anything inside someone else's cookbook), both REW-19 public
SELECT policies from `019`, and every policy, grant and column on `recipes` — `001`'s own-or-published
recipes SELECT policy is **not** widened. No table, column, index, grant, function, trigger or
cascade is created or altered. The file carries a `ROLLBACK:` block that restores `010`'s
`WITH CHECK`; a rollback deletes nothing.

### `src/routes/cookbookApiRoutes.js`

`handleCookbookRecipeAdd`'s recipe lookup dropped its `.eq("user_id", req.user.id)` filter. It now
selects `id, user_id, status` filtered on `id` only, and the decision is made by an explicit
in-handler predicate — the caller's own recipe (with a `typeof … === "string"` guard on `user_id`, so
a sparse row is treated as not-owned rather than compared loosely) **or** `status === "published"`.

The predicate is written out in JavaScript on purpose rather than delegated to the `recipes` SELECT
policy the way `mealPlanApiRoutes.js` does: this lookup exists to be an independent second layer, and
an explicit check keeps rejecting non-owned drafts even if a future migration widens recipe
visibility. Every reject path — lookup error, no row, another user's draft — still returns the
identical `404 {"error":"Recipe not found"}` with no write, so the endpoint is not an existence
oracle for other users' recipe ids. There is deliberately no `403` and no "this recipe is private"
message.

Two stale comments were rewritten: the one above the lookup (it cited REW-59 and the My Recipes
surface) and the file-level note above `requireApiAuth`, which asserted this endpoint "only ever
operates on the caller's own cookbooks and own recipes". Router registrations, the limiter,
`csrfProtection`, the cookbook lookup, the upsert and the response shape are unchanged.

### `views/partials/recipe-summary-card.ejs`

The existing `draft` disabled-heart branch is now gated on `isOwner`; a new `else` branch renders the
same `disabled` heart with `aria-label` and `title` both set to "Favorites are unavailable for this
recipe". The heart is kept rendered rather than hidden so the card header row keeps its shape across
a grid, and it is not downgraded to "Favorite this recipe" — that would look live but could never
succeed, since `/api/likes` requires `status = 'published'`.

**This branch is defence in depth, not a reachable UI state, even after `021`.** Another user's draft
row is invisible under `001`'s recipes SELECT policy; `getCookbookRecipes` drops any junction row
whose embedded `recipes` came back null; and `/recipes/liked` filters on `status = 'published'`. The
fix exists so that stays true by construction rather than by luck. The surface comments in the
partial's header block were updated for the same reason ("Owner-only today, MIXED once REW-100
lands" is no longer accurate).

`showStatusPill`, `showOwnerControls`, `showCookbookAdd`, the Remove form and the rule that a
recipe's `user_id` is never rendered were already correct for a mixed-ownership cookbook and were
left alone.

### `src/routes/cookbookRoutes.js` — comments only

`POST /cookbooks/:id/recipes/:recipeId` and `POST /cookbooks/:id/add-recipes` deliberately **stay
own-recipes-only**. Their only entry points are owner-gated: the "Save to Cookbook(s)" widget sits
inside the `isOwner` branch of `views/recipes/view.ejs`, and the bulk picker lists only the caller's
own recipes. An application check narrower than RLS is always safe.

What changed is prose: two comments claimed RLS also enforces recipe ownership on insert, which stops
being true once `021` is applied. Both now record that these `.eq("user_id", …)` filters are the
**only** thing enforcing own-recipes-only on those routes and must not be removed on the assumption
that RLS still covers them. Handler behaviour is identical.

### Tests (+5 cases)

- `src/routes/cookbookApiRoutes.test.js` — **19 cases.** Added: another user's published recipe is
  accepted and the upsert runs with the same arguments; another user's draft is rejected with the
  generic `404` and never reaches `cookbook_recipes`; the lookup filters on `id` only while the
  handler still decides own-or-published itself. The existing "recipe the caller does not own is a
  404" case kept its no-write and generic-404 assertions with the filter assertion re-pointed at the
  new shape. Also a migration-content assertion: `021` drops and recreates the INSERT policy, carries
  an `auth.uid()` cookbook-ownership clause and an own-or-published recipe clause, creates no SELECT
  or DELETE policy, and issues no `GRANT`/`ALTER TABLE` against `recipes` — **it is written so that a
  top-level `OR EXISTS` would fail it.**
- `src/views/recipeCard.test.js` — **28 cases.** Added: a non-owner rendering a `draft` cookbook card
  gets a `disabled` heart whose `aria-label`/`title` carry no visibility wording and no
  `badge-draft`/`badge-published` markup. The REW-88 owner assertion passes unchanged.
- The middleware layer-order test was **not** modified.

---

## Database Changes

**Yes — one new migration, `database/migrations/021_allow_published_recipes_in_cookbooks.sql`.** One
policy, no schema change. Full detail in `database/README.md` (migration table row `21`, the
`cookbook_recipes` Security bullet, the REW-100 notes, and the REW-100 rollback snippet).

Two consequences worth recording:

- **The two form routes' ownership enforcement is now application-layer only.** RLS admits strictly
  more than they do. Deliberate and safe, but their filters are load-bearing on their own.
- **Known, accepted edge case (Private-after-add).** Once a cookbook can hold another user's recipe,
  that author can later flip it Private. The membership row survives — the same gap already
  documented for `recipe_likes` and `meal_plan_recipes`. The recipe then silently disappears from
  `/cookbooks/:id` (its embed is RLS-hidden and `getCookbookRecipes` drops null embeds), but
  `getCookbookRecipeCounts` counts membership rows with no visibility check, so `/cookbooks` can
  advertise "3 recipes" for a cookbook whose detail page renders 2. Accepted rather than fixed here,
  matching how the analogous `recipe_likes` gap was handled, and filed as
  [REW-109](https://wanderingnerds.atlassian.net/browse/REW-109). No privacy consequence — the
  hidden recipe's title, content and status are never rendered, only an inflated integer.

---

## API Changes

No route added, removed or renamed. No request or response shape changed.

`POST /api/cookbooks/:id/recipes/:recipeId` accepts a strictly wider set of inputs: the recipe may
now be any user's `status = 'published'` recipe, not only the caller's own. Everything else about the
contract — the `200 { added, cookbookId, recipeId, cookbookTitle }` body, the `400` on a malformed
UUID before any query, the `404 {"error":"Cookbook not found"}` for a non-owned or nonexistent
cookbook, the `404 {"error":"Recipe not found"}` for every recipe reject, and the `401` JSON for an
unauthenticated call — is unchanged.

The form-based `POST /cookbooks/:id/recipes/:recipeId` and `POST /cookbooks/:id/add-recipes` are
unchanged and remain own-recipes-only, so the JSON API is now deliberately wider than the form
routes.

---

## Testing

`npm test` on Windows — **554 tests, 552 pass, 2 fail.** The 2 failures are the pre-existing
environmental `listen EACCES /tmp/rew71-*.sock` cases in `src/csrf.integration.test.js`, tracked as
[REW-98](https://wanderingnerds.atlassian.net/browse/REW-98) and confirmed identical on a clean
checkout of `main`. Nothing in this change touches that file. Still needs a fully green run on a
Linux runner before merge.

**The QA stage was deliberately excluded from this run — QA did not run.** Every "live" acceptance
criterion in the plan is therefore **unverified**, and cannot be verified until `021` is applied:

- The direct PostgREST insert matrix under RLS: another user's published recipe into a cookbook you
  own succeeds; another user's draft is rejected by Postgres; a cookbook you do not own is rejected
  for both a published and an owned recipe.
- Direct-SQL confirmation that another user's draft is still rejected by the recreated `WITH CHECK`.
- `/cookbooks/:id` rendering correctly for its owner with mixed ownership — card content intact,
  Remove present, Edit/Delete/status pill absent — and Remove taking a non-owned recipe out of the
  cookbook without deleting the recipe.
- `/c/:id` rendering another user's Public recipe inside a shared cookbook to a logged-out visitor,
  and that recipe disappearing from the page and from the public count after its author flips it
  Private.
- A recipe's author being unable to read from, or delete from, someone else's cookbook that contains
  their recipe, attempted through the API rather than the UI.
- End-to-end `+ Cookbook` from a My Favorites card for another user's Public recipe.
- The accepted `/cookbooks` count mismatch (REW-109) — to be confirmed, not fixed.

---

## Documentation

Updated by the Developer during the run, verified accurate in the Documentation pass:
`database/README.md` (migration row `21`, the `cookbooks`/`cookbook_recipes` table prose, the
`cookbook_recipes` and `meal_plan_recipes` Security bullets, the REW-100 notes including the
Private-after-add gap, and the REW-100-only rollback snippet), `docs/api/cookbooks.md`,
`docs/api/cookbook-card.md`, `docs/api/README.md`, `docs/api/my-recipes-card.md`.

Added or corrected in the Documentation pass:

- `README.md` — new "Adding Another User's Public Recipe to a Cookbook (REW-100)" feature section,
  the deploy-ordering gate, a correction to the REW-62 Cookbooks bullet that described a cookbook as
  holding only the owner's own recipes, and the Meal Plans bullet that called own-or-published a
  difference from cookbooks.
- `database/README.md` — the deploy-ordering gate spelled out (app-before-migration turns today's
  clean `404` into a `500`).
- `docs/api/cookbooks.md` — the same gate on the JSON API section, a REW-100 changelog row, migration
  `021` added to the component list, and the `Last Updated` date.
- `docs/api/cookbook-card.md` — a REW-100 status line and the `Last Updated` date.
- `docs/api/my-recipes-card.md` — the stale "No migration" Database section and the stale
  `cookbookApiRoutes.test.js` case count.
- `docs/api/README.md` — the Cookbooks API entry in Detailed Documentation.
- `docs/RELEASE_NOTES_REW-100.md` (this file) and
  `docs/confluence/JIRA_COMMENT_REW-100.md`.

Confluence: a release page was created, the REW-100 plan page was updated with the as-shipped
outcome, and the "Cookbooks (REW-62, REW-19)" feature page's "Key behaviors" and "Security model"
sections were corrected (they described cookbook membership as own-recipes-only).

**Still needs a human:** product confirmation of the neutral heart copy ("Favorites are unavailable
for this recipe" was the planner's assumption, not a product decision), and a decision on whether
REW-109 should be scheduled before or after this ships.

---

## Deployment

**There is a real deploy-ordering gate. Apply migration `021` in the Supabase SQL editor (after
`020`) before or together with the application deploy — never after it.**

The application layer now accepts another user's published recipe and hands it to the
`cookbook_recipes` upsert. If the app ships while `021` is unapplied, that insert is rejected by
`010`'s still-in-force `WITH CHECK`, and the user sees
`500 {"error":"Failed to add recipe to cookbook"}` instead of today's clean
`404 {"error":"Recipe not found"}` — a worse failure than the bug being fixed. Nothing is written in
either case.

Everything else is routine: no backfill, no new environment variable, no new package, no
`vercel.json` change, no new endpoint or client request. Rollback is the snippet in the migration
header and in `database/README.md`'s Rollback section; it deletes nothing, and the application must
be reverted alongside it for the same reason as above.

---

## Related Tickets

- [REW-87](https://wanderingnerds.atlassian.net/browse/REW-87) — put `+ Cookbook` on non-owned
  My Favorites cards, which is what made this a visible bug.
- [REW-88](https://wanderingnerds.atlassian.net/browse/REW-88) — origin of the disabled-heart label
  follow-up folded into this ticket, and of the per-card `isOwner` contract that made the view side
  of this change a one-branch edit.
- [REW-63](https://wanderingnerds.atlassian.net/browse/REW-63) / migration `012` — the
  own-or-published precedent `021` copies.
- [REW-109](https://wanderingnerds.atlassian.net/browse/REW-109) — cookbook recipe count on
  `/cookbooks` ignores recipe visibility. Filed during this run; accepted and documented here, not
  fixed.
- [REW-98](https://wanderingnerds.atlassian.net/browse/REW-98) — the two Windows-only
  `EACCES /tmp/*.sock` test failures.
- [REW-91](https://wanderingnerds.atlassian.net/browse/REW-91) — cookbook-level cloning. Unrelated
  but adjacent: this change lets you put someone else's Public recipe in your cookbook, not copy it
  into your account.
