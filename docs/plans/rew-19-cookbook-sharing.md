# REW-19: Cookbook Sharing

## Jira issue
**REW-19** (Story, Medium priority, status To Do) — https://wanderingnerds.atlassian.net/browse/REW-19
Related: REW-62 (Create and Manage Cookbooks — the private-cookbook feature this ticket extends). REW-62's own migration (`009_create_cookbooks_table.sql`) explicitly anticipated this: *"sharing can be added later as an ADDITIONAL SELECT policy... without reworking this migration."*

## Confluence page
Target: [Cookbooks (REW-62)](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25067521) — update in place with a "REW-19: Cookbook Sharing" section (this is the existing feature-reference page for cookbooks; do not fork a new page). Also update its "Explicitly out of scope" line, which currently points here.

## Summary
Two sharing mechanisms, both requested by the user and both additive to the REW-62 schema:
1. **Public + share link.** An owner can flip a cookbook to "public," which reveals a shareable URL (`/c/:id`) that anyone — including logged-out visitors — can open to view the cookbook read-only. Flipping it back to private immediately revokes the link (no separate token to invalidate; the link's own page re-checks `is_public` on every request).
2. **Discoverable via the top search bar.** Public cookbooks show up as a distinct section in `/search` results, alongside recipes, so other users can find them without a direct link.

Both mechanisms share one new boolean column and one new pair of RLS SELECT policies — there is no separate "share token" system. A cookbook's `id` (a UUID, already unguessable) doubles as its share-link identifier, exactly like the existing public recipe view (`GET /r/:id`) already does for recipes. This plan follows that same established pattern end-to-end: a public cookbook view is a new route in `publicRoutes.js` using the anon-key `supabase` client (never the owner's elevated client), not a new page under `/cookbooks/*` (which stays entirely owner-only, `requireAuth`-gated).

**The critical privacy edge case this plan is built around:** a cookbook can contain draft recipes (REW-62 made membership independent of publish status). A public cookbook must never leak an owner's unpublished draft to a visitor. The fix is structural, not a filter someone could forget to write: the public cookbook view queries recipes through the **anon-key client**, and the existing `recipes` RLS policy from `001_create_recipes_table.sql` already only allows `status = 'published'` OR `user_id = auth.uid()` reads. A logged-out (or different-user) visitor's `auth.uid()` never matches the owner, so draft recipes are invisible at the database layer regardless of what the route handler does — the same defense-in-depth pattern REW-62 already uses for `cookbook_recipes` INSERT.

## Open questions / assumptions
- **Boolean, not a third "unlisted" state.** The user asked for exactly two states (private/public where public = both linkable and searchable) — no "link-only, not searchable" middle state. If that's wanted later, `is_public` would need to split into two independent flags; not built now to avoid speculative complexity.
- **No separate share-token/slug.** Considered and rejected: a random unguessable token (like a `cookbook_shares` table with its own token column) would let an owner revoke *one* link without affecting search visibility, and would prevent guessing which cookbooks exist by iterating UUIDs (moot — UUIDs aren't iterable). Rejected because it doubles the surface area (two mechanisms to keep in sync) for a distinction the ticket didn't ask for, and because this app already trusts bare UUIDs as the sole access control for public recipes (`/r/:id`) — reusing that exact precedent keeps the two "share a thing publicly" features consistent.
- **Search ranking.** Recipes get a weighted, `tsvector`-based ranked search (`003_add_recipe_search.sql`). Cookbooks only have a `title` to search (no ingredients/instructions), so this plan uses the same `tsvector`+GIN-index infrastructure for consistency and future-proofing (e.g. if a cookbook `description` field is added later) rather than a plain `ILIKE`, but ranking is necessarily simpler (title-only).
- **Cross-user "save this cookbook to mine" / cloning.** Not requested and not built. A natural follow-up once sharing exists, but out of scope here — flag as a recommended follow-up ticket, not built speculatively.
- **Owner attribution on the public view.** Shows the owner's display name (via the existing `getAccountDisplayName()` helper from REW-46), matching how `recipes/public-view.ejs` already shows `recipe.author`. This is not new private information — the cookbook is already being shown to the public.

## Tasks

1. **`database/migrations/011_add_cookbook_sharing.sql`** (new, single migration, following the `003_add_recipe_search.sql` precedent of bundling a feature's column + index + search infra + RPC into one file):
   - `ALTER TABLE cookbooks ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false;`
   - Partial index `idx_cookbooks_is_public ON cookbooks(created_at DESC) WHERE is_public = true` (mirrors the existing partial index pattern on `recipes(status, created_at)` for the browse page — public cookbooks will eventually want a "browse public cookbooks" listing too, though that's not required by this ticket).
   - New RLS policy on `cookbooks`: `"Public cookbooks are viewable by anyone"` — `FOR SELECT USING (is_public = true)`. Additive; does not touch the existing owner-only SELECT policy from 009.
   - New RLS policy on `cookbook_recipes`: `"Public cookbook recipes are viewable by anyone"` — `FOR SELECT USING (EXISTS (SELECT 1 FROM cookbooks WHERE cookbooks.id = cookbook_recipes.cookbook_id AND cookbooks.is_public = true))`. Additive alongside the existing owner-only policy from 010.
   - Generated `tsvector` column on `cookbooks.title` (e.g. `search_vector`) + GIN index, mirroring `003`'s approach on `recipes`.
   - New RPC `search_cookbooks(search_query TEXT, result_limit INT, result_offset INT) RETURNS TABLE(...)`, **STABLE, SECURITY INVOKER** (same security posture as `search_recipes` — RLS still applies underneath, so even a bug in this function's own `WHERE is_public = true` clause can't leak a private cookbook), filtering `is_public = true`, ranking by `ts_rank` against the query, returning `id, title, user_id, created_at, total_count` (window-counted, matching `search_recipes`'s pagination shape) plus enough to join a recipe count if useful.
   - Rollback note in the migration's header comment, matching this repo's convention (see `010`'s and `003`'s headers).

2. **`src/routes/cookbookRoutes.js`** — new mutation endpoint:
   - `POST /cookbooks/:id/visibility` — `requireAuth`, `cookbookLimiter` (reuse the existing 30/min/user limiter, no new one needed). Body: `{ isPublic: "true" | "false" }` (simple form checkbox/toggle, not a JSON API). Ownership-checked via `getOwnedCookbook()` (existing helper) before the update, belt-and-suspenders alongside RLS's `UPDATE` policy (unchanged from 009 — owners can already update their own cookbook rows; only a new *column* is being written, no new UPDATE policy needed). Flash success ("Cookbook is now public — anyone with the link can view it." / "Cookbook is now private.") and redirect to `/cookbooks/:id`.

3. **`src/routes/publicRoutes.js`** — two additions, following the file's existing "every route here is public, use the anon-key client" convention exactly:
   - **`GET /c/:id`** (new) — public, read-only cookbook view. UUID-shape-check `id` first (same pattern as `/r/:id`), then query `cookbooks` via the plain `supabase` (anon-key) client filtered on `id` + `is_public = true`; treat "doesn't exist" and "exists but private" identically (`renderNotFound`, same helper already in this file) so a private cookbook's existence is never revealed to a non-owner. Fetch its recipes the same way `getCookbookRecipes()` does in `cookbookRoutes.js` but via the anon client (add a shared helper or a small local duplicate — see Affected files) — this is the step where RLS silently excludes any draft recipes, as described in Summary above. Render a new `views/cookbooks/public-view.ejs`.
   - **`GET /search`** (extended) — alongside the existing `search_recipes` RPC call, also call the new `search_cookbooks` RPC (same anon-key `supabase` client already used in this handler) when `query` is non-empty, and pass `cookbooks` (+ its own `page`/`totalPages`/`totalCount`, or simply cap it to a small fixed number like 5 with a "see more" link to keep this a lightweight secondary result set rather than a second fully-paginated list — recommend the latter, since the ticket asks for discoverability, not a dedicated cookbook-search page) into `recipes/search.ejs`.

4. **`views/cookbooks/view.ejs`** (owner's cookbook detail page, existing) — add a visibility control: a toggle/button posting to `POST /cookbooks/:id/visibility`, and, only when `cookbook.is_public` is true, a read-only text input (or plain text) showing the full share URL (`${appUrl}/c/${cookbook.id}`) with a "Copy link" button. `appUrl` should come from `getAppUrl()` (the helper added in REW-57, `src/utils/authUtils.js`) via `res.locals` or passed in from the route — **do not** build it from `req.headers.host`, for the same header-injection reason REW-57 documented for email links (this one renders into an `<input>`/link a visitor could copy and share further, so the same care applies).

5. **`public/js/cookbook-share.js`** (new, small) — the "Copy link" button's `navigator.clipboard.writeText()` handler, loaded from `views/cookbooks/view.ejs` only (not globally via `main.ejs` — this control only exists on one page, unlike REW-57's `auth-recovery.js` which had to run everywhere). CSP (`scriptSrc: 'self'`) requires this as an external file; no inline `onclick`.

6. **`views/cookbooks/public-view.ejs`** (new) — read-only rendering: cookbook title, owner display name (via `getAccountDisplayName()`), its (published-only, per RLS) recipes as cards (reuse `views/partials/recipe-card.ejs` if its props line up with what's fetched here, otherwise a minimal inline list — check its expected fields before deciding). No edit/delete/add-recipe affordances — this page renders for anyone, including the owner viewing their own share link, and being read-only for everyone (owner included) is intentional and simpler than branching the template on `isOwner`.

7. **`views/recipes/search.ejs`** — add a "Cookbooks" section (only rendered when the new `cookbooks` array is non-empty) above or below the existing recipe results, each linking to `/c/:id`. Keep it visually secondary to recipe results (this is a recipe site; cookbook search is a bonus surface, not the primary one).

8. **`src/utils/cookbookUtils.js`** — no new pure helpers are strictly required for a boolean toggle, but add one small validator if the visibility endpoint's body needs normalizing (e.g. `isPublic === "true"` vs a stray value) — keep it in this file for consistency rather than inlining a one-off check in the route, matching this file's existing role as the home for cookbook-related pure logic.

9. **Documentation** (for the Documentation stage once implemented): `docs/api/cookbooks.md` (new endpoints + `GET /c/:id`), `docs/api/README.md` (search endpoint note), `database/README.md` (migration 011 entry, new RLS policies, new RPC), `README.md` (feature bullet), `docs/RELEASE_NOTES_REW-19.md` (new), Confluence per above.

## Affected files
- `database/migrations/011_add_cookbook_sharing.sql` — new.
- `src/routes/cookbookRoutes.js` — new `POST /:id/visibility` route.
- `src/routes/publicRoutes.js` — new `GET /c/:id` route; `GET /search` extended to also query `search_cookbooks`.
- `src/utils/cookbookUtils.js` — optional small validator for the visibility toggle body.
- `views/cookbooks/view.ejs` — visibility toggle + share-link display.
- `views/cookbooks/public-view.ejs` — new.
- `views/recipes/search.ejs` — new "Cookbooks" results section.
- `public/js/cookbook-share.js` — new (copy-link button only).
- Not touched: `src/middleware/authMiddleware.js`, `src/app.js`, `src/config/supabase.js`, `views/cookbooks/index.ejs` / `edit.ejs` / `add-recipes.ejs` (owner-only pages, unaffected by adding a visibility toggle elsewhere), `database/migrations/009_*`/`010_*` (append-only, never edit an applied migration).

## Database changes
One new migration, `011_add_cookbook_sharing.sql` — see Task 1. No changes to `009`/`010`. No changes to the `recipes` table or its RLS (the existing published/owner policy is exactly what's relied on for draft-recipe privacy — see Summary).

## Security considerations
- **The draft-recipe leak this plan is built to prevent** (see Summary) — the public cookbook view and the public cookbook-recipe fetch must use the anon-key client, never `createSupabaseClient(req.accessToken)` or any owner-scoped client. This is the single most important review point for this ticket.
- **Private-cookbook existence must not leak.** `GET /c/:id` for a private or nonexistent cookbook must render the same generic "not found" response either way (matching the existing `renderNotFound()` pattern already used for `/r/:id`).
- **No new open redirect / SSRF surface.** The share link is a fixed internal path (`/c/:id`) built from a UUID already stored in the database — nothing user-suppliable shapes the URL beyond the existing `:id` param pattern already used by `/r/:id`, `/cookbooks/:id`, etc.
- **`search_cookbooks` RPC must be STABLE + SECURITY INVOKER**, matching `search_recipes` — RLS stays the real enforcement boundary; the RPC's own `is_public = true` filter is a performance/correctness convenience, not the security control.
- **Rate limiting.** The new visibility-toggle endpoint reuses the existing `cookbookLimiter` (30/min/user) — no new limiter needed, but confirm it's actually applied (easy to forget on a newly-added route).
- **CSRF.** Remains globally disabled repo-wide (pre-existing). The new visibility-toggle form should still carry the inert `_csrf` field for consistency with every other form in this app.
- **Share-URL construction uses `getAppUrl()`**, never `req.headers.host` (see Task 4) — this is a publicly-copyable link, and a header-injected origin would let an attacker construct a share link pointing at an attacker-controlled host under the app's own visual branding.
- **No cache/CDN leakage of private state.** Both `GET /c/:id` and the extended `GET /search` return per-request-authoritative data straight from Supabase (via RLS), not a cached "is this public" flag from an earlier request — this matters if a cookbook is unshared moments after being viewed.

## Acceptance criteria
Derived from the ticket's own two requested mechanisms plus REW-19's existing Jira description ("Share entire collections or cookbooks with other users"):
- [ ] AC1 — An owner can toggle their own cookbook to "public" from its detail page, and back to "private," at will.
- [ ] AC2 — When a cookbook is public, its detail page shows a copyable share link (`/c/:id`).
- [ ] AC3 — Visiting a public cookbook's share link while logged out renders the cookbook's title, owner name, and its **published** recipes only — no edit/delete/add controls, no draft recipes, even if the cookbook contains some.
- [ ] AC4 — Visiting a private (or nonexistent) cookbook's `/c/:id` link — as a logged-out visitor, or as a different logged-in user — renders the same generic "not found" response Rin both cases.
- [ ] AC5 — Making a previously-public cookbook private immediately breaks its old share link (re-visiting it 404s/"not found"s).
- [ ] AC6 — Searching the top search bar for a public cookbook's title surfaces it in a distinct "Cookbooks" section of the `/search` results page, linking to its `/c/:id` share page.
- [ ] AC7 — A private cookbook never appears in search results, for any user (including its own owner searching their own cookbook's title — search only surfaces the *public* view, consistent with AC6 only covering public cookbooks; the owner still finds their own cookbooks via `/cookbooks`, unaffected by this ticket).
- [ ] AC8 — A recipe's cookbook membership and publish status are unaffected by the cookbook's own public/private state — deleting a cookbook still never deletes its recipes (unchanged REW-62 behavior), and making a cookbook public never publishes a draft recipe inside it.
- [ ] AC9 — `npm test` passes with no regressions to the existing 120 tests plus any new unit coverage for the visibility-toggle validator (if one is added per Task 8).

## References
- REW-62 plan (`docs/plans/rew-62-cookbooks.md`) and its Confluence page — the base schema/routes this plan extends.
- `database/migrations/003_add_recipe_search.sql` — the `tsvector`+GIN-index+SECURITY INVOKER RPC pattern this plan reuses for `search_cookbooks`.
- `src/routes/publicRoutes.js` (`GET /r/:id`) — the existing "public view via anon-key client, generic not-found for private/missing" pattern this plan reuses for `GET /c/:id`.
- `src/utils/authUtils.js` (`getAppUrl()`, added REW-57) — reused for building the share link without trusting request headers.
