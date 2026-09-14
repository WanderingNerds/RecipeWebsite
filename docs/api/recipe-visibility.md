# Recipe visibility

Recipe visibility is presented as **Private** or **Public**. The database continues to store these values as `draft` and `published`, respectively; no schema or data migration is required.

Manual creation (`POST /recipes`), import save (`POST /recipes/import/save`), and owner update (`POST /recipes/:id/update`) accept a scalar `visibility` value. Only `private` and `public` are recognized. Missing, malformed, legacy, or tampered values fail closed to `draft` (Private).

`GET /recipes/:id/clone` requires authentication and reads the source through the caller's request-scoped Supabase client. Existing RLS therefore permits an owner's Private or Public recipe and another user's Public recipe, while concealing another user's Private recipe. The form copies editable textual fields plus category/tag selections, suggests a collision-free title, omits the source photo and all relationship/identity data, and always starts Private. Submitting the form creates a normal new recipe with `user_id` set from the authenticated request.

Owner updates retain both the route-level `id` + `user_id` filter and database RLS. Browse and `/r/:id` retain explicit `status = 'published'` predicates. Search uses the existing `search_recipes` database function, which also filters to published rows. Visibility changes therefore affect public reads on the next request.
