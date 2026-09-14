# Add Recipe / Cloning (REW-84)

## Endpoint

`POST /recipes/:id/clone` creates a new, independently owned recipe from another user's Public recipe. It requires authentication and a valid CSRF token and is protected by a recipe-clone rate limit. The source owner, guests, malformed IDs, and callers who cannot read the source receive no clone. A successful request redirects to `/recipes/{newRecipeId}` and reports that the recipe was added.

The handler reads through the caller-scoped Supabase client and also requires `status = 'published'` and a different `user_id`. This preserves RLS concealment for Private recipes.

## Copy contract

The new row is always owned by the authenticated caller and starts Private (`status = 'draft'`). Only this content allowlist is copied:

- `title`, `author`, `prep_time`, `cook_time`, `servings`, `difficulty`
- `ingredients`, `instructions`, `notes`, and `source_url`

The direct source ID is stored in `cloned_from_recipe_id`. `original_author` snapshots the source's root attribution: an existing `original_author` is propagated through clone chains; otherwise the source's `author` is used.

The new recipe receives the source's category memberships. It does not receive source IDs or timestamps, ownership, visibility, likes/favorites, user-owned tags, cookbook or meal-plan memberships, or storage-backed photo/thumbnail URLs. The caller can attach their own image, tags, and organization relationships later.

If copying required categories fails after row creation, the handler deletes the new row before reporting failure. Cleanup failure is logged and no success redirect is emitted.

## Independence and provenance

Edits and deletes continue to use the new recipe ID and existing owner-scoped routes. They never update the source or sibling clones. Deleting a source sets a clone's `cloned_from_recipe_id` to null, while its `original_author` snapshot remains visible.

Migration `018_add_recipe_clone_provenance.sql` adds the paired provenance fields, lineage index, constraints, and a trigger that rejects updates to either provenance value. Existing recipes retain null provenance.

## Deployment order and verification

Apply migration 018 before deploying the application route and templates. Verify that the columns, foreign key (`ON DELETE SET NULL`), constraints, index, and immutability trigger exist, then exercise the POST flow as an authenticated non-owner. Also confirm owner and guest pages omit Add Recipe and that Private sources remain inaccessible.
