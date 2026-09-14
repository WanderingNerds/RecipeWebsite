# Recipe visibility

Recipe visibility is presented as **Private** or **Public**. The database continues to store these values as `draft` and `published`, respectively; no schema or data migration is required.

Manual creation (`POST /recipes`), import save (`POST /recipes/import/save`), and owner update (`POST /recipes/:id/update`) accept a scalar `visibility` value. Only `private` and `public` are recognized. Missing, malformed, legacy, or tampered values fail closed to `draft` (Private).

`POST /recipes/:id/clone` requires authentication, CSRF validation, and a different user's Public source. It creates an independent Private recipe rather than prefilling the creation form. Source visibility is checked through both caller-scoped RLS and an explicit `status = 'published'` predicate. See [Add Recipe / Cloning](recipe-cloning.md) for the copy and provenance contract.

Owner updates retain both the route-level `id` + `user_id` filter and database RLS. Browse and `/r/:id` retain explicit `status = 'published'` predicates. Search uses the existing `search_recipes` database function, which also filters to published rows. Visibility changes therefore affect public reads on the next request.
