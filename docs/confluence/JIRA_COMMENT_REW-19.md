# Jira Comment for REW-19

**Posted to [REW-19](https://wanderingnerds.atlassian.net/browse/REW-19) on 2026-09-14.** REW-19 was deliberately **left In Progress** — it was not transitioned to Done, because QA has not run.

---

## Implementation and documentation complete; reviewer-approved. QA was NOT run — do not treat this as verified

Cookbook sharing is implemented: one explicit, reversible Private/Public choice per cookbook. Public makes a cookbook readable by anyone at `/c/<id>` and discoverable in site search; Private is the default and stays the default, and flipping back to Private revokes the link on the very next request (visibility is read from Postgres per request and never cached). The cookbook's own UUID is the share identifier — same pattern as the existing public recipe view at `/r/<id>` — so there is no share token and no new table.

Draft recipes inside a shared cookbook are protected structurally, not by an application filter: `/c/:id` runs entirely on the anon-key Supabase client, where `auth.uid()` is null, so the existing `recipes` SELECT policy can only return published rows. The new `cookbook_recipes` policy additionally requires the referenced recipe to be published, so the drafts cannot be enumerated through a direct anon-key API read either.

**Review:** Approved.

**Automated validation:** full Node suite **355 total, 353 passing**. The 2 failures are pre-existing environmental `EACCES /tmp/*.sock` unix-socket errors in `src/csrf.integration.test.js` on Windows, unrelated to this change. New coverage: fail-closed visibility normalizer, visibility-handler unit tests (value flips, both `id`/`user_id` filters applied, malformed UUID never reaches the database, unknown value fails closed), `/c/:id` predicate and 404-path tests, migration-content assertions for `019`, and public-view render assertions.

**Documentation:**
- [Release: REW-19 - Cookbook Sharing](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30408705/Release+REW-19+-+Cookbook+Sharing) (new)
- [Cookbooks (REW-62, REW-19)](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25067521/Cookbooks+REW-62+REW-19) — the planner's page, brought from planned to as-built
- Repo: `README.md`, `docs/api/cookbooks.md`, `docs/api/README.md`, `database/README.md`, `docs/RELEASE_NOTES_REW-19.md`

**Not verified — QA was deliberately skipped for this run.** Nothing has been exercised against a live Supabase, and migration `019_add_cookbook_sharing.sql` has not been applied to any project. These acceptance criteria are explicitly **not** claimed as passing: **AC3** (share URL origin unaffected by a spoofed `Host`/`X-Forwarded-Host`, Copy button), **AC5** (zero trace of a draft recipe at `/c/:id` for visitor, other user, and owner), **AC6** (all-private empty state), **AC11** (direct PostgREST anon/cross-user reads return nothing), **AC12** (toggling visibility changes no recipe status or membership), **AC14** (30/min rate limiting on the visibility endpoint). The remaining criteria are supported by code review and the automated suite but have had no manual browser pass.

**Deployment:** migration `019_add_cookbook_sharing.sql` must be run manually after `018`. It is additive with no backfill — every existing cookbook is Private afterwards. No new environment variables, no Vercel config change, no new packages. `APP_URL` must already be correct in Vercel Production, since it is now also the origin of every share link an owner copies.

Cookbook-level cloning remains out of scope and is tracked as REW-91.

Leaving this ticket In Progress pending QA.
