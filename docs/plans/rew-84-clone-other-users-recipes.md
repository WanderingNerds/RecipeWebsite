## Jira issue

REW-84 — [Add Cloneable “Add Recipe” Option for Recipes Owned by Other Users](https://wanderingnerds.atlassian.net/browse/REW-84)

## Confluence page

[REW-84 — Add Recipe for Recipes Owned by Other Users — Implementation Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/29851649/REW-84+Add+Recipe+for+Recipes+Owned+by+Other+Users+Implementation+Plan)

## Release page

[Release: REW-84 - Add Recipe for Other Users' Recipes](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/29949953/Release+REW-84+-+Add+Recipe+for+Other+Users+Recipes)

## Summary

Complete the clone capability introduced by REW-85 as an owner-safe **Add Recipe** workflow for authenticated users viewing another user's public recipe. The action creates a separate recipe owned by the current user, copies only recipe content and transferable category metadata, records durable provenance and an original-author snapshot, and then lets the new owner edit and organize that copy without affecting the source or any sibling copy. Owner views must not offer Add Recipe, and existing route ownership filters plus RLS continue to protect the original.

## As-shipped status

Implemented on `REW-84-clone-other-users-recipes` and approved by review with no blocking findings. The shipped implementation uses `POST /recipes/:id/clone` with authentication, rate limiting, CSRF protection, an explicit Public/non-owner source check, a server-controlled copy allowlist, category copying, and compensating owner-scoped deletion when category insertion fails. Migration 018 adds paired clone provenance, a direct-source index, durable root-author attribution, and database enforcement preventing provenance rewrites. Attribution appears on clone detail pages and owned recipe cards.

Automated/static validation passed: focused REW-84 tests **27/27**, full suite **283/283**, and the git diff check passed. Full acceptance remains incomplete: migration 018, RLS, and source deletion have not been exercised against a live isolated Supabase database, and authenticated browser coverage for desktop/mobile, keyboard/focus, clone independence, and organization workflows has not been run. REW-84 must remain **In Progress** until those checks pass. See `docs/qa/rew-84-clone-other-users-recipes.md`.

The category-copy failure path is compensating rather than transactional. A failed category insert triggers deletion of the new Private recipe and never reports success; if that cleanup deletion also fails, an incomplete Private row may remain and the error is logged.

## Open questions / assumptions

- REW-85 has already landed on `main` and supplies `GET /recipes/:id/clone`, clone-prefilled creation, private/public visibility controls, and clone links. REW-84 should refine that code rather than build a second competing workflow.
- The Jira wording says selecting Add Recipe creates a copy. This plan therefore uses a CSRF-protected POST action that clones immediately and redirects to the new owned recipe; it removes the intermediate clone form and the generic “Clone Recipe” action. The user can edit the new recipe afterward.
- “Original author” means the recipe's displayed `author` value at the root of the clone chain. A clone stores this as a separate, non-editable snapshot so later edits to either recipe's normal Author field cannot remove or rewrite the credit. If the source is already a clone, the root attribution snapshot is propagated rather than crediting the intermediate copier.
- Attribution is shown as a distinct “Originally by …”/“Adapted from …” line on cloned recipe detail and relevant owned-recipe cards. The ordinary editable `author` field continues to describe the current version and does not substitute for provenance.
- The direct source-recipe reference is retained while that row exists and becomes null if it is deleted; the author snapshot remains. This avoids preventing source deletion while preserving credit.
- Copy the source's recipe fields, category memberships, and source URL. Do not copy IDs, timestamps, ownership, visibility, likes, tags owned by another account, cookbook/meal-plan memberships, or hosted image URLs. The new copy starts Private, consistent with REW-85. The user can add their own tags, image, collections, favorites, and meal plans afterward.
- There is no general user-profile table; `recipes.author` is the only durable public recipe-author label. Account identity should not be exposed or joined from Supabase Auth for this feature.
- Add Recipe is available only to an authenticated non-owner viewing a public/RLS-visible recipe. Owners retain Edit and existing organization controls and do not see Add Recipe. Guests do not see an actionable Add Recipe control and may continue to receive the existing signup prompt.
- Repeated clicks create independent copies. Deduplicating clones is not required by the ticket; rate limiting and POST/redirect behavior should limit accidental resubmission.

## Tasks

1. Add durable clone-provenance columns to `recipes`: a nullable self-reference to the directly cloned source and a nullable original-author snapshot, with an index for lineage lookups, pairing/trim constraints, delete behavior that preserves the snapshot, and database enforcement preventing an owner from modifying or clearing provenance after creation. Update the schema reference and migration contract tests.
2. Replace the REW-85 clone-prefill GET workflow with a dedicated authenticated, rate-limited, CSRF-protected POST handler. Fetch the source with the caller-scoped Supabase client, reject missing/inaccessible/private/owned sources, derive root attribution server-side, insert a new Private recipe with `user_id = req.user.id`, and copy only an explicit allowlist of recipe fields.
3. Copy transferable category relationships for the new recipe after creation. Do not copy user-owned tags or any likes, cookbook entries, meal-plan entries, storage-backed image URLs, IDs, or timestamps. Define failure handling so a recipe is not reported as successfully added when required provenance or category work fails; prefer a database transaction/RPC if atomic multi-table creation is practical in the existing Supabase architecture, otherwise remove the newly inserted row on relationship failure and report the rollback result.
4. Redirect a successful Add Recipe request to the new owned recipe detail and show clear success feedback. Ensure subsequent edit/delete, cookbook, meal-plan, favorite/public-like, and visibility behavior uses the new recipe ID and existing owner flows, never the source ID.
5. Change authenticated public/non-owner recipe detail UI from “Clone Recipe” to a POST-based **Add Recipe** action with CSRF. Remove the clone action from owner detail pages, and preserve the owner Edit control. Do not render Add Recipe for guests or owners.
6. Render immutable original-author attribution for cloned recipes on owner/public detail pages and owned-recipe cards where appropriate. Keep it visually and semantically distinct from the editable Author field, escape it through normal EJS output, and retain it after edits to the clone.
7. Add focused route and view tests for action visibility, CSRF form contract, source access/ownership rules, copied/omitted fields, root attribution propagation, immutable provenance, independent edits, category copying, failure cleanup, and successful redirect. Add regressions proving the source row and sibling clones are untouched.
8. Update database/API documentation for the Add Recipe contract, provenance fields, clone-chain attribution, copied/omitted relationships, and deployment order. Run the full automated suite plus authenticated browser acceptance for owner, non-owner, guest, clone editing, and responsive/keyboard behavior.

## Affected files

- `database/migrations/018_add_recipe_clone_provenance.sql` — add source reference, durable author snapshot, index, constraints, and immutable-provenance enforcement.
- `database/migrations/018_add_recipe_clone_provenance.test.js` — verify the migration contract, foreign-key delete behavior, constraints, and provenance immutability.
- `database/schema.sql` — keep the reference schema aligned with clone-provenance columns and policies/triggers.
- `database/README.md` — document the new recipe fields, migration, lineage semantics, and deployment verification.
- `src/routes/recipeRoutes.js` — replace the clone-form GET handler with the authoritative Add Recipe POST flow, explicit copy allowlist, attribution derivation, category copy/failure handling, and redirect.
- `src/routes/recipeVisibilityRoutes.test.js` — replace obsolete clone-form expectations with Add Recipe authorization, visibility, ownership, provenance, and copy-isolation coverage (or split into a dedicated test file if clearer).
- `views/recipes/view.ejs` — remove owner clone action and render durable attribution when present.
- `views/recipes/public-view.ejs` — expose Add Recipe only to authenticated non-owners as a CSRF-protected form and render attribution.
- `views/partials/recipe-summary-card.ejs` — display clone attribution on current-user recipe listings without conflating it with editable author text.
- `src/views/recipeVisibility.test.js` — update view contracts for Add Recipe visibility/label/method/CSRF and attribution persistence.
- `docs/api/recipe-cloning.md` — proposed feature contract covering endpoint, copy allowlist, attribution, visibility default, authorization, and relationship semantics.
- `docs/api/README.md` — link the cloning documentation and record the route.

## Database changes

Migration required: `018_add_recipe_clone_provenance.sql`. Add a nullable `cloned_from_recipe_id` UUID self-reference on `recipes` with `ON DELETE SET NULL`, plus a nullable trimmed `original_author` text snapshot. Enforce that provenance is created as a valid pair and that the snapshot cannot become blank; add an index on the source reference. Add database-level immutable-provenance enforcement so normal owner UPDATE permission cannot alter `cloned_from_recipe_id` or `original_author` after insert. The application derives the snapshot from `source.original_author` for a clone-of-clone, otherwise from `source.author`. Existing records require no backfill and remain non-clones with both fields null. Existing owner CRUD and published-read RLS policies remain unchanged, but live migration acceptance must verify that the self-reference and trigger do not widen SELECT access or leak private sources.

## Security considerations

- Require authentication, CSRF validation, and rate limiting on the mutating Add Recipe endpoint. Use POST, not GET, for creation.
- Fetch the source through the request-scoped authenticated client and explicitly require `status = 'published'` plus `source.user_id !== req.user.id`; respond identically for missing and inaccessible/private sources.
- Set the new `user_id`, Private status, source ID, and original-author snapshot server-side. Do not accept provenance, ownership, status, IDs, timestamps, or relationship IDs from the browser.
- Copy an explicit field allowlist. Never copy another user's tags, likes, cookbook/meal-plan links, hosted storage URL, or other identity/relationship data.
- Keep update/delete queries explicitly scoped by both recipe ID and current user ID, in addition to RLS. Database enforcement must prevent provenance changes even through a direct authenticated data request.
- Escape attribution in EJS and apply a reasonable database/application length constraint consistent with the existing author field to avoid unbounded display content.
- Avoid partial success across recipe/provenance/category creation. If a transaction/RPC is introduced, fix its `search_path`, validate caller identity with `auth.uid()`, grant execution narrowly, and do not use a service-role client.

## Acceptance criteria

- [ ] An authenticated user viewing another user's Public recipe sees an **Add Recipe** action; the source owner and guests do not.
- [ ] Add Recipe is a CSRF-protected, rate-limited POST and rejects malformed, missing, Private/inaccessible, or current-user-owned source recipes without creating a row.
- [ ] A successful action creates exactly one new Private recipe owned by the current user and redirects to that new recipe's owned detail page with success feedback.
- [ ] The new recipe copies the source's supported content, source URL, and categories, but not IDs, timestamps, ownership, likes, tags, cookbook/meal-plan memberships, or hosted image URLs.
- [ ] The clone stores and displays a distinct original-author attribution snapshot; editing the clone's title, Author, ingredients, instructions, notes, visibility, or relationships does not change or remove that attribution.
- [ ] Cloning a clone preserves the root original-author attribution while recording the directly cloned source recipe where available.
- [ ] Editing or deleting the source or one clone does not modify any other version; deleting a source does not delete its clones and their attribution remains visible.
- [ ] The cloned recipe behaves as current-user-owned in edit/delete, cookbook, meal-plan, favorite/like where applicable, and Private/Public flows.
- [ ] Direct non-owner update/delete attempts against the original still affect zero rows under route filters and RLS, and direct attempts to rewrite stored clone provenance are rejected by the database.
- [ ] Required automated tests pass, migration contract tests pass, and browser acceptance covers owner/non-owner/guest visibility, keyboard use, and desktop/mobile layouts.
