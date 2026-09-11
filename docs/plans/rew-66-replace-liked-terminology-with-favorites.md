## Jira issue

[REW-66 — Replace Liked Recipe Terminology with Favorites](https://wanderingnerds.atlassian.net/browse/REW-66)

## Confluence page

[REW-66: Replace Liked Recipe Terminology with Favorites — Implementation Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/27000833/REW-66+Replace+Liked+Recipe+Terminology+with+Favorites+Implementation+Plan)

## Summary

Standardize the saved-recipe experience on Favorite/Favorites terminology across user-facing UI and API-delivered error text. Preserve the existing `recipe_likes` data, `/api/likes/:recipeId` and `/recipes/liked` URLs, internal state names, and all current behavior so existing saved recipes remain available.

## As implemented

The implementation follows the planned presentation-only scope. User-facing terminology now uses **Favorite** for the action or a single recipe and **Favorites** for the collection across recipe views, the Favorites collection, dashboard copy, client-side prompts/toasts/errors, and API-delivered error messages. Current README, API, and database documentation now leads with Favorite/Favorites terminology while identifying unchanged legacy contracts.

Compatibility was preserved for `recipe_likes`, `/api/likes/:recipeId`, `/recipes/liked`, the `liked` response/state key, `.like-btn`, `likes.js`, `likeRoutes.js`, and existing filenames. No data migration, schema change, route change, or behavior change was made.

Review approved the working-tree diff with no findings. Automated validation passed: the focused terminology tests passed 13/13, two independent `npm test` runs passed 155/155 with exit code 0, and `git diff --check` passed. Authenticated browser QA with an account containing pre-existing favorites could not be performed in the local environment and remains pending; the Jira issue must remain In Progress until that validation is completed.

## Open questions / assumptions

- This is intentionally a presentation-copy change. Internal identifiers and public URLs remain unchanged to avoid a migration, compatibility break, or data loss.
- Use **Favorite** for the action or a single recipe; use **Favorites** for the collection.
- Developer-facing comments/log messages and historical documentation can retain “like” where they describe unchanged implementation details; current user-facing product documentation should use Favorites while documenting legacy technical names accurately.

## Tasks

1. Update the Favorites collection page heading, document title, empty state, and load-error flash copy.
2. Update heart-button accessible labels, guest login prompt, optimistic-update fallback, removal/undo toast, and API error/rate-limit responses to Favorite terminology.
3. Retain existing technical contracts: `recipe_likes`, `liked` JSON/data state, `.like-btn`, `likes.js`, `likeRoutes.js`, `/api/likes/:recipeId`, and `/recipes/liked`.
4. Keep the Dashboard card title exactly **My Favorites** and replace its remaining “liked” description.
5. Add/update tests that render relevant views or inspect copy, including an assertion that current user-facing surfaces no longer expose Liked/Likes terminology.
6. Run `npm test` and manually verify favorite/unfavorite, undo, guest prompt, Favorites collection, and persistence of existing records.
7. Update current README/API/database documentation to lead with Favorite/Favorites while retaining legacy schema and route identifiers where technically required.

## Affected files

- `src/routes/index.js` — Favorites page title and failure flash copy.
- `src/routes/likeRoutes.js` — user-visible JSON error and rate-limit copy only; preserve endpoints and response fields.
- `public/js/likes.js` — accessible labels, guest prompt, fallback error, removal/undo toast copy.
- `views/recipes/liked.ejs` — Favorites heading and empty state.
- `views/recipes/view.ejs` — owner-page heart-button accessible label.
- `views/recipes/public-view.ejs` — public/guest heart-button accessible labels.
- `views/dashboard.ejs` — description below the existing My Favorites card.
- `views/partials/recipe-summary-card.ejs` — verify and retain already-correct Favorite labels; include in terminology regression coverage.
- `src/views/dashboard.test.js`, `src/views/recipeCard.test.js`, and a focused view/copy regression test as appropriate — verify required labels and absence of old user-facing terms.
- `README.md`, `docs/api/README.md`, `docs/api/recipe-likes.md`, and `database/README.md` — current product-facing terminology, with unchanged technical identifiers documented explicitly.

## Database changes

No migration. Do not rename or rewrite `recipe_likes`, its rows, indexes, RLS policies, helper function, or timestamps. Existing saved recipes and recency ordering must remain unchanged.

## Security considerations

No auth, CSRF, validation, upload, RLS, or rate-limit behavior changes. Preserve authenticated mutations, UUID validation, published-recipe checks, per-user RLS, and the existing 30-actions-per-minute limiter. Review API copy changes to ensure no additional implementation or account details are exposed.

## Acceptance criteria

- [x] All current user-facing buttons, headings, labels, empty states, prompts, toasts, flashes, and API-delivered errors use Favorite/Favorites rather than Liked/Likes for saved recipes, as covered by review and automated tests.
- [x] **Favorite** is used for an action or one recipe; **Favorites** is used for the collection.
- [x] The Dashboard card is labeled exactly **My Favorites**, and its description contains no old saved-recipe terminology.
- [ ] Existing `recipe_likes` rows remain untouched and visible in the Favorites collection. No migration or database write was introduced, but authenticated browser verification with pre-existing data remains pending.
- [ ] Favorite/unfavorite, count updates, optimistic rollback, undo, guest login prompt, and cross-surface synchronization continue to work. Automated coverage passed; authenticated browser verification remains pending.
- [x] Existing technical routes, filenames, CSS classes, database identifiers, and `liked` response/state keys remain compatible.
- [ ] Automated tests pass and cover the revised visible copy; manual QA with a user who has pre-existing favorites remains pending. Automated evidence: focused tests 13/13; two independent `npm test` runs 155/155 with exit code 0; `git diff --check` passed.
