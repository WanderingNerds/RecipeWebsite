## Jira issue

REW-85 — [Add Private/Public Recipe Visibility Controls](https://wanderingnerds.atlassian.net/browse/REW-85)

## Confluence page

[REW-85 — Add Private/Public Recipe Visibility Controls — Implementation Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/29491201/REW-85+Add+Private+Public+Recipe+Visibility+Controls+Implementation+Plan)

## Summary

Expose the existing `recipes.status` lifecycle as an explicit Private/Public visibility choice across manual creation, import, cloning, and owner editing. Private maps to `draft` and Public maps to `published`, preserving the database's existing owner-only and public-read RLS model. New, imported, and cloned recipes initially select Private; owners may deliberately select Public before saving, and later owner edits can switch either direction. Public Browse/search/detail routes continue to return only published recipes, so visibility changes take effect on the next request without a cache or index synchronization step.

## Open questions / assumptions

- The ticket uses Private/Public language while the schema and application use `draft`/`published`. This plan treats them as presentation/domain aliases (`private` → `draft`, `public` → `published`) rather than introducing a second column or renaming persisted values.
- “Default Private” means the initial control selection is Private; an owner may choose Public before the first save. Server-side normalization must also default missing or invalid visibility input to Private.
- No clone workflow exists in the current repository. REW-85 is assumed to include a new authenticated clone entry point from recipe detail pages. It should load any recipe the caller is allowed to view (their own recipe or another user's public recipe), prefill a create form, omit source ownership/IDs and collection memberships, and save a new recipe owned by the caller. The clone form always starts Private regardless of the source recipe's status.
- Cloning should copy textual recipe data and category/tag selections. Existing hosted image URLs should not be silently reused as a new upload unless product explicitly confirms that storage ownership/lifecycle supports it.
- Existing private recipes and historical data need no backfill because `draft` already means owner-only and is the database default.

## Tasks

1. Add a small server-side visibility normalizer/constant mapping that accepts only the UI's Private/Public values and returns `draft`/`published`, defaulting missing or invalid values to `draft`. Reuse it in manual create, import save, clone save (through create), and owner update so request tampering cannot produce unsupported states.
2. Replace the create/edit forms' status-by-submit-button behavior with one accessible, clearly labelled Private/Public control plus a single save action. Manual create starts Private; edit reflects the recipe's current status. Preserve required-field validation, CSRF, image handling, categories/tags, and optional meal-plan assignment.
3. Add the same Private/Public control to the import review form, default it to Private whenever a file is parsed/reset, include the selected value in the JSON save payload, and have the import route apply the shared server-side mapping. Update success copy to use Private/Public terminology.
4. Add an authenticated clone route/workflow. Resolve the source through existing RLS-visible recipe reads, return not-found for inaccessible private recipes, prefill the create form with cloneable fields and category/tag selections, generate a collision-safe editable title suggestion, and force the initial visibility selection to Private. Saving must create a new row with `user_id = req.user.id`; never carry over source IDs, timestamps, likes, cookbook memberships, or meal-plan memberships.
5. Add Clone actions on the authenticated owner detail and public recipe detail surfaces where an authenticated viewer can access the source. Guests should be directed to authenticate (or see no clone action), and private recipes must never become discoverable through the clone endpoint.
6. Keep Browse, search, public detail, likes, and meal-plan visibility checks tied to `status = 'published'`; verify that an owner-only update from Public to Private immediately removes the recipe from these public read paths and that Private to Public immediately adds it. Ensure direct non-owner update attempts remain blocked both by route ownership filters and RLS.
7. Update terminology in recipe cards/detail badges and explanatory copy from Draft/Published to Private/Public where it describes visibility, without changing persisted enum values or public URLs.
8. Add focused route, view, client, and migration-contract coverage for defaulting, allowlisted mapping, all four controls, clone ownership/access rules, owner-only updates, and Browse/public-detail inclusion. Run the complete Node test suite and perform authenticated/anonymous browser acceptance at desktop and mobile widths.
9. Update database and feature documentation to explain the Private/Public vocabulary, its mapping to `draft`/`published`, clone semantics, and the existing RLS/public-query enforcement.

## Affected files

- `src/routes/recipeRoutes.js` — normalize visibility for create/update; add clone form handling; preserve explicit owner scoping on updates.
- `src/routes/importRoutes.js` — accept and normalize import visibility, with Private as the authoritative fallback and updated result messages.
- `src/routes/publicRoutes.js` — expected to retain published-only Browse/public detail filters; expose helpers only if needed for focused tests.
- `src/utils/recipeVisibility.js` — proposed shared allowlist/mapping between Private/Public UI values and `draft`/`published` persistence values.
- `src/utils/recipeVisibility.test.js` — proposed unit coverage for valid values and fail-closed Private defaults.
- `views/recipes/new.ejs` — accessible visibility control, Private initial state, clone-prefilled values, and one save action.
- `views/recipes/edit.ejs` — owner-only visibility control reflecting the stored state and updated terminology.
- `views/recipes/import.ejs` — import review visibility control defaulted to Private.
- `views/recipes/view.ejs` — Private/Public status badge and owner clone action.
- `views/recipes/public-view.ejs` — authenticated clone action for publicly visible recipes.
- `views/partials/recipe-summary-card.ejs` — Private/Public owner-card terminology if status is displayed there.
- `public/js/import.js` — reset/read the import visibility control and include it in the save payload.
- `public/css/styles.css` — reusable visibility-control styling and responsive/focus states if existing form styles are insufficient.
- `src/routes/importRoutes.test.js` — import visibility default/selection and insert mapping coverage.
- `src/routes/publicRoutes.test.js` — regression coverage that Browse/public reads remain published-only.
- `src/routes/recipeVisibilityRoutes.test.js` — proposed behavior-level coverage for manual create, edit authorization/status changes, and clone access/ownership/defaults.
- `src/views/recipeVisibility.test.js` — proposed EJS/client contract coverage for controls, defaults, selected edit state, labels, and clone actions.
- `database/migrations/018_reinforce_recipe_visibility_policies.sql` — only if inspection or staging verification shows deployed recipe RLS/grants differ from migration 001; otherwise do not add a migration.
- `database/README.md` — document the user-facing vocabulary mapping and verified RLS behavior.
- `docs/api/recipe-visibility.md` — document create/import/edit/clone inputs, defaulting, access rules, and public query behavior.

## Database changes

No schema change is expected. The existing `recipes.status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published'))`, status index, owner CRUD policies, and published SELECT policy already implement the required storage and row visibility model. Before release, compare the live policies/grants with `database/migrations/001_create_recipes_table.sql`; create migration 018 only if the deployed state needs an idempotent policy/grant correction. Do not add a separate visibility column or backfill existing rows. Existing metadata policies in migration 013 and recipe consumers such as likes/meal plans must continue to treat only `published` as public.

## Security considerations

- Fail closed: unrecognized, missing, array-shaped, or tampered visibility values become Private (`draft`), never Public.
- Require authentication for create, import, clone, and edit mutations. Preserve CSRF on multipart form mutations and JSON CSRF headers for import save; any clone POST must also use CSRF protection.
- Enforce recipe ownership in the edit/update query in addition to relying on RLS. A non-owner must not be able to change visibility even for a public recipe.
- Resolve clone sources through a request-scoped authenticated Supabase client so RLS prevents access to another user's private recipe. Never use the service/anonymous client to bypass that boundary.
- Public Browse/search/detail reads must keep explicit `published` predicates as defense in depth, while RLS remains the authoritative database boundary.
- Do not trust cloned identifiers or relationship data from the browser. Server-side cloning must choose the new owner and copy only an allowlisted set of recipe fields.
- Preserve current URL sanitization, upload magic-number validation, rate limiting, required-field checks, and output escaping.

## Acceptance criteria

- [ ] Manual create, import review, clone, and owner edit each display one accessible Private/Public visibility control.
- [ ] Manual create and import initially select Private; clone always initially selects Private even when the source is Public; edit selects the recipe's current visibility.
- [ ] Omitting or tampering with visibility on manual create, import, or clone persists `status = 'draft'`; selecting Public persists `status = 'published'`.
- [ ] A cloned recipe is a new row owned by the cloning user and does not copy IDs, timestamps, likes, cookbook memberships, or meal-plan memberships.
- [ ] Owners can clone their Private or Public recipes; authenticated non-owners can clone Public recipes; guests and non-owners cannot clone a Private recipe.
- [ ] A recipe with Private visibility is readable through the authenticated owner route only and returns no content through `/r/:id`, Browse, or search for other users/guests.
- [ ] A Public recipe appears in Browse/search and is readable through `/r/:id` by guests and other authenticated users.
- [ ] Only the owner can switch visibility; a direct non-owner update is rejected or affects zero rows under both application ownership filtering and RLS.
- [ ] Switching Public to Private removes the recipe from Browse/search/public detail on the next request; switching Private to Public makes it available on the next request.
- [ ] Existing category/tag public metadata, likes, meal-plan eligibility, author defaults, required times, image handling, and CSRF behavior continue to work.
- [ ] Automated tests pass, and browser acceptance verifies keyboard/focus behavior plus readable responsive layouts for all four workflows.

## As-built outcome (2026-09-14)

Implementation and two review loops are complete and approved. The shipped code uses `src/utils/recipeVisibility.js` as the shared allowlist and fail-closed mapping, replaces status-specific submit buttons with Private/Public radio controls plus one save action, adds `GET /recipes/:id/clone`, and updates recipe visibility terminology across cards and detail surfaces. Clone creation reuses the normal create handler, is always initially Private, copies only editable text and category/tag selections, omits photos and relationship/identity data, and chooses a collision-safe editable title.

No database migration, environment variable, dependency, architectural service, cache, or search-index change was required. Existing `recipes.status`, owner CRUD policies, published-read policy, and explicit published-only public queries remain the enforcement model.

Automated acceptance: 271 tests total, 269 passed, 0 failed, and 2 skipped solely because the sandbox forbids local HTTP listeners. The focused reviewer suite passed 24/24. `npm run build` succeeded (configured no-op), `git diff --check` passed, and `node --check` passed for `recipeRoutes.js` and `importRoutes.js`. Static security/RLS review was approved.

Pending and not claimed as passed: authenticated/anonymous browser acceptance at desktop and mobile widths, including keyboard/focus behavior; and live Supabase verification of RLS policies/grants and immediate Public↔Private visibility changes.
