# Release Notes: REW-19 - Cookbook Sharing

**Date:** 2026-09-14
**Jira Issue:** [REW-19](https://wanderingnerds.atlassian.net/browse/REW-19) (Story, Medium, epic REW-2 — Phase 2: Core Recipe Organization & Import)
**Branch:** `REW-19-cookbook-sharing`
**Pipeline:** Planner → Developer → Reviewer (**Approved**). **QA was deliberately skipped for this run.** These notes describe what was built and reviewed, not what has been verified in a live environment. REW-19 remains **In Progress** in Jira; it has not been transitioned to Done.

---

## Summary

Cookbook owners get one explicit, reversible **Private ↔ Public** choice per cookbook. Making a cookbook Public does two things at once:

1. **It becomes shareable.** Anyone — signed in or not — can open it read-only at `/c/<cookbook-id>`. The cookbook's own UUID *is* the share link, exactly the pattern the app already uses for public recipes at `/r/<recipe-id>`. There is no share token, no `cookbook_shares` table, and no per-user grant.
2. **It becomes discoverable.** Public cookbooks surface as a small secondary "Cookbooks" section on the existing `/search` results page.

Private is the default, stays the default for every new cookbook, and is the state of every cookbook that existed before migration `019`. Making a cookbook Private again revokes its link on the very next request — visibility is re-read from Postgres per request and never cached, so there is nothing to invalidate.

The privacy-critical behavior: a cookbook may contain the owner's Private (draft) recipes, because REW-62 deliberately made membership independent of publish status. A shared cookbook shows **only** Public recipes, and that is enforced structurally rather than by a filter someone could later remove — see "How draft privacy is enforced" below.

---

## User-Facing Changes

- A cookbook's detail page (`/cookbooks/:id`) now has a labelled visibility control in the header action row showing the current state (Private or Public) and a single button to switch it. It is visually and structurally distinct from the per-recipe Private/Public pills on the cards below, so "this cookbook is Public" can't be confused with "this recipe is Public."
- While a cookbook is Public, the detail page shows a share panel with the full URL in a read-only field and a **Copy link** button.
- Switching visibility shows a confirming flash in Private/Public wording: *"This cookbook is now Public. Anyone with the link can view it."* / *"This cookbook is now Private. Its share link no longer works."*
- The **My Cookbooks** list (`/cookbooks`) shows a Public marker on shared cookbooks so an owner can see at a glance which ones are out in the world.
- Opening a share link renders a read-only page: the cookbook's title, its recipe count, and its Public recipes as cards linking through to `/r/:id`. There is no edit, rename, delete, add-recipe, or remove-recipe control anywhere on that page **for anyone, including the owner opening their own link**. Signed-out visitors also see a sign-up call to action.
- A Public cookbook whose recipes are all Private renders a neutral empty state ("This cookbook doesn't have any Public recipes yet.") with no hint that anything is hidden — no "n recipes hidden" counter.
- A Private cookbook, a nonexistent cookbook, and a malformed link all return the same 404 page with the same message, so a Private cookbook's existence can't be probed.
- Searching from the top nav returns matching Public cookbooks in a "Cookbooks" section beneath the recipe grid, each showing the title and its published-recipe count. If a query matches zero recipes but at least one cookbook, the page shows the cookbooks instead of a dead-end "no results."
- Private cookbooks never appear in search, for anyone, including the owner searching the exact title.

---

## Technical Changes

### Database — one new migration

`database/migrations/019_add_cookbook_sharing.sql` (new; migrations `001`–`018` are untouched). Purely additive, exactly as `009_create_cookbooks_table.sql`'s header anticipated:

- `cookbooks.is_public BOOLEAN NOT NULL DEFAULT false` — so every pre-existing row is Private with no backfill.
- `cookbooks.search_vector` — a generated, stored `tsvector` over `title`, plus a GIN index and a `gin_trgm_ops` trigram index on `title` for the partial-match fallback.
- A partial index on `cookbooks (created_at DESC) WHERE is_public = true`, mirroring the published-recipe index from `003_add_recipe_search.sql`.
- **Two additive SELECT policies**, both `TO anon, authenticated`. On `cookbooks`: rows where `is_public = true`. On `cookbook_recipes`: rows where the parent cookbook is public **and** the referenced recipe has `status = 'published'`. The second condition is not redundant — without it, an anonymous PostgREST read of `cookbook_recipes?cookbook_id=eq.<public_id>&select=recipe_id,created_at` would have disclosed the count, UUIDs, and add-times of the owner's drafts even while the recipe rows themselves stayed hidden. The four owner-only policies from `009` and the three from `010` are untouched, and permissive policies are OR'd, so the owner still sees all of their own membership rows.
- Explicit `GRANT SELECT` on both cookbook tables to `anon, authenticated`, matching the pattern in `003` and `013`. RLS remains the row-visibility boundary; the grant only permits the read to be attempted.
- `search_cookbooks(text, integer, integer)` — `LANGUAGE sql`, `STABLE`, **`SECURITY INVOKER`**, `SET search_path = public, pg_temp`, an exact match for `search_recipes`'s posture. Filters `is_public = true` as defence in depth on top of RLS, matches via `websearch_to_tsquery` with an escaped `ILIKE` fallback, clamps limit/offset, and returns a **published-only** `recipe_count` plus `total_count` from a `count(*) OVER ()` window. `EXECUTE` granted to `anon, authenticated`.
- **No change to `recipes`, its policies, or its grants.**

### `src/routes/publicRoutes.js`

- New `GET /c/:id`. Screens the ID against the file's UUID pattern, fetches the cookbook on `id` + `is_public = true`, and renders the generic 404 for missing *and* private rows with one identical message. Recipes are fetched by a small local helper using an inner-join embed (`recipes!inner(...)`) plus an explicit `status = 'published'` filter, ordered by the membership row's `created_at` descending. **Every query runs on the module-level anon-key client.** No owner-scoped client is constructed anywhere in the handler, and the rendered page has no `isOwner` branch.
- `GET /search` extended: when the query is non-empty and `page === 1`, it also calls `search_cookbooks` with limit 5, offset 0, reusing the same already-trimmed and length-capped query string. Page 2+ skips the RPC — the section is a capped set, not a paginated one, and re-running it would repeat the same five cookbooks under every page. A `search_cookbooks` failure is logged and degrades to an empty array rather than flashing and redirecting the way a recipe-search failure does. `cookbooks` is passed on every render path, including the empty-query path.

### `src/routes/cookbookRoutes.js`

New `POST /:id/visibility` behind `requireAuth` and the **existing** `cookbookLimiter` (30/min per user — no new limiter). Screens the ID, normalizes `req.body.visibility` fail-closed, and updates with both `.eq("id", id)` and `.eq("user_id", req.user.id)` plus `.select().maybeSingle()`, so a missing row and someone else's row are indistinguishable. A real database error and a not-found result are logged differently but produce the same user-facing flash. The handler is exported with an injectable client factory for unit testing, following the `handleRecipeUpdate` precedent. `GET /:id` now also passes `appUrl: getAppUrl()` so the view can render the share URL.

### `src/utils/cookbookUtils.js`

Adds `COOKBOOK_VISIBILITY` and `normalizeCookbookVisibility()`, which returns `true` only for the exact string `"public"` — a missing field, an array from duplicated inputs, wrong casing, `"true"`, a number, or an object all resolve to Private. Modeled directly on `normalizeRecipeVisibility()` from REW-85.

### Views and assets

- `views/cookbooks/public-view.ejs` (new) — read-only shared-cookbook page reusing `views/partials/recipe-card.ejs` and the shared `organization-card-grid` class. No mutation form exists anywhere in the template.
- `views/cookbooks/view.ejs` — visibility control, share-link panel, and a page-local `<script src="/js/cookbook-share.js">` tag.
- `views/cookbooks/index.ejs` — Public marker on shared cookbooks.
- `views/recipes/search.ejs` — guarded "Cookbooks" results section, visually secondary to the recipe grid.
- `public/js/cookbook-share.js` (new) — Copy-link handler only, using `navigator.clipboard.writeText` with a visible confirmation and a graceful fallback when the Clipboard API is unavailable or the page isn't a secure context. External file only; CSP is `script-src 'self'` and was not changed.
- `public/css/styles.css` — one additive REW-19 block.

New locals (`appUrl` on the cookbook view, `cookbooks` on the search page, `is_public` on cookbook cards) are all `typeof`-guarded so the existing view tests, which render these templates with fixed fixtures, keep passing.

---

## How draft privacy is enforced

Three layers, listed in the order of how much weight each actually carries:

1. **The anon key.** `/c/:id` and its recipe fetch use the anon-key Supabase client exclusively. Under it `auth.uid()` is null, so the `recipes` SELECT policy from migration `001` (owner **or** `status = 'published'`) can only return published rows. A draft in a Public cookbook is invisible at the database layer regardless of what the route handler does — including when the owner is the one viewing.
2. **The junction policy.** The new `cookbook_recipes` policy requires the recipe to be published, so the drafts can't be enumerated through a direct anon-key API read either. The threat model is the raw PostgREST request, not just the rendered page.
3. **The explicit predicate.** `status = 'published'` in the query itself, as defence in depth, mirroring what `GET /r/:id` already does.

Deliberate consequence: a Public cookbook containing only Private recipes renders empty. That is correct, and it has its own empty state.

---

## Decisions and Tradeoffs

| Decision | Rationale | Tradeoff accepted |
|---|---|---|
| Two states (Private/Public), not three | The ticket asks for exactly two mechanisms bound to one flag; an "unlisted" middle state was not requested | No link-only-but-unsearchable option. If wanted later, `is_public` splits into two independent booleans |
| No share token or slug — the cookbook UUID is the link | Matches the existing `/r/:id` precedent; a token doubles the surface area for the sole benefit of revoking the link independently of search visibility. UUIDv4 is not enumerable | Revoking the link and removing from search are the same action; they can't be decoupled |
| No cookbook-level owner attribution on the public page | `getAccountDisplayName()` reads `user_metadata` off an auth user object — it can only describe the current viewer, and the anon client can't read another account's `auth.users` row at all. Doing it properly needs a public profiles table or an owner-name snapshot column, i.e. a new privacy decision and new schema the ticket never asked for | A shared cookbook shows no "by <owner>" line. Per-recipe attribution still appears, since each card renders the free-text `recipe.author` (REW-46) |
| Search results capped at 5, not paginated | Recipes are the primary result set on a recipe site; the ticket asks for discoverability, not a cookbook-search page | No "see all cookbooks matching X." That's a follow-up if wanted |
| `tsvector` + GIN rather than plain `ILIKE` | Consistent with `003_add_recipe_search.sql`, and future-proof if cookbooks ever gain a description | Ranking is necessarily title-only today |
| The public page is read-only for *everyone*, including the owner | Removes the `isOwner` branch entirely, so there is nothing to get wrong and no reason for the handler to construct an owner-scoped client | An owner previewing their share link has to go back to `/cookbooks/:id` to edit |
| `search_cookbooks` failures degrade silently | Cookbook results are a bonus surface; a cookbook-search outage must not take recipe search down with it | A silent outage is only visible in the logs |
| Cookbook-level cloning out of scope | Per the ticket's own out-of-scope section | Tracked as follow-up [REW-91](https://wanderingnerds.atlassian.net/browse/REW-91). Recipe-level cloning (REW-84) already works from `/r/:id`, so visitors can copy recipes one at a time today |

---

## Breaking Changes

None. Purely additive: one new column and one generated column on an existing table, two new permissive SELECT policies (existing policies untouched), new indexes and grants, one new RPC, two new routes on previously-unused paths, and new optional template locals. No existing route, table, response shape, or environment variable changed.

---

## Deployment

- **Migration `019_add_cookbook_sharing.sql` must be run manually** against the Supabase project's SQL editor, after `018`, following this repo's standard workflow (see `database/README.md`). Until it is applied, `POST /cookbooks/:id/visibility` and `GET /c/:id` will error and the search page's Cookbooks section will stay empty.
- No backfill is required — `is_public` is `NOT NULL DEFAULT false`, so every existing cookbook is Private the moment the migration completes.
- The migration runs `CREATE EXTENSION IF NOT EXISTS pg_trgm`, which `003_add_recipe_search.sql` already enabled; it is a no-op on an existing database.
- **No new environment variables.** `APP_URL` must already be set correctly in Vercel's Production environment (required since REW-57) — it is now also the origin of every share link an owner copies, so a wrong value produces links that don't work for recipients.
- No Vercel configuration changes, no new packages, no auth/CSRF/CSP/rate-limiter middleware changes.
- Rollback is documented in the migration header and in `database/README.md`: dropping the RPC, the two policies, the three indexes, and the two columns returns cookbooks to REW-62 behavior with no data loss. Application code must be rolled back alongside it.

---

## Testing

**Reviewer verdict: Approved.**

**Automated:** `npm test` — **355 tests, 353 passing.** The 2 failures are pre-existing environmental `EACCES /tmp/*.sock` unix-socket errors in `src/csrf.integration.test.js` on Windows, unrelated to this change.

New and extended coverage:
- `src/utils/cookbookUtils.test.js` — `normalizeCookbookVisibility()` fail-closed cases.
- `src/routes/cookbookVisibilityRoutes.test.js` (new) — the stored value flips correctly for both inputs; both `id` and `user_id` filters are applied on every call; a malformed UUID never reaches the database; an unknown `visibility` value fails closed to Private.
- `src/routes/publicRoutes.test.js` — `/c/:id` filters on both `id` and `is_public = true`; a null result renders the 404 path; migration `019` literally contains an `is_public = true` predicate, declares `SECURITY INVOKER`, and contains no `MATERIALIZED VIEW`.
- `src/views/*` — `views/cookbooks/public-view.ejs` contains no edit/delete/add-recipes/remove strings and no mutation `<form>`, links go to `/r/<id>`, and the empty state renders for an empty recipe list. The pre-existing `recipeCard.test.js`, `recipeVisibility.test.js`, and `organizationCardGrid.test.js` all still pass against the edited templates.

### QA was not run — unverified acceptance criteria

**No part of this feature has been exercised against a live Supabase with migration `019` applied.** The following acceptance criteria from `docs/plans/rew-19-cookbook-sharing.md` are **not** verified and must not be treated as passing:

- **AC3** — the rendered share URL's origin comes from `APP_URL`/`getAppUrl()` and does not change under a spoofed `Host` / `X-Forwarded-Host`, and the Copy button works.
- **AC5** — a Public cookbook containing at least one Private recipe shows zero trace of it at `/c/:id` — not in the cards, not in the count, not in the page source — to a logged-out visitor, a different logged-in user, **and** the owner.
- **AC6** — a Public cookbook whose recipes are all Private renders the neutral empty state.
- **AC11** — a direct PostgREST read of another user's Private cookbook row, and of a Public cookbook's draft membership edges, returns nothing for both an anonymous key and a different authenticated user.
- **AC12** — toggling visibility changes no recipe's `status`, adds or removes no membership, and cookbook deletion still deletes zero recipes.
- **AC14** — the visibility endpoint is rate-limited at 30 mutations/minute like every other cookbook mutation.

The remaining criteria (AC1, AC2, AC4, AC7–AC10, AC13, AC15, AC16) are supported by code review and the automated suite but have likewise not had a manual browser pass. A full manual run against the plan's 16-item checklist is required before this is called done.

---

## Documentation

- `README.md` — new "Cookbook Sharing (REW-19)" feature section; the Cookbooks section's "sharing is a not-yet-built feature" line corrected; Project Structure updated for `publicRoutes.js`, `public-view.ejs`, and `cookbook-share.js`; `APP_URL` notes extended to mention share links.
- `docs/api/cookbooks.md` — `POST /cookbooks/:id/visibility`, the public `GET /c/:id` contract including its identical-404 table, the `GET /search` extension, owner-facing UI notes, sharing-specific security notes, and testing/QA-gap notes. Also corrected a stale claim in that page's Security section that CSRF was disabled repo-wide — it is enforced.
- `docs/api/README.md` — visibility row added to the Cookbooks endpoint table, new "Public cookbook sharing" table, updated detailed-docs link text.
- `database/README.md` — migration row 19; the `is_public` and `search_vector` columns; a new "Search functions (RPCs)" section covering `search_recipes` and `search_cookbooks`; the two new RLS policies and why the junction policy checks recipe status; new grants; new index entries; a sharing/draft-privacy note; a REW-19 deployment note; and a sharing-only rollback snippet. **Also fixed a pre-existing gap: the migration table never listed `003_add_recipe_search.sql` at all.**
- `docs/RELEASE_NOTES_REW-19.md` — this file.
- `docs/confluence/REW-19-cookbook-sharing.md`, `docs/confluence/JIRA_COMMENT_REW-19.md` — repo record of the Confluence pages and Jira comment that were actually published this session.
- Confluence (posted): **[Release: REW-19 - Cookbook Sharing](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30408705/Release+REW-19+-+Cookbook+Sharing)** (new) and **[Cookbooks (REW-62, REW-19)](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25067521/Cookbooks+REW-62+REW-19)** (the planner's page, brought from planned to as-built).
- `docs/plans/rew-19-cookbook-sharing.md` — left at its planning-complete state, matching this repo's convention.
- No `design_handoff_recipe_form/` changes — that directory does not exist in this repository, and this change touches cookbook pages and the search page, not the recipe form.

---

## Open Items for a Human

1. **Run migration `019` against Supabase.** It has not been applied to any live project by this pipeline run.
2. **Run QA.** The six acceptance criteria listed above can only be confirmed against a live database, and none of the sixteen have had a manual browser pass.
3. **Decide the Jira status.** REW-19 was deliberately left **In Progress**. It should not move to Done until QA has run.
4. **Confirm the share-link copy reads well in production**, in particular that `APP_URL` in Vercel matches the canonical origin users expect to receive.
