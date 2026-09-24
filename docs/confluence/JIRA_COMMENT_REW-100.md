# Jira Comment for REW-100

*Posted to the REW-100 Jira issue on 2026-09-23. Status deliberately left **In Progress**.*

---

## Implemented, Reviewed and Documented — QA Not Run, Migration 021 Not Applied

Cookbook membership is no longer own-recipes-only. `POST /api/cookbooks/:id/recipes/:recipeId` now
accepts the caller's own recipe at any status **or** any user's `status = 'published'` recipe, and
migration `021` widens the `cookbook_recipes` INSERT policy to the same rule. The
cookbook-ownership half of both checks did not move. Reviewer **approved over two rounds with no
blocking issues.**

**Why this is not Done:**

- **The QA stage was deliberately excluded from this run. QA did not run.** No browser pass, no live
  database, nothing exercised against a real Supabase project.
- **Migration `021` has not been applied to any Supabase project. `020` remains the highest applied
  migration.** Every "live" acceptance criterion is therefore unverified.
- **As of 2026-09-23 the change is committed on branch `REW-100-add-published-recipe-to-cookbook`
  and nowhere else** — not pushed, no pull request, not merged. Read that as a point-in-time
  statement; re-check the branch rather than trusting this line on a later date.

**Deploy-ordering gate — please read before shipping.** Apply `021` in the Supabase SQL editor
(after `020`) **before or together with the application deploy, never after it.** The handler now
accepts another user's published recipe and hands it straight to the `cookbook_recipes` upsert, so if
the app ships while `021` is unapplied, `010`'s still-in-force `WITH CHECK` rejects the insert and
the user gets `500 {"error":"Failed to add recipe to cookbook"}` where today they get a clean
`404 {"error":"Recipe not found"}` — a worse failure than the bug being fixed. Nothing is written in
either case, so there is no data-integrity risk.

**What shipped (database):** `database/migrations/021_allow_published_recipes_in_cookbooks.sql`
(new). Drops and recreates the `cookbook_recipes` INSERT policy, **keeping its name** (`012`'s
analogous policy is likewise named "own" while admitting published rows). The cookbook-ownership
`EXISTS` is unchanged from `010`; the recipe `EXISTS` widens to
`(recipes.user_id = auth.uid() OR recipes.status = 'published')`, with the `OR` **strictly inside
that `EXISTS`** — a top-level `OR` would let a user insert into a cookbook they do not own, and a
test is written so that mistake would fail. Mirrors migration `012`'s `meal_plan_recipes` precedent.
Untouched: `010`'s SELECT and DELETE policies (still cookbook-owner-scoped, so a recipe's author
still cannot read or remove anything inside someone else's cookbook), both REW-19 public SELECT
policies from `019`, and every policy, grant and column on `recipes`. No schema, index, grant,
function or cascade change. Carries a `ROLLBACK:` block that deletes nothing. **This knowingly
supersedes migration `010`'s header claim that own-recipes-only holds "even if application code were
buggy"; `021`'s header says so out loud, and `010` itself was not edited.**

**What shipped (application):**

- `src/routes/cookbookApiRoutes.js` — `handleCookbookRecipeAdd` selects `id, user_id, status`
  filtered on `id` only, then decides own-or-published with an explicit in-handler predicate,
  deliberately independent of RLS so the two layers keep failing separately. Every reject path
  (lookup error, no row, another user's draft) still returns the identical
  `404 {"error":"Recipe not found"}` with no write — no `403`, no "this recipe is private", so the
  endpoint is not an existence oracle. Middleware unchanged: `requireApiAuth` → `csrfProtection` →
  `cookbookApiLimiter` → handler, with the layer-order test passing **unmodified**. Both UUID
  guards, the cookbook lookup, the `ignoreDuplicates` upsert and the response shape are untouched.
- `views/partials/recipe-summary-card.ejs` — a non-owner viewing a card for an unpublished recipe now
  gets a `disabled`, status-free heart labelled exactly "Favorites are unavailable for this recipe";
  the owner keeps the original explanatory label. Defence in depth rather than a reachable UI state
  (another user's draft row is invisible under `001`, `getCookbookRecipes` drops null embeds, and
  `/recipes/liked` filters on published), so the REW-88 follow-up's reachability claim was wrong —
  the fix was made anyway and pinned with a render test. **The copy is the planner's assumption and
  still needs product confirmation.**
- `src/routes/cookbookRoutes.js` — **comments only.** `POST /cookbooks/:id/recipes/:recipeId` and
  `POST /cookbooks/:id/add-recipes` deliberately stay own-recipes-only, because their only entry
  points are owner-gated and an application check narrower than RLS is always safe. Their comments now
  record that those `.eq("user_id", …)` filters are the **only** thing enforcing that, since RLS now
  admits strictly more.

**What shipped (tests):** +5 cases. `src/routes/cookbookApiRoutes.test.js` is now 19 — another user's
published recipe accepted with the same upsert arguments; another user's draft rejected with the
generic 404 and never reaching `cookbook_recipes`; the lookup filtering on `id` only while the handler
still decides own-or-published; plus a migration-content assertion on `021` (drops and recreates the
INSERT policy, carries the `auth.uid()` cookbook clause and the own-or-published recipe clause,
creates no SELECT/DELETE policy, issues no `GRANT`/`ALTER TABLE` against `recipes`, and would catch a
top-level `OR EXISTS`). `src/views/recipeCard.test.js` is now 28, covering the neutral non-owner
heart. One existing filter assertion was re-pointed; the middleware-order test was not touched.

**Testing:** `npm test` on Windows — **554 tests, 552 pass, 2 fail.** The 2 failures are the
pre-existing environmental `listen EACCES /tmp/rew71-*.sock` cases in
`src/csrf.integration.test.js` (REW-98), confirmed identical on a clean checkout of `main`. A fully
green Linux run is still wanted before merge. **Unverified, and not verifiable until `021` is
applied:** the direct PostgREST insert matrix under RLS (published accepted, another user's draft
rejected, non-owned cookbook rejected), direct-SQL confirmation that another user's draft is still
refused, the mixed-ownership render of `/cookbooks/:id`, the author's inability to read or delete from
someone else's cookbook, the `/c/:id` render-then-disappear behaviour when the author flips a recipe
Private, and the end-to-end `+ Cookbook` click from My Favorites.

**Known, accepted edge case — filed as REW-109.** Once a cookbook can hold another user's recipe, that
author can later make it Private. The membership row survives (the same gap already documented for
`recipe_likes` and `meal_plan_recipes`), the recipe silently disappears from `/cookbooks/:id`, but
`getCookbookRecipeCounts` counts membership rows with no visibility check — so `/cookbooks` can
advertise "3 recipes" for a cookbook whose detail page renders 2. No privacy consequence: only the
integer is wrong. Accepted here rather than fixed, matching how the analogous `recipe_likes` gap was
handled.

**Documentation updated:** `database/README.md` (migration table row `21`, the `cookbook_recipes` and
`meal_plan_recipes` Security bullets, the `cookbooks`/`cookbook_recipes` table prose, the REW-100
notes with the Private-after-add gap and the unapplied-migration status, the deploy-ordering gate, and
a REW-100-only rollback snippet); `docs/api/cookbooks.md`; `docs/api/cookbook-card.md`;
`docs/api/my-recipes-card.md`; `docs/api/README.md`; `README.md` (new feature section, security
bullet, plus corrections to the REW-62 cookbook bullet and the meal-plan own-or-published bullet);
`docs/RELEASE_NOTES_REW-100.md`.

**Confluence:** [Release: REW-100 - Allow Adding Another User's Published Recipe to a Cookbook](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/35586049) ·
[REW-100 plan page, updated as-shipped](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/35487745) ·
[Cookbooks (REW-62, REW-19)](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25067521) —
"Key behaviors" and "Security model" corrected, since both described cookbook membership as
own-recipes-only.

**Still needs a human:** apply `021` respecting the deploy-ordering gate; run QA against the live
criteria above; confirm the neutral heart copy with product; decide whether REW-109 is scheduled
before or after this ships; push, open a PR and merge, then correct the merge-status lines here and on
the Confluence release page.

---
