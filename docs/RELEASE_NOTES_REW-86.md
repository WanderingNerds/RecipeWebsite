# Release Notes: REW-86 - Standardize My Recipes Recipe Card Content & Actions

**Date:** 2026-09-15
**Jira:** [REW-86](https://wanderingnerds.atlassian.net/browse/REW-86) (parent epic [REW-2](https://wanderingnerds.atlassian.net/browse/REW-2))
**Branch:** `REW-86-standardize-my-recipes-card`
**Status:** implemented, reviewer-approved after three rounds. **QA was not run.** Not committed, not merged.

## Summary

Every recipe card on **My Recipes** (`/recipes`) now carries the same content and the same set of
actions. Three things were genuinely missing and are added here: an owner-level Private/Public
control on the card, a `+ Cookbook` action, and a Share placeholder. A fourth requirement — the
`Prep Time:` / `Cook Time:` / `Servings:` / `Difficulty:` label format — is a relabel of the
existing metadata row.

My Recipes and Browse share one template (`views/partials/recipe-summary-card.ejs`). Browse cards
gain none of the owner controls; everything new sits behind the existing `isPublic === false`
branch, including for a signed-in owner viewing their own recipe on `/browse`.

## User impact

- A card shows: clickable title, favorite heart, Private/Public control, author, categories, tags,
  `Prep Time:`, `Cook Time:`, `Servings:`, `Difficulty:`, `+ Meal Plan`, `+ Cookbook`, Share, Edit,
  Delete. Empty metadata fields render no stray label.
- **Visibility from the card.** The old read-only status pill is replaced by a labelled control: the
  current state plus one "Make Public" / "Make Private" button, with a confirmation message worded
  in Private/Public terms. Toggling while a category or tag filter is active returns to the same
  filtered list.
- The favorite heart stays disabled on a Private recipe, with its explanatory title — favoriting
  requires a Public recipe. Because the toggle re-renders the page rather than updating in place,
  the heart's state stays correct immediately after a flip.
- **`+ Cookbook`** opens a modal listing the user's cookbooks with add/remove toggles and an inline
  "+ New cookbook" quick-create that creates the cookbook and adds the recipe in one action. Adding
  the same recipe twice is a no-op, not an error.
- **Share is visible but inert.** It performs no navigation and no request and exposes no URL. Real
  sharing behavior is [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18).

## Technical impact

- **New route `POST /recipes/:id/visibility`** (`src/routes/recipeRoutes.js`), mounted
  `requireAuth` → `csrfProtection` → `visibilityLimiter` (60 / 15 min per IP) → handler. Exported
  as `handleRecipeVisibilityUpdate` with an injectable Supabase client, so it is unit-testable
  without a live database. `handleRecipeUpdate` is untouched; the full edit form still owns
  form-level visibility.
- **Fail closed.** `visibility` always goes through `normalizeRecipeVisibility` — missing,
  array-shaped, wrong-case, or forged values resolve to `draft` (Private). This is the REW-85 rule
  and it does not regress here.
- **Ownership is not probeable.** The update is filtered by both `id` and `user_id` on top of RLS;
  a non-UUID id short-circuits before any query; a real database error and a not-found/not-owned
  row are logged as distinct events but produce an identical user-facing message.
- **No open redirect.** `buildRecipesListPath` (also exported) builds the post-toggle destination
  from a hard-coded `/recipes` literal plus, at most, the whitelisted `category` and `tags` values,
  percent-encoded through `URLSearchParams`. Non-strings and oversize values are dropped. No
  caller-supplied return URL is ever accepted.
- **New `src/routes/cookbookApiRoutes.js`**, mounted at `/api/cookbooks` — owner-scoped JSON API:
  list-with-membership, quick-create, duplicate-safe add
  (`upsert … ignoreDuplicates: true`), and remove. Mutations run
  `requireApiAuth` → `csrfProtection` → `cookbookApiLimiter` (30/min per user). `GET /` carries no
  CSRF check by design, since it changes nothing. Authorization reproduces the existing form route:
  the cookbook and the recipe must both belong to the caller; not-found and not-owned are the same
  `404`.
- **Refactor: `createRequireApiAuth({ logLabel, authClient })`** extracted into
  `src/middleware/authMiddleware.js`. `likeRoutes.js`, `mealPlanApiRoutes.js`, and
  `cookbookApiRoutes.js` each carried a verbatim copy; all three now consume the shared factory.
  Behavior is identical — same `401` bodies (client code branches on them), same middleware name,
  and each mount point keeps its own log label.
- **Client:** `views/partials/cookbook-modal.ejs` (included once in `views/layouts/main.ejs`, gated
  on `user`) and `public/js/cookbooks.js`. The JS stays an external file because helmet's CSP is
  `script-src 'self'`; its fetches inherit the `x-csrf-token` header from the `main.js` wrapper, and
  cookbook titles render via `textContent`, never `innerHTML`.
- `views/recipes/index.ejs` now passes `selectedCategory` / `selectedTags` into the card partial so
  the toggle form can round-trip the active filter. `public/css/styles.css` gains card-scoped
  visibility-control rules only; card sizing is untouched and stays with REW-82.

## Database changes

**None.** No migration, no backfill, no policy change, no new index, no grant change. Every
operation touches only the signed-in user's own rows and is already covered by existing RLS: the
toggle updates an owned `recipes` row (migration `001`), and `+ Cookbook` inserts an owned recipe
into an owned cookbook (migration `010`). See the REW-86 note in `database/README.md`.

## API changes

- **Added:** `POST /recipes/:id/visibility` (form post, redirect + flash).
- **Added:** `GET /api/cookbooks?recipeId=`, `POST /api/cookbooks`,
  `POST /api/cookbooks/:id/recipes/:recipeId`, `DELETE /api/cookbooks/:id/recipes/:recipeId`.
- **Unchanged:** every existing route, including all `/cookbooks*` form routes and
  `POST /recipes/:id/update`. No response shape was modified, so this is not a breaking change for
  any existing client.

## Decisions and tradeoffs

- **Form POST + redirect instead of AJAX for the toggle.** Flipping a recipe to Private must also
  disable the favorite heart on the same card; a full re-render gets that consistency for free,
  whereas AJAX would mean re-deriving heart and badge state client-side. The cost is a page
  navigation per toggle.
- **The cookbook API was built here rather than inherited from REW-59.** The plan preferred reusing
  REW-59's API if it had merged. It hasn't, so REW-86 built its own, owner-scoped version. This is a
  known duplication (see "Follow-ups").
- **Owner-only cookbook adds.** Adding *other* users' Public recipes to a cookbook would need
  REW-59's RLS widening. Every card on My Recipes is owned by the viewer, so the narrow rule is
  sufficient and keeps this ticket migration-free.
- **Route-level CSRF instead of fixing the global wrapper.** `csrfProtectionExceptMultipart` exempts
  every multipart POST repo-wide. Both new surfaces re-apply `csrfProtection` explicitly (before
  their rate limiter, so a forged request can't burn the victim's quota). The central fix was
  deliberately left to REW-99 rather than attempted inside a card-standardization ticket.
- **Share ships inert rather than "enabled with a coming-soon message."** An inert control cannot
  leak a URL or imply a Private recipe is reachable.
- **Sizing left alone.** Seven controls now share the action row; they wrap using existing
  `.recipe-summary-actions` rules. Cross-surface sizing belongs to REW-82.

## Validation

- `npm test`: **485 tests, 483 passing, 2 failing.** Both failures are pre-existing environmental
  `EACCES /tmp/*.sock` unix-socket errors in `src/csrf.integration.test.js` on Windows, unrelated to
  this change and tracked as [REW-98](https://wanderingnerds.atlassian.net/browse/REW-98).
- Code review: **approved after three rounds.**
- New coverage: `src/routes/recipeVisibilityToggle.test.js` (11 cases),
  `src/routes/cookbookApiRoutes.test.js` (15 cases), `src/middleware/authMiddleware.test.js`, and
  updates to `src/views/recipeCard.test.js`.

**QA was not run for this change.** The pipeline run that produced it deliberately excluded the QA
stage. No browser pass and no live-Supabase verification were performed, so the plan's
acceptance criteria are not confirmed — specifically the end-to-end Make Public / Make Private round
trip and its effect on `/browse` and `/r/:id`, the filter-preserving redirect in a real browser,
the `+ Cookbook` double-click no-op against real data, CSRF rejection and rate limiting on the live
endpoints, keyboard reachability and focus visibility, and action wrapping at 375px. These need a
manual pass before the feature is treated as verified.

## Deployment

Standard application deployment. No migration to run, no new environment variable, no new package,
and no Vercel configuration change.

## Follow-ups

- [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18) — real Share behavior.
- [REW-99](https://wanderingnerds.atlassian.net/browse/REW-99) —
  `csrfProtectionExceptMultipart` exempts every multipart POST repo-wide; deliberately deferred.
- [REW-98](https://wanderingnerds.atlassian.net/browse/REW-98) — Windows unix-socket test failures.
- [REW-59](https://wanderingnerds.atlassian.net/browse/REW-59) — still In Progress on its own
  branch with competing edits to the same card partial. **Expect a merge conflict on
  `views/partials/recipe-summary-card.ejs` and a probable duplicate cookbook API and modal.**
  Whoever merges second must reconcile them rather than keeping both.
- [REW-82](https://wanderingnerds.atlassian.net/browse/REW-82) — cross-surface card sizing.

## Related documentation

- [My Recipes Recipe Card](api/my-recipes-card.md)
- [Recipe Visibility](api/recipe-visibility.md)
- [Cookbooks API](api/cookbooks.md)
- [API Overview](api/README.md)
- [Database notes](../database/README.md)
- Implementation plan: `docs/plans/rew-86-standardize-my-recipes-card.md`
