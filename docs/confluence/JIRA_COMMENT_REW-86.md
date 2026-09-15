# Jira Comment for REW-86 Documentation

REW-86 standardizes the My Recipes recipe card: every owner card now shows a clickable title, the favorite heart, an owner-only Private/Public control, author, categories, tags, `Prep Time:` / `Cook Time:` / `Servings:` / `Difficulty:`, `+ Meal Plan`, `+ Cookbook`, Share, Edit, and Delete. Browse renders the same shared partial and gains none of the owner controls.

Two new server surfaces back this. `POST /recipes/:id/visibility` flips one recipe between Private and Public behind `requireAuth` → `csrfProtection` → a 60-per-15-minutes limiter; it fails closed to Private through `normalizeRecipeVisibility`, scopes the update by both `id` and `user_id`, treats not-found and not-owned identically, and rebuilds its redirect server-side on a hard-coded `/recipes` path from whitelisted `category`/`tags` values only. A new owner-scoped JSON API at `/api/cookbooks` (list-with-membership, quick-create, duplicate-safe add, remove) backs the `+ Cookbook` modal; its mutations run `requireApiAuth` → `csrfProtection` → a 30-per-minute-per-user limiter, while the non-mutating list endpoint carries no CSRF check by design. `requireApiAuth` itself was extracted into a shared `createRequireApiAuth` factory now used by the like, meal-plan, and cookbook API route files — identical behavior, log labels preserved.

Share ships deliberately inert: no link, no request, no URL exposed. Real sharing behavior stays with REW-18.

**No database migration.** Every operation touches only the signed-in user's own rows and is already covered by existing RLS (migration 001 for the recipe update, migration 010 for cookbook membership). No new environment variable, package, or Vercel configuration change.

Review is approved after three rounds. `npm test` reports **485 tests, 483 passing, 2 failing**; both failures are pre-existing environmental unix-socket errors in `src/csrf.integration.test.js` on Windows, tracked as REW-98.

**QA was not run for this change**, and the branch is neither committed nor merged, so the acceptance criteria are unverified — specifically the end-to-end Make Public / Make Private round trip and its effect on `/browse` and `/r/:id`, the filter-preserving redirect in a browser, the `+ Cookbook` double-click no-op against real data, live CSRF rejection and rate limiting, keyboard reachability and focus visibility, and action wrapping at 375px. Status stays In Progress.

Known follow-ups: REW-99 (the global `csrfProtectionExceptMultipart` exempts every multipart POST repo-wide — deliberately deferred, worked around at the route level here), REW-98, REW-18, and REW-82. REW-59 is still In Progress with competing edits to `views/partials/recipe-summary-card.ejs` and its own cookbook API/modal — expect a merge conflict and a probable duplicate; whoever merges second must reconcile rather than keep both.

- Plan: https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/31391745
- Release notes: https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/31490049
