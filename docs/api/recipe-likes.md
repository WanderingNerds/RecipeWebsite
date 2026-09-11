# Favorites (legacy Recipe Likes API; REW-21, REW-55, REW-66)

**Feature:** REW-21 — Recipe Likes (base feature); REW-55 — Add Favorite Action to Recipe Cards on My Recipes
**Component:** `src/routes/likeRoutes.js`, `src/routes/recipeRoutes.js`, `public/js/likes.js`, `views/recipes/view.ejs`, `views/recipes/index.ejs`, `views/recipes/liked.ejs`, `database/migrations/008_create_recipe_likes_table.sql`
**Last Updated:** 2026-09-10

---

## Overview

This page documents the legacy-named `/api/likes/:recipeId` endpoints that back the heart-shaped Favorite control. The technical contracts—`.like-btn`, `likes.js`, `likeRoutes.js`, `recipe_likes`, `/recipes/liked`, and the `liked` state/response key—remain unchanged for compatibility. User-facing copy calls the action **Favorite** and the collection **Favorites**.

- REW-21 (original): added the `recipe_likes` table, the three `/api/likes/:recipeId` endpoints below, the `.like-btn` component with optimistic UI + undo toast (`public/js/likes.js`), and a `/recipes/liked` page. The heart control originally only appeared on the single-recipe detail view (`views/recipes/view.ejs`).
- REW-55: surfaces the same `.like-btn` control on each recipe card under **My Recipes** (`GET /recipes`), so a user can add or remove a favorite without opening it. Draft recipe cards render the control in a disabled/muted state (see "Draft recipes cannot be favorited" below).
- REW-66: updates user-facing terminology to Favorite/Favorites without renaming technical compatibility contracts or migrating data.

---

## Endpoints (`src/routes/likeRoutes.js`, mounted at `/api/likes`)

### `GET /api/likes/:recipeId`

**Auth:** Optional. If the request carries a valid `sb-access-token` cookie, the response includes the current user's favorite state; otherwise the legacy `liked` key is always `false`.

**Response:**
```json
{
  "liked": true,
  "count": 42,
  "recipeId": "uuid-here"
}
```

`count` comes from the `get_recipe_like_count()` SQL function (public, `SECURITY DEFINER`) and is returned regardless of auth state.

### `POST /api/likes/:recipeId`

**Auth:** Required (`requireApiAuth` — validates the `sb-access-token` cookie via Supabase, returns JSON `401` rather than redirecting).
**Rate limit:** 30 requests/minute, keyed by `user_id` (`likeLimiter`).

Favorites a recipe on behalf of the current user.

- `400` if `:recipeId` is not a well-formed UUID.
- **`404` if the recipe does not exist *or* its `status` is not `'published'`** (`recipeExists()` checks both `id` and `status = 'published'` in the same query). This is the source of the draft-recipe restriction described below.
- If the recipe is already a favorite for this user, it returns the current state (`liked: true`) without erroring—the endpoint is idempotent.
- On success, inserts a `recipe_likes` row and returns the updated count.

**Response (success):**
```json
{ "liked": true, "count": 43, "recipeId": "uuid-here" }
```

### `DELETE /api/likes/:recipeId`

**Auth:** Required (`requireApiAuth`).
**Rate limit:** Same `likeLimiter` as `POST` (shared 30/minute/user budget).

Removes a recipe from Favorites. `400` for a malformed UUID. If the recipe is not currently a favorite for this user, it returns the current state (`liked: false`) without erroring. On success, it deletes the `recipe_likes` row and returns the updated count.

Note: unlike `POST`, `DELETE` does **not** call `recipeExists()`—a user can always remove an existing `recipe_likes` row for a favorite even if that recipe's status later changed (see "Draft recipes cannot be favorited" below).

---

## Draft recipes cannot be favorited (relevant to REW-55)

`POST /api/likes/:recipeId`'s `recipeExists()` check only matches `status = 'published'` recipes, so **favoriting a draft recipe always returns 404**, regardless of which page the request originates from. This rule predates REW-55 and also governs the legacy `/recipes/liked` route, which filters `.eq("status", "published")`.

**My Recipes list (`GET /recipes`) lists both draft and published recipes**, unlike the single-recipe view (which only ever renders the like button for `status === 'published'`). To surface *some* Favorite control on every card (per REW-55's acceptance criteria) without triggering a 404, draft cards render the same `.like-btn` markup with a native `disabled` attribute, muted styling (`.like-btn:disabled` in `public/css/styles.css`), and a `title`/`aria-label` of "Publish this recipe to add it to favorites." Publishing the recipe (via Edit → Publish) makes the control active on the next page load.

If product wants drafts to be favoritable in the future, that requires changing `recipeExists()`, `views/recipes/view.ejs`'s render guard, and the `/recipes/liked` filter together — out of scope for both REW-21 and REW-55.

---

## `GET /recipes` (My Recipes) — `isLiked` enrichment (REW-55)

`GET /recipes` (`src/routes/recipeRoutes.js`) is not part of the `/api/likes` router, but as of REW-55 it reads from the same `recipe_likes` table to render correct heart state on each card:

1. After fetching the user's recipes, the handler collects their IDs and issues **one** additional query:
   `recipe_likes.select("recipe_id").eq("user_id", req.user.id).in("recipe_id", recipeIds)` — a single batched query rather than one look-up per recipe (avoids N+1), following the pattern already recommended in `docs/plans/REW-21-recipe-likes.md`.
2. The resulting recipe IDs are collected into a `Set` and used to attach a boolean `isLiked` to each recipe object passed to `views/recipes/index.ejs`, alongside the existing `categories`/`tags` enrichment.
3. The view renders `data-liked="<%= recipe.isLiked %>"` on the `.like-btn` for published cards; `public/js/likes.js`'s existing global click handler (already loaded on every page via `views/layouts/main.ejs`) picks up these new elements automatically — no JS changes were needed for REW-55.

This route does not return `isLiked` as JSON; it's an EJS render-time local only, consumed by the server-rendered card markup.

No count (`.like-btn-count`) is rendered on My Recipes cards — only the on/off heart state. `public/js/likes.js` already null-checks for a missing count span, so this was a safe omission requiring no JS changes.

---

## Cross-surface consistency

Because My Recipes, the recipe detail view, and `/recipes/liked` all read/write the same `recipe_likes` table through the same `/api/likes/:recipeId` endpoints, a favorite/unfavorite action taken from any one of them is immediately reflected on the others (after a refresh/revisit — there is no realtime push between open tabs).

---

## Security

- **Auth:** `POST`/`DELETE` require `requireApiAuth`; `GET` is optional-auth.
- **Authorization:** RLS on `recipe_likes` (`user_id = auth.uid()` for SELECT/INSERT/DELETE) guarantees a user can only create/remove their own like rows, regardless of which UI surface issued the request.
- **Rate limiting:** 30 favorite add/remove actions per minute per user (`likeLimiter`), shared across every page that renders `.like-btn`, including My Recipes.
- **Input validation:** `recipeId` is validated against a UUID regex server-side before any query runs.
- **CSRF:** CSRF protection is currently disabled repo-wide (`doubleCsrfProtection` commented out in `src/app.js`, `res.locals.csrfToken` hard-coded to `''`). This is a pre-existing, cross-cutting gap unrelated to REW-21/REW-55.

---

## Related documentation

- [API Overview](README.md)
- Plan: `docs/plans/REW-21-recipe-likes.md` (original feature)
- Plan: `docs/plans/rew-55-add-favorite-action-to-recipe-cards.md` (My Recipes card surfacing)
- `database/README.md` — `recipe_likes` table, RLS policies, indexes
- Release notes: `docs/RELEASE_NOTES_REW-55.md`

---

## Changelog

| Date | Change |
|------|--------|
| 2026-09-10 | REW-66 updated current user-facing terminology to Favorite/Favorites while preserving legacy technical contracts and data. |
| 2026-09-07 | Page created (retroactively documenting REW-21) alongside REW-55 documentation; added the "Draft recipes cannot be liked" and `GET /recipes` `isLiked` sections for REW-55. |
