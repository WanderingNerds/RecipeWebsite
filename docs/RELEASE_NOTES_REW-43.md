# Release Notes: REW-43 - Increase Recipe Import Limit

**Date:** 2026-09-14
**Jira:** [REW-43](https://wanderingnerds.atlassian.net/browse/REW-43) (Task, Priority High, label `QA-findings`, epic REW-2 — Phase 2: Core Recipe Organization & Import)
**Branch:** `REW-43-increase-recipe-import-limit`

## Release status — read this first

Implementation is complete and **reviewer-approved**. **The QA stage was deliberately excluded from
this pipeline run**, so no agent verified the acceptance criteria against a running application or a
browser. This page describes what was built and reviewed, not what has been verified in a live
environment. REW-43 remains **In Progress** in Jira and was deliberately not transitioned to Done.

## Summary

QA reported that the recipe import limit was "extremely low", blocking users from importing a
reasonably sized recipe collection. Three separate ceilings sat behind that one symptom, and all
three were raised while every rate limiter stayed in place and applied to the same route. The error
paths a user hits at those ceilings were also made legible: they now return JSON the import screen
can actually read.

## User impact

- Up to **25 recipe imports per 15 minutes** per IP, up from 5.
- Files up to **4MB**, up from 2MB — phone photos of a recipe page and scanned PDFs now fit.
- Hitting the import cap shows "Too many import attempts. Please try again in 15 minutes." instead
  of a generic parse failure.
- Uploading an oversize file shows "File must be under 4MB"; an unsupported or malformed upload
  shows a specific message rather than a JSON parse error.
- An expired session or rotated CSRF token during upload now shows "Your session expired. Please
  refresh the page and try again." instead of a misleading parse error.
- The import page and the import modal both state 4MB.

## Technical impact

| Surface | Change |
|---------|--------|
| `src/routes/importRoutes.js` | Import rate limit `max` 5 → **25** per 15-minute window (window unchanged, keying still per IP, limiter still on `POST /recipes/import/parse`). Multer `fileSize` 2MB → **4MB**. New exported constants: `IMPORT_RATE_LIMIT_WINDOW_MS`, `IMPORT_RATE_LIMIT_MAX`, `MAX_IMPORT_FILE_SIZE_BYTES`, `MAX_IMPORT_FILE_SIZE_LABEL`, the four message constants, frozen `importLimiterOptions`, `importUpload`, `importLimiter`. New `handleImportUploadError` middleware. Limiter `message` is now an object, so the 429 body is JSON. |
| `src/app.js` | Production-only `generalLimiter` `max` 100 → **300** per 15 minutes per IP. Window, message, header options, `app.use` placement, and the `NODE_ENV === 'production'` guard are unchanged. |
| `public/js/import.js` | `MAX_FILE_SIZE` 2MB → 4MB with a derived size label and message. New `readJsonBody()` and `errorMessageForStatus()` so a non-JSON response no longer surfaces a raw `SyntaxError`; explicit 401/403 handling. |
| `views/recipes/import.ejs`, `views/partials/import-modal.ejs` | Size copy synced to 4MB (copy only). |

### Why the global limiter was raised too

One import costs roughly three requests (`/parse`, `/check-title`, `/save`) plus page and static
traffic, so ~25 imports is ~75–125 requests. At `max: 100` the global limiter would have throttled
users before the raised import ceiling ever helped. The two changes only make sense together.

### Why 4MB

Vercel Functions reject request bodies over 4.5MB at the platform level
(`FUNCTION_PAYLOAD_TOO_LARGE`) before application code runs. 4MB is the largest defensible value: it
leaves multipart overhead headroom and keeps oversize rejections as this app's own JSON 413 rather
than an opaque platform error page. A test asserts the constant stays strictly below 4.5MB.

### What deliberately did not change

The limiter was not removed, disabled, bypassed, or moved; `requireAuth` and `csrfProtection` on
`/parse` are untouched; the Multer MIME allow-list and the magic-byte check in
`src/utils/recipeImporter.js` are unchanged; rate-limit keying stays IP-based; the import flow is
still single-file (batch import remains out of scope, as REW-12 decided).

## Database changes

**None.** No migration, no schema or RLS change, no new file in `database/migrations/`. All three
limits are application-layer middleware configuration, and `express-rate-limit` uses its default
in-memory store.

## API changes

No new or removed endpoints. `POST /recipes/import/parse` changes its limits and its error
representation:

| Condition | Status | Body (all JSON) |
|-----------|--------|-----------------|
| Rate limit exceeded | `429` | `{ "error": "Too many import attempts. Please try again in 15 minutes." }` (was a plain string) |
| File over 4MB | `413` | `{ "error": "File must be under 4MB" }` (was an HTML error page) |
| Other Multer error | `400` | `{ "error": "Invalid upload. Please select a single recipe file." }` (was an HTML error page) |
| Unsupported file type | `400` | `{ "error": "Unsupported file type. Please upload a JSON, PDF, or image file." }` |
| Non-Multer error | — | still delegated to the global `errorHandler` |

Status codes are unchanged; only the ceilings and the body representation changed. Clients that
parsed the old plain-text 429 body would need updating, but the only known client is this app's own
`public/js/import.js`, which was updated in the same change.

## Testing notes

**No QA agent ran in this pipeline. Acceptance criteria are unverified.**

Automated suite: `npm test` — **339 tests, 337 passing, 2 failing.** The two failures are
pre-existing, environmental, and unrelated to this change: `src/csrf.integration.test.js` fails on
Windows with `listen EACCES` because it binds `/tmp/*.sock` Unix-domain sockets and its skip guard
only handles `EPERM`. The reviewer independently confirmed the same two tests fail identically on
`main`. The suite is not fully green and is not claimed to be.

New and extended coverage (`src/routes/importRoutes.test.js`, `src/views/importRecipe.test.js`):
exported constant values; the 4MB constant staying strictly below Vercel's 4.5MB cap; limiter
options; the Multer error handler's 413/400/delegate branches; a `/parse` middleware-chain
regression guard; and client/view copy staying in sync with the server constant.

Not covered by automated tests and still needing a human:

- A real >4MB upload returning the JSON 413 in the browser.
- A real 26th import in one window showing the 429 message in the UI.
- A ~3.5MB image or PDF that previously failed the size gate now reaching parsing.
- A large multi-page PDF saving successfully through `/recipes/import/save` — watch for the default
  100kb `express.json()` body limit.
- OCR of a ~4MB photo against `vercel.json`'s 10-second `maxDuration`.

## Known limitations and follow-ups

Filed during this work, referenced here rather than duplicated:

- **[REW-93](https://wanderingnerds.atlassian.net/browse/REW-93)** — `OCR_TIMEOUT_MS` (30s) exceeds
  Vercel's `maxDuration` (10s), so slow OCR is killed by the platform. More likely to be hit now
  that larger images are allowed.
- **[REW-94](https://wanderingnerds.atlassian.net/browse/REW-94)** — the 5MB `imageUpload` in
  `recipeRoutes.js` exceeds Vercel's 4.5MB cap. Pre-existing, out of scope here.
- **[REW-95](https://wanderingnerds.atlassian.net/browse/REW-95)** — the OCR path has no
  decoded-pixel cap (image decompression-bomb risk). Filed because REW-43 raises the worst-case
  decode budget roughly tenfold.

Open review nits, not blocking and not ticketed:

- The `Object.freeze` rationale comment in `importRoutes.js` is factually imprecise.
- `max:` is the deprecated express-rate-limit v8 spelling; `limit:` is preferred before any v9 bump.
- `views/recipes/import.ejs` and `views/partials/import-modal.ejs` still hardcode "4MB" rather than
  rendering `MAX_IMPORT_FILE_SIZE_LABEL`. Tests catch drift, but the copy is not derived.

## Deployment

Standard application deployment only. **No migration, no new environment variable, no new
dependency, no `vercel.json` change.** The raised limits take effect on deploy; the global limiter
change only affects production, since it is inside the `NODE_ENV === 'production'` guard.

Nothing needs to be run manually. Rollback is a code revert of the three source files and the two
views.

## Documentation updated

- `README.md` — new "Recipe Import (REW-12, REW-43)" feature section; rate limits added to Security.
- `docs/api/README.md` — import endpoint row, the `check-title` endpoint (previously undocumented),
  a consolidated rate-limit table with production-only scope noted, the "per user" → per IP
  correction, and upload size caps.
- `docs/api/recipe-import-limits.md` — **new.** Full limit and error contract for
  `POST /recipes/import/parse`, the 4MB rationale, client behaviour, and known limitations.
- `docs/plans/REW-12-file-import.md` — one-line "superseded by REW-43" pointer.
- `docs/RELEASE_NOTES_REW-43.md` — this page.

## Open items for a human

1. Run QA. None of the acceptance criteria have had a live or browser pass.
2. Leave REW-43 In Progress until QA has run; it was deliberately not transitioned to Done.
3. Confirm that the raised global limiter (300/15 min per IP) is acceptable for the production
   traffic profile — this is the most security-sensitive line in the change.
4. Decide whether the two pre-existing Windows `csrf.integration.test.js` failures warrant their own
   ticket; they are unrelated to REW-43 but make "the suite is green" untrue on Windows.

## Related documentation

- [Implementation plan](plans/rew-43-increase-recipe-import-limit.md)
- [Recipe Import Limits & Error Contract](api/recipe-import-limits.md)
- [API overview](api/README.md)
- [REW-12 File Import plan](plans/REW-12-file-import.md) (historical; limit values superseded)
