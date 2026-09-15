# Recipe visibility

Recipe visibility is presented as **Private** or **Public**. The database continues to store these values as `draft` and `published`, respectively; no schema or data migration is required.

Manual creation (`POST /recipes`), import save (`POST /recipes/import/save`), and owner update (`POST /recipes/:id/update`) accept a scalar `visibility` value. Only `private` and `public` are recognized. Missing, malformed, legacy, or tampered values fail closed to `draft` (Private).

`POST /recipes/:id/clone` requires authentication, CSRF validation, and a different user's Public source. It creates an independent Private recipe rather than prefilling the creation form. Source visibility is checked through both caller-scoped RLS and an explicit `status = 'published'` predicate. See [Add Recipe / Cloning](recipe-cloning.md) for the copy and provenance contract.

Owner updates retain both the route-level `id` + `user_id` filter and database RLS. Browse and `/r/:id` retain explicit `status = 'published'` predicates. Search uses the existing `search_recipes` database function, which also filters to published rows. Visibility changes therefore affect public reads on the next request.

## Card-level toggle: `POST /recipes/:id/visibility` (REW-86)

A second, narrower write path to the same field. Owners can flip one recipe between Private and Public directly from its card on `/recipes`, without opening the edit form. `handleRecipeUpdate` is untouched — the full edit form still owns form-level visibility.

The endpoint accepts the same scalar `visibility` value (`private` | `public`) and runs it through the same `normalizeRecipeVisibility()` normalizer, so the fail-closed rule above applies identically: a missing, array-shaped, wrong-case, or forged value writes `draft`. The update is filtered by both `id` and `user_id`, a non-UUID id is rejected before any query, and a not-found row and a not-owned row produce the same generic flash.

It is a urlencoded form POST followed by a redirect rather than an AJAX call, so the card re-renders with consistent state — notably the favorite heart, which must become disabled when a recipe goes Private. The redirect target is rebuilt server-side on a hard-coded `/recipes` path from whitelisted `category`/`tags` values only; no caller-supplied URL is ever echoed into a `Location` header.

Middleware: `requireAuth` → route-level `csrfProtection` → a 60-per-15-minutes-per-IP limiter. See [My Recipes Recipe Card](my-recipes-card.md) for the full contract. **Branch-only: implemented and reviewed on `REW-86-standardize-my-recipes-card`, QA not run, not yet merged.**
