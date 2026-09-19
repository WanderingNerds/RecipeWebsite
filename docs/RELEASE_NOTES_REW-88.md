# Release Notes: REW-88 - Standardize Cookbook Recipe Card Content & Actions

**Date:** 2026-09-15
**Jira:** [REW-88](https://wanderingnerds.atlassian.net/browse/REW-88) (parent epic [REW-2](https://wanderingnerds.atlassian.net/browse/REW-2))
**Branch:** `REW-88-standardize-cookbook-recipe-card`
**Status:** implemented and reviewer-approved, no blocking issues. **QA was deliberately skipped on this run.** The branch is unmerged and unpushed.

## Summary

Recipe cards inside a cookbook (`/cookbooks/:id`) now look and behave like every other standardized
card on the site. The page used to hand-roll its own card with `Prep:` / `Cook:` / `N servings`
labels, no difficulty, no tags, no favorite heart, and no Edit, Delete or Share.

This is not a new card. REW-86 and REW-87 already built every control the ticket asks for inside
`views/partials/recipe-summary-card.ejs`, so REW-88 teaches that shared partial a fourth surface
(`'cookbook'`), points the cookbook page at it, and widens the route query so the card receives the
columns it needs. Two things make this surface different: `+ Cookbook` is suppressed, because the
recipe is already in a cookbook, and the page-specific **Remove from cookbook** action is carried
into the shared card.

## User impact

- A cookbook card now shows: thumbnail, clickable title, favorite heart, author, `Adapted from`
  attribution on clones, category and tag chips, and `Prep Time:` / `Cook Time:` / `Servings:` /
  `Difficulty:` metadata in the same format as Browse and My Recipes. Empty fields render no stray
  label.
- Actions on the card: `+ Meal Plan`, Share, Remove, and — only for a recipe the viewer owns —
  Edit and Delete.
- **`+ Cookbook` is deliberately absent.** The recipe is already in a cookbook.
- **Remove is unchanged in behavior.** It still removes only the cookbook membership, never the
  recipe, still returns to the cookbook page, and still has its own distinct confirm wording. It is
  ordered so that Edit sits between Remove and Delete, so "take this out of the cookbook" and
  "delete this recipe forever" are never adjacent taps, and Delete stays the only red control.
- **The owner still sees a read-only Private/Public pill.** It tells the owner that a Private recipe
  will not appear to the people they share the cookbook with (REW-19). Nobody but the owner sees it.
- **The favorite heart is disabled on a Private recipe**, with its explanatory title, because
  favoriting requires a published recipe.
- **Share is visible but inert.** No navigation, no request, no URL exposed. Real sharing is
  [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18).
- Browse, My Recipes, and My Favorites cards are unchanged.

## Technical impact

- **`views/partials/recipe-summary-card.ejs`** — added the fourth `surface` value, `'cookbook'`.
  The favorite heart and the read-only status pill used to be a single either/or decision; they are
  now two independent flags (`showFavoriteHeart = !isBrowse`,
  `showStatusPill = isBrowse || (isCookbook && isOwner)`) rendering into the same header row, so a
  cookbook card can show both. Added `showCookbookAdd = !isBrowse && !isCookbook`, a new optional
  `cookbookId` local (resolved internally to `cardCookbookId`), and a fourth `else if (isCookbook)`
  action-row branch. A fourth branch cannot regress the other three; unifying the rows belongs to
  REW-82.
- **The three existing surfaces are output-stable.** The old heart condition was
  `!showStatusPill = !isBrowse`, which is exactly the new `showFavoriteHeart`; `showStatusPill`
  reduces to `isBrowse` off the cookbook surface; and `showCookbookAdd` is `true` on both branches
  that previously drew the button. The reviewer verified byte-identical output across eight
  browse/my-recipes/favorites permutations.
- **`views/cookbooks/view.ejs`** — the inline card block is gone, replaced by an include passing
  `recipe`, `surface: 'cookbook'`, and `cookbookId: cookbook.id`. The page header, the
  cookbook-level Public/Private control, the share panel, the `organization-card-grid` wrapper, the
  empty state, and the `cookbook-share.js` tag are untouched.
- **`src/routes/cookbookRoutes.js`** — new `COOKBOOK_CARD_COLUMNS` widens the nested `recipes(...)`
  select with `user_id`, `original_author`, and the embedded
  `recipe_categories(categories(...))` / `recipe_tags(tags(...))` relations, mirroring
  `FAVORITE_CARD_COLUMNS`. `getCookbookRecipes` is now exported and flattens the junction rows into
  flat `categories` / `tags`, keeping its defensive drop of a null `recipes` embed and its
  added-to-cookbook ordering. `GET /:id` was extracted into an exported
  `handleCookbookView(req, res, { createClient })` with an injectable client so the data contract is
  testable without a live Supabase; it stamps `isLiked` from a single batched `recipe_likes` query
  and skips that query entirely for an empty cookbook.
- **No N+1.** One cookbook read, one recipe read, one likes read, regardless of cookbook size.
- **No new endpoint, no new rate limiter, no middleware change.** helmet, CORS, `csrf-csrf`,
  `express-rate-limit`, and the auth middleware are untouched. `GET /cookbooks/:id` still runs
  behind `requireAuth` after the handler extraction, and every mutation handler, limiter, and UUID
  guard is unchanged.
- **No CSS was added.** The five-control action row wraps using the existing
  `.recipe-summary-actions` rules; cross-surface sizing stays with REW-82.

## Database changes

**None.** No migration, no backfill, no policy change, no new index, no grant change. Every column
the widened select adds is already readable under applied policies: migration `001` (own rows plus
any published row, all columns), migrations `005`/`006` (owner SELECT on the junction tables, which
is what makes chips readable on the owner's Private recipes), and migration `013` (published-recipe
SELECT for `anon`/`authenticated` plus the matching `categories`/`tags` lookups). `recipe_likes` is
read on the request-scoped client and already RLS-scoped to the caller.

## API changes

**None that break a client.** No route was added, removed, or renamed, and no JSON response shape
changed.

- `GET /cookbooks/:id` — same URL, same middleware, same auth, same redirects. Only the shape of the
  data handed to the template changed (more recipe columns, flattened `categories`/`tags`, a new
  `isLiked` flag per recipe).
- The shared card partial's **local-variable contract** did change and is the most
  documentation-worthy surface here: `surface` now takes four values, and there is a new optional
  `cookbookId` local. Documented in `docs/api/cookbook-card.md`.

## Decisions and tradeoffs

- **The read-only Private/Public pill was kept, gated on `isOwner`** — a deliberate deviation from
  the ticket's requirement list, which does not mention a status pill. A cookbook can hold the
  owner's Private recipes, and REW-19 filters those out of the shared `/c/:id` view, so the pill is
  the only place the owner learns that. Deleting it silently would regress REW-19. The reviewer
  flagged this as a non-blocking should-fix and asked for explicit product sign-off; it is a
  one-flag revert if rejected.
- **No Private/Public toggle on this surface.** The ticket omits it, and REW-87 set the precedent
  that owners flip visibility from My Recipes.
- **Remove was moved into the shared card, not left beside it**, keeping its hidden `_csrf`, its
  hidden `returnTo=cookbook`, and its distinct confirm copy. It renders only when `cookbookId` is
  supplied, so a caller that forgets it degrades to a missing button rather than a broken URL.
- **Ownership is computed per card even though it is uniform today.** The `cookbook_recipes` INSERT
  policy still enforces own-recipes-only, so `isOwner` is always true right now. REW-100 changes
  that, and computing it per card now means REW-100 needs no view change.
- **Chips are static text, not links**, because `/recipes?category=` filters *your own* recipes.
- **The public `/c/:id` view was left alone.** It renders the lightweight `recipe-card.ejs` partial
  and is anonymous-capable, so most of this card's controls do not apply there.
- **The CSRF gap on `POST /recipes/:id/delete` was flagged, not fixed.** A security fix does not
  belong inside a card-layout ticket; filed as
  [REW-102](https://wanderingnerds.atlassian.net/browse/REW-102).
  *(Later note, 2026-09-19: fixed by [REW-101](https://wanderingnerds.atlassian.net/browse/REW-101)
  on branch `REW-101-recipe-delete-csrf-protection` — reviewed, QA skipped, not pushed or merged;
  REW-102 is linked as its duplicate. Left as the point-in-time record.)*

## Validation

- `npm test`: **510 tests, 508 passing, 2 failing.** Both failures are in
  `src/csrf.integration.test.js` (`listen EACCES /tmp/rew71-*.sock`) — a file untouched by this
  change, failing because Windows cannot bind unix-domain sockets. Pre-existing and environmental,
  not a regression; tracked as [REW-98](https://wanderingnerds.atlassian.net/browse/REW-98).
- Code review: **approved, no blocking issues**, so no bug tickets were filed.
- New coverage: `src/routes/cookbookRoutes.test.js` (10 cases). Updated: `src/views/recipeCard.test.js`
  (the single old cookbook test replaced by five broader ones) and `src/views/cookbookSharing.test.js`
  (source-text assertion moved to a rendered-output assertion plus a form-scoped `doesNotMatch` —
  strengthened, not loosened). The Browse, My Recipes, Favorites, and REW-86 leak tests pass
  unmodified.

**QA was deliberately skipped on this run.** No browser pass and no live-Supabase verification were
performed, so the plan's manual acceptance criteria are unverified: the heart toggle surviving a
reload, `+ Meal Plan` against real data, the Remove round trip leaving the recipe intact,
Edit/Delete from this page, 375px wrapping of the five-control action row, keyboard reachability and
focus visibility, and the crafted cross-user `POST` checks on remove and delete. **Do not describe
this change as QA-verified.**

## Deployment

Standard application deployment. No migration to run, no new environment variable, no new package,
and no Vercel configuration change.

**Before merge:** load a real cookbook containing a recipe with both tags and categories against a
live Supabase. `getCookbookRecipes` is the repo's first three-level PostgREST embed
(`cookbook_recipes` → `recipes` → `recipe_categories` → `categories`), and its error path returns
`[]`, which renders as "No recipes in this cookbook yet" with no flash — a silent failure mode. The
reviewer called this out specifically because QA was skipped.

## Follow-ups

- **Product sign-off on the owner-only status pill**, which is not in the ticket's acceptance
  criteria.
- [REW-100](https://wanderingnerds.atlassian.net/browse/REW-100) — the disabled heart's
  `aria-label`/`title` ("Make this recipe Public to add it to favorites") is itself a status claim.
  It is unreachable today but becomes reachable once other users' published recipes can enter a
  cookbook; the reviewer recommended gating that branch on `isOwner` and folding the fix into
  REW-100.
- [REW-102](https://wanderingnerds.atlassian.net/browse/REW-102) — route-level `csrfProtection` on
  `POST /recipes/:id/delete`. *(Later note, 2026-09-19: addressed by REW-101, on branch, unmerged.)*
- [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18) — real Share behavior.
- [REW-82](https://wanderingnerds.atlassian.net/browse/REW-82) — cross-surface card sizing; the
  action row now carries five `flex: 1` controls and is worth an eyeball at 375px.
- [REW-89](https://wanderingnerds.atlassian.net/browse/REW-89) — the Meal Plan card, built so it can
  adopt the same partial without another rewrite.
- [REW-98](https://wanderingnerds.atlassian.net/browse/REW-98) — the two Windows unix-socket test
  failures.

## Related documentation

- [Cookbook Recipe Card](api/cookbook-card.md)
- [Cookbooks API](api/cookbooks.md)
- [My Recipes Recipe Card](api/my-recipes-card.md)
- [API Overview](api/README.md)
- [Database notes](../database/README.md)
- Implementation plan: `docs/plans/rew-88-standardize-cookbook-card.md`
