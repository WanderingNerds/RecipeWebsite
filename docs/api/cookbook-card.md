# Cookbook Recipe Card (REW-88)

**Feature:** REW-88 — Standardize Cookbook Recipe Card Content & Actions
**Component:** `views/partials/recipe-summary-card.ejs`, `views/cookbooks/view.ejs`, `src/routes/cookbookRoutes.js`
**Last Updated:** 2026-09-15
**Status:** implemented and reviewer-approved on branch `REW-88-standardize-cookbook-recipe-card`. **QA was deliberately skipped on this run**, and the branch is unmerged and unpushed.

---

## Overview

`views/cookbooks/view.ejs` used to hand-roll its own recipe card inline: `Prep:` / `Cook:` /
`N servings` labels, no difficulty, no tags, no favorite heart, no Edit, Delete or Share, plus a
read-only Private/Public pill and the cookbook-specific Remove form.

REW-88 does not add a new card. It teaches the shared card partial a fourth surface, points the
cookbook page at it, and widens the route query so the card actually receives the columns it needs.
Two things make this surface different from the three that already existed: `+ Cookbook` is
suppressed (the recipe is already in a cookbook), and the page-specific **Remove from cookbook**
action is carried into the shared card — which is why the partial now also has to learn the
cookbook's id.

---

## The shared partial's local-variable contract

`views/partials/recipe-summary-card.ejs` is the single card template for four surfaces. This is the
part most likely to bite a future caller, so it is documented in full here.

> **Superseded by REW-89.** The partial now has a **fifth** surface, `'meal-plan'`, plus a new
> optional `mealPlanId` local and a new `showMealPlanAdd` flag (`!isMealPlan`), and `showStatusPill`
> gained an `|| (isMealPlan && isOwner)` clause. The tables below remain accurate for the cookbook
> surface, but the current, complete contract lives in
> [Meal Plan Recipe Card](meal-plan-card.md#the-shared-partials-local-variable-contract). Nothing
> about the cookbook surface's rendered output changed.

### Locals a caller passes

| Local | Required | Notes |
|-------|----------|-------|
| `recipe` | yes | The recipe row. See "Columns the card reads" below |
| `surface` | no | `'browse'` \| `'my-recipes'` \| `'favorites'` \| `'cookbook'`. Read through `typeof`; when omitted it falls back to the legacy boolean `isPublic` (`true` → `'browse'`, otherwise `'my-recipes'`), so the two original callers still work untouched |
| `cookbookId` | no | **New in REW-88.** The id of the cookbook being viewed. Resolved internally to `cardCookbookId`; when absent, the Remove button is simply not rendered, so a caller that forgets it degrades to a missing button rather than a broken URL |
| `selectedCategory` / `selectedTags` | no | My Recipes only — round-tripped through the visibility toggle so the post-toggle redirect restores the active filter |
| `user`, `csrfToken` | — | Reach the partial through `res.locals`, not through the include |

EJS throws on an undefined local, so every optional local above is read through `typeof`.

### Flags the partial derives

| Flag | Rule | Effect |
|------|------|--------|
| `isOwner` | `user.id === recipe.user_id` | Presentational only — see Security below |
| `recipeHref` | `/r/:id` on browse, `/recipes/:id` everywhere else | Browse is the only anonymous-safe surface |
| `showFavoriteHeart` | `!isBrowse` | **Changed in REW-88** — was previously the `else` branch of the status pill |
| `showStatusPill` | `isBrowse \|\| (isCookbook && isOwner)` | **Changed in REW-88** — heart and pill are now independent and can both render |
| `showOwnerControls` | `isOwner && !isBrowse` | Edit + Delete |
| `showCookbookAdd` | `!isBrowse && !isCookbook` | **New in REW-88** — this is the ticket's "do not display + Cookbook" rule |
| `chipsAreLinks` | `isMyRecipes` | Category/tag chips are filter links on My Recipes, plain text elsewhere |
| `showAdaptedFrom` | `!isBrowse` | `Adapted from …` clone attribution (REW-84) |

The heart/pill split is the only behavioral change to the pre-existing surfaces, and it is
provably output-preserving for them: the old heart condition was `!showStatusPill = !isBrowse`,
which is exactly the new `showFavoriteHeart`; `showStatusPill` reduces to `isBrowse` off the
cookbook surface; and `showCookbookAdd` is `true` on both branches that previously drew the button.
The reviewer confirmed byte-identical output across eight browse/my-recipes/favorites permutations.

### Per-surface action rows

| Surface | Action row |
|---------|-----------|
| `browse` | `+ Meal Plan` only |
| `my-recipes` | Private/Public toggle, then `+ Meal Plan`, `+ Cookbook`, Share, Edit, Delete |
| `favorites` | `+ Meal Plan`, `+ Cookbook`, Share, and Edit/Delete when owned |
| `cookbook` | `+ Meal Plan`, Share, Remove, Edit, Delete — **no `+ Cookbook`** |

The cookbook branch is a fourth `else if` rather than a unification of the four rows: a new branch
cannot regress the three that already shipped, and any later unification belongs to REW-82.

---

## Card contents on the cookbook surface (`/cookbooks/:id`)

| Element | Notes |
|---------|-------|
| Thumbnail | Links to `/recipes/:id` when present |
| Title | Clickable link to `/recipes/:id`, escaped |
| Favorite heart | `.like-btn` (REW-21/REW-55). Disabled with an explanatory title when `status !== 'published'`, because `POST /api/likes/:recipeId` only accepts published recipes |
| Status pill | Read-only `Private` / `Public`, **owner-only**. See "Decisions" below |
| Author | `By {author}`; `Adapted from {original_author}` on clones |
| Categories / tags | Plain badges, not filter links |
| Metadata | `Prep Time:`, `Cook Time:`, `Servings:`, `Difficulty:` — each omitted entirely when empty |
| `+ Meal Plan` | Existing shared modal (REW-63) |
| Share | **Inert placeholder.** `disabled`, `aria-disabled="true"`, `title="Sharing is coming soon"`. No `href`, no handler, no endpoint, no target URL. Real behavior is [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18) |
| Remove | Confirm-guarded form post to `POST /cookbooks/:cookbookId/recipes/:recipeId/remove`, carrying its hidden `_csrf` and hidden `returnTo=cookbook`. Rendered only when `cookbookId` was passed |
| Edit | Owner-only link to `/recipes/:id/edit` |
| Delete | Owner-only confirm-guarded form post to `/recipes/:id/delete` |
| `+ Cookbook` | **Never rendered on this surface** |

**Control order is deliberate:** `+ Meal Plan`, `Share`, `Remove`, `Edit`, `Delete`. Edit
physically separates "take this out of the cookbook" from "destroy this recipe forever", Delete
stays last and stays the only red control, and the two confirm dialogs read differently
("Remove this recipe from the cookbook? The recipe itself will not be deleted." vs. "Are you sure
you want to delete this recipe? This action cannot be undone.").

---

## `GET /cookbooks/:id` — widened read (no contract change)

The route's **URL, middleware, auth, response type, and redirect behavior are unchanged.** What
changed is the shape of the data handed to the template.

`GET /:id` was extracted into an exported `handleCookbookView(req, res, { createClient })` with an
injectable Supabase client factory, following the `handleCookbookVisibilityUpdate` precedent, so
the data contract can be unit-tested without a live Supabase. The mounted route still runs behind
`requireAuth`.

### Columns the card reads

`COOKBOOK_CARD_COLUMNS` in `src/routes/cookbookRoutes.js` mirrors `FAVORITE_CARD_COLUMNS` in
`src/routes/index.js` — both surfaces render the same partial, so both must feed it the same shape:

```
id, user_id, title, author, original_author, prep_time, cook_time, servings,
difficulty, thumbnail_url, status, created_at,
recipe_categories(categories(id, name, slug, icon)),
recipe_tags(tags(id, name, slug))
```

Two of these are new to this page: `user_id` (decides whether Edit/Delete are drawn, never
rendered) and `original_author` (clone attribution). Body fields — instructions, notes — stay off a
listing query.

`getCookbookRecipes(supabaseClient, cookbookId)` is now exported. It issues **one** query, keeps
the existing defensive drop of a null `recipes` embed (a recipe deleted mid-query), keeps the
junction row's `created_at DESC` ordering (added-to-cookbook order, newest first), and flattens the
embedded junction rows into flat `categories` / `tags` arrays using the same `?.` +
`.filter(Boolean)` mapping as Browse and Favorites. A failed read returns `[]`.

This is the repo's first three-level PostgREST embed
(`cookbook_recipes` → `recipes` → `recipe_categories` → `categories`). See "Known gaps" — its error
path renders as the empty state, so a live smoke test is still outstanding.

### Batched favorite state

The heart needs to know which recipes the caller has already favorited. The handler collects the
recipe ids and issues **one** `recipe_likes` query filtered by `.eq("user_id", req.user.id)` and
`.in("recipe_id", ids)` on the request-scoped client, builds a `Set`, and stamps `isLiked` per
recipe. An empty cookbook issues no likes query at all. A failure is logged and the page still
renders, with every heart unfavorited — the same degradation the My Recipes handler uses.

Net result: one cookbook read, one recipe read, one likes read, regardless of how many recipes the
cookbook holds. No N+1.

---

## Security

- **`isOwner` is presentational only.** It decides whether Edit and Delete are *drawn*. Real
  enforcement is unchanged: `POST /recipes/:id/delete` filters `.eq("user_id", req.user.id)` on top
  of owner-only RLS, and `GET /recipes/:id/edit` + `POST /:id/update` enforce ownership
  independently. The card's flag must never become the only check.
- **`recipe.user_id` is never rendered.** It is fetched solely to compute the flag; the view tests
  assert its absence from the HTML.
- **Remove stays cookbook-owner-scoped.** `POST /cookbooks/:id/recipes/:recipeId/remove` keeps its
  `requireAuth`, `cookbookLimiter`, UUID guard, and cookbook-owner check. Moving the form's markup
  into a shared partial changed nothing server-side, and the interpolated `cookbookId` stays on
  escaped `<%= %>` output.
- **`+ Cookbook` suppression is a display rule, not a security boundary.**
  `POST /api/cookbooks/:id/recipes/:recipeId` keeps its auth, per-user limiter, UUID guards, and
  duplicate-safe upsert.
- **No middleware was touched.** helmet, CORS, `csrf-csrf`, `express-rate-limit`, and the auth
  middleware are all untouched by this change. No new endpoint and no new rate limiter were added;
  the only route change is widening two reads.
- **Share leaks nothing.** It is inert and exposes no URL. It must never link to `/r/:id`, which
  would be wrong and misleading for a Private recipe sitting in a cookbook.
- **The owner-only status pill is not a leak.** It renders only when `isOwner`, so a post-REW-100
  viewer is never shown a status claim about another user's recipe.
- **Pre-existing gap, deliberately not fixed here:** `POST /recipes/:id/delete` has no route-level
  `csrfProtection`, unlike `/:id/visibility` and `/:id/clone`, so the global
  `csrfProtectionExceptMultipart` wrapper's `multipart/form-data` skip leaves a forged cross-site
  multipart POST unchecked. REW-88 adds a Delete button to a third page. Tracked as
  [REW-102](https://wanderingnerds.atlassian.net/browse/REW-102).

---

## Database

**No migration.** Every read this card adds is already permitted by applied policies:

- `recipes.user_id`, `original_author`, `status` — migration `001` grants SELECT on own rows and on
  any `status = 'published'` row, all columns.
- `recipe_categories` / `recipe_tags` — migrations `005`/`006` grant owner SELECT (which is what
  makes the chips readable on the owner's **Private** recipes), and `013` adds published-recipe
  SELECT for `anon` and `authenticated` plus the matching `categories`/`tags` lookups. Both halves
  are needed on this page and both already exist.
- `recipe_likes` — read on the request-scoped client, already RLS-scoped to the caller, and covered
  by the table's `(user_id, recipe_id)` primary key.
- Remove, Edit, Delete, and `+ Meal Plan` reuse existing policies unchanged.

---

## Decisions and tradeoffs

- **The read-only Private/Public pill was kept, gated on `isOwner`.** The ticket's requirement list
  does not mention a status pill at all, so this is a deliberate deviation. The rationale: a
  cookbook can hold the owner's Private recipes, and REW-19 sharing filters those out of the public
  `/c/:id` view, so the pill is the only place the owner is told "this recipe will not appear to
  the people I share this cookbook with." Deleting it silently would regress REW-19. The reviewer
  flagged this as a non-blocking "should fix — product decision" and asked for explicit product
  sign-off; it is a one-flag revert (`showStatusPill = isBrowse`) plus two tests if rejected.
- **There is no Private/Public *toggle* on this surface.** The ticket omits it and REW-87 already
  set the precedent that owners flip visibility from My Recipes.
- **Remove was carried into the shared card rather than left beside it.** It is the only way to get
  a recipe out of a cookbook, and the ticket's last acceptance criterion asks for consistent
  formatting "while preserving these page-specific actions."
- **Ownership is computed per card even though it is uniform today.** The `cookbook_recipes` INSERT
  policy (migration `010`) still enforces own-recipes-only, so every recipe in a cookbook currently
  belongs to the cookbook owner. REW-100 changes that; computing `isOwner` per card now means
  REW-100 needs no view change at all.
- **Chips are static text, not links.** `/recipes?category=` filters *your own* recipes, so
  following one from a cookbook entry — especially a post-REW-100 non-owned one — would land on an
  unrelated, often empty list.
- **The public shared cookbook view `/c/:id` was left alone.** It renders the lightweight
  `views/partials/recipe-card.ejs` and is anonymous-capable, so most of this card's controls do not
  apply there.
- **Sizing was left to REW-82.** Five `flex: 1` controls now share the action row; they wrap using
  the existing `.recipe-summary-actions` rules. No CSS was added.

---

## Testing notes

Added with this change:

- `src/routes/cookbookRoutes.test.js` (new, 10 cases) — the select string requests `user_id`,
  `original_author`, `difficulty`, `status`, `thumbnail_url`, `recipe_categories(` and
  `recipe_tags(`; the query stays scoped to the cookbook and keeps its newest-added-first ordering;
  categories/tags are flattened and the junction keys are not handed to the view; a null embed and
  a null link row flatten to `[]` rather than `undefined`; a membership row whose recipe vanished
  mid-query is dropped; a failed recipe read yields an empty cookbook rather than throwing;
  `isLiked` is stamped from one batched, caller-scoped query; an empty cookbook issues no likes
  query at all; a failed likes query still renders with every heart unfavorited; the page is still
  cookbook-owner scoped and still passes `appUrl`; and a malformed id never reaches the database,
  landing on the same redirect as a cookbook the caller does not own.
- `src/views/recipeCard.test.js` (updated) — the single old cookbook test was replaced by five
  broader ones covering owner, non-owner, draft, missing `user_id`, missing `cookbookId`, and
  sparse-recipe cases. The Browse, My Recipes, Favorites, and REW-86 "owner-only controls never
  leak onto the public Browse card" tests pass **unmodified**.
- `src/views/cookbookSharing.test.js` (updated) — the per-recipe-pill assertion moved from a
  template-source check to a rendered-output check, plus a form-scoped `doesNotMatch`. Strictly
  stronger, not loosened: the per-recipe `Private` pill literal now lives in the partial, so the
  source-text assertion against `views/cookbooks/view.ejs` could no longer prove anything.

Suite result at hand-off: **510 tests, 508 passing, 2 failing.** Both failures are in
`src/csrf.integration.test.js` (`listen EACCES /tmp/rew71-*.sock`) — a file untouched by this
change, failing because Windows cannot bind unix-domain sockets. Pre-existing and environmental,
not a regression; tracked as [REW-98](https://wanderingnerds.atlassian.net/browse/REW-98).

**QA was deliberately skipped on this run.** Code review approved with no blocking issues, but no
browser pass and no live-Supabase verification were performed. The plan's manual acceptance
criteria are therefore unverified — the heart toggle surviving a reload, `+ Meal Plan` against real
data, the Remove round trip, Edit/Delete from this page, 375px wrapping of the five-control row,
keyboard reachability and focus visibility, and the crafted cross-user POST checks.

---

## Known gaps and follow-ups

- **Manual smoke test of `/cookbooks/:id` is outstanding.** `getCookbookRecipes` is the repo's
  first three-level PostgREST embed, and its helper returns `[]` on error — which renders as
  "No recipes in this cookbook yet" with no flash. A real cookbook containing a recipe with both
  tags and categories should be loaded before merge. Raised by the reviewer as a non-blocking
  should-fix precisely because QA was skipped.
- **The owner-only status pill needs product sign-off**, since it is not in the ticket's
  acceptance-criteria list.
- **The disabled heart's label is a status claim.** A non-owner viewing a `draft` recipe would get
  a heart labelled "Make this recipe Public to add it to favorites", which contradicts the rule
  that a non-owner is never shown a status claim about someone else's recipe. Unreachable today
  (`cookbook_recipes` RLS is own-recipes-only and the page is cookbook-owner gated) but reachable
  under [REW-100](https://wanderingnerds.atlassian.net/browse/REW-100); the reviewer recommended
  gating that branch on `isOwner` and folding the fix into REW-100.
- [REW-102](https://wanderingnerds.atlassian.net/browse/REW-102) — route-level `csrfProtection` on
  `POST /recipes/:id/delete`, deliberately out of scope for a card-layout ticket.
- [REW-18](https://wanderingnerds.atlassian.net/browse/REW-18) — real Share behavior.
- [REW-82](https://wanderingnerds.atlassian.net/browse/REW-82) — cross-surface card sizing.
- [REW-89](https://wanderingnerds.atlassian.net/browse/REW-89) — the Meal Plan card, which has the
  same hand-rolled shape and should be able to adopt the partial without another rewrite.
- **No pagination on the cookbook page.** `getCookbookRecipes` still fetches every row unbounded.
  Pre-existing; a richer card makes a large cookbook heavier but not broken. Not ticketed.
- `src/views/recipeVisibility.test.js` line 65 now passes via the cookbook-level
  `cookbook-visibility-private` badge rather than the per-recipe pill that moved into the partial.
  Terminology is still covered by the new `recipeCard.test.js` cases; the reviewer suggested (as a
  nit) adding `views/partials/recipe-summary-card.ejs` to that test's file loop so the source-level
  invariant lives where the markup now does.

---

## Related documentation

- [API Overview](README.md)
- [Cookbooks API](cookbooks.md) — the `/cookbooks*` routes, RLS model, and public `/c/:id` surface
- [My Recipes Recipe Card](my-recipes-card.md) — the REW-86 owner surface of the same partial
- [Browse Recipes](browse-recipes.md) — the public surface of the same partial
- [Recipe Likes API](recipe-likes.md) — the favorite heart and its published-only restriction
- Plan: `docs/plans/rew-88-standardize-cookbook-card.md`
- Release notes: `docs/RELEASE_NOTES_REW-88.md`
