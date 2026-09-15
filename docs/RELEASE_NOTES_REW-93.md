# Release Notes: REW-93 - OCR timeout vs Vercel maxDuration

**Date:** 2026-09-14
**Jira:** [REW-93](https://wanderingnerds.atlassian.net/browse/REW-93) (Task, Priority Medium, label `QA-findings`)
**Branch:** `REW-93-ocr-timeout-vercel-maxduration`

## Release status — read this first

Implementation is complete and **reviewer-approved over two review rounds**. **The QA stage was
deliberately skipped for this pipeline run**, so no agent verified anything against a deployed
function or a browser. The Developer wrote the tests; there was no independent QA pass. The work is
also **not merged** — it sits uncommitted on the branch above.

REW-93 remains **In Progress** in Jira and was deliberately not transitioned to Done. Three specific
things are unverified and are listed under "Unverified — needs a human" below. Please read that
section before treating this as finished.

## Summary

`src/utils/recipeImporter.js` set its own OCR timeout to 30 seconds while `vercel.json` capped the
`server.js` function at `maxDuration: 10`. The platform therefore killed the invocation at 10
seconds and the application's 30-second timeout could never fire: a slow OCR produced an opaque
Vercel timeout page instead of the controlled JSON error the import screen knows how to display.
REW-43 raised the upload cap from 2MB to 4MB, which made slow OCR runs considerably more likely.

This change makes the two numbers derive from one another. A new `src/config/functionLimits.js`
holds the platform deadline and a named reserve, and computes the OCR budget from them (8 seconds).
A dev-time test reads the real `vercel.json` from disk and fails if the mirrored value drifts. The
OCR path also switched to an explicit Tesseract worker lifecycle so an abandoned OCR run is actually
reclaimed when the timeout fires, and the browser client gained a readable fallback message for any
gateway-level timeout that still slips through.

## User impact

- A slow image import now fails at **8 seconds with a clear message** — "Image processing timed out.
  Try a clearer image." — instead of hanging until the platform kills the request and returns a page
  the import screen cannot parse.
- **Behaviour change worth calling out:** some image imports that previously ran up to the 10-second
  platform deadline now stop at 8 seconds. Those imports were already failing; they simply failed
  opaquely and two seconds later. The trade-off is deliberate — a legible failure two seconds
  earlier beats an illegible one — but users who were close to the line will now see a failure they
  did not see before. If real photos turn out to need more than 8 seconds, that is a product
  decision, not a bug in this change (see "Follow-ups").
- If a request still dies at the gateway (502/503/504, most likely a slow PDF), the import screen now
  shows "The import took too long. Try a smaller file." instead of a generic parse failure.
- The success path is unchanged. Nothing about upload size, rate limits, supported file types, or the
  review-before-save flow moved.

## Technical impact

| Surface | Change |
|---------|--------|
| `src/config/functionLimits.js` | **New.** Constants only, no imports and no side effects, so it is safe to import from anywhere including tests that do not stub Supabase env vars. Exports `VERCEL_MAX_DURATION_SECONDS` (`10`, mirrors `vercel.json`), `VERCEL_MAX_DURATION_MS` (derived, `10000`), `FUNCTION_RESERVE_MS` (`2000`), and `OCR_TIMEOUT_MS` (derived, `8000`). |
| `src/config/functionLimits.test.js` | **New.** Reads the real `vercel.json` from disk, asserts the `server.js` entry exists, pins its `maxDuration` to the mirrored constant, and checks the derivations plus a 1500 ms reserve floor. |
| `src/utils/recipeImporter.js` | The `OCR_TIMEOUT_MS = 30000` literal is gone; the value is imported from the config module and re-exported. `parseImage` takes an options object `{ timeoutMs, createWorkerImpl }` and uses an explicit `createWorker` → `recognize` → `terminate` lifecycle with `clearTimeout` and worker termination in a `finally` on every path. |
| `public/js/import.js` | `errorMessageForStatus()` gained a 502/503/504 branch. Existing 429/413/401/403 branches and the default are untouched. |
| `src/utils/recipeImporter.test.js`, `src/views/importRecipe.test.js` | New co-located cases (see Testing notes). |
| `vercel.json` | **No change.** `maxDuration` stays `10`; it is now pinned by a test. |
| `src/routes/importRoutes.js` | **No change.** Verified only: the `/parse` catch already returns `{ error: error.message }` as JSON with status 400, so the timeout message reaches the client with no route edit. |

### Why the value is mirrored rather than read from `vercel.json` at runtime

`vercel.json` is build configuration and is not guaranteed to be traced into the deployed function
bundle, so a runtime `readFileSync` or JSON import could pass locally and throw in production. The
JS constant is the runtime source of truth; `vercel.json` is the platform-side mirror; the dev-time
test — where the repo root always exists — makes drift unmergeable. That rationale is written into
the module so the next reader does not "improve" it into a runtime read.

### Why 8 seconds, and not a larger `maxDuration`

Raising `maxDuration` was the ticket's other option and was rejected. The maximum allowed value is
plan/tier dependent, and a value the deployment cannot honour either fails the deploy or is silently
clamped — which is the same class of invisible mismatch this ticket exists to remove. `10` is valid
on every tier. Independently, 30 seconds of waiting on an upload is poor UX regardless of whether
the platform would allow it. If the team later decides to buy a longer budget, it is a two-value
change (`vercel.json` plus the mirrored constant) that the pinning test forces to happen together.

`FUNCTION_RESERVE_MS = 2000` covers everything in the invocation that is not OCR: multipart parse,
the magic-byte sniff, image normalization, unstructured-text parsing, JSON serialization, and
cold-start slack. It is an **estimate, not a measurement**, which is why it is a named constant and
why the test asserts a floor rather than the exact number.

### Worker lifecycle and cancellation

`Promise.race` alone leaves the abandoned Tesseract work running, which on a warm serverless
container competes with the next request. `parseImage` now owns the worker explicitly:

- `clearTimeout` runs in a `finally` on every path, so a successful OCR no longer keeps a pending
  timer alive for the remainder of the budget.
- The worker is terminated in the same `finally`. Termination failures are logged server-side as
  "Failed to terminate OCR worker:" and swallowed — they never replace the user-facing error.
- There is a deferred cleanup for the cold-start case where the timeout fires before the worker has
  finished starting: the response is not blocked on startup, but the worker is terminated as soon as
  it exists. A worker that fails to start is logged distinctly as "OCR worker startup failed:" so the
  log does not claim a cleanup problem when there was nothing to clean up.

### What deliberately did not change

The `"timed out"` substring in the timeout message is load-bearing — `parseImage` branches on
`error.message.includes("timed out")` and REW-95's tests assert that other import errors do not
contain it — so the message text is unchanged. The timeout still returns HTTP 400, not 504:
`importRoutes.js` already serialises `error.message` as JSON and the client reads `data.error`
regardless of status, so changing it would touch route, client, and docs for no gain.

`requireAuth`, `csrfProtection`, `importLimiter`, the global `generalLimiter`, the Multer
`limits.fileSize` and `fileFilter`, `handleImportUploadError`, the `fileTypeFromBuffer` magic-byte
check, and `SUPPORTED_MIME_TYPES` are all unchanged.

## Database changes

**None.** No migration file, no table, column, index, RLS policy, or storage change. Nothing was
added to `database/migrations/`. This is entirely application-layer timeout configuration.

## API changes

No new, removed, or renamed endpoints, and no status-code change.

`POST /recipes/import/parse` behaves as before except that the OCR timeout now actually fires:

| Condition | Status | Body |
|-----------|--------|------|
| OCR exceeds the 8s budget | `400` | `{ "error": "Image processing timed out. Try a clearer image." }` (previously unreachable in production — the platform killed the request first) |
| Non-timeout OCR failure | `400` | `{ "error": "Could not process image. Please try a different image." }` (unchanged) |
| Gateway timeout that still slips through | `502`/`503`/`504` | Platform HTML; the client now renders "The import took too long. Try a smaller file." rather than a generic parse failure |

Every other row of the error contract is unchanged. The response messages carry no buffer sizes,
pixel counts, file paths, timing values, worker internals, or stack traces.

## Testing notes

**No QA agent ran in this pipeline. The acceptance criteria have had no live or browser pass.**
The Developer wrote the tests below and the Reviewer approved them over two rounds.

Automated suite: `npm test` — **389 tests, 387 passing, 2 failing.** The two failures are
pre-existing, environmental, and unrelated: `src/csrf.integration.test.js` fails on Windows with
`listen EACCES` because it binds `/tmp/*.sock` Unix-domain sockets and its skip guard only handles
`EPERM`. The Reviewer independently confirmed the same two tests fail identically on `main` and that
the file is byte-identical to `main`. The suite is not fully green and is not claimed to be.

15 new tests, all co-located:

- `src/config/functionLimits.test.js` (4) — the `server.js` entry exists in `vercel.json`, its
  `maxDuration` equals the mirrored constant, both derived values recompute correctly, and the OCR
  budget is a positive integer strictly below the platform deadline with at least 1500 ms of reserve.
- `src/utils/recipeImporter.test.js` (9) — the re-exported budget matches the config module; an OCR
  that outlasts its budget rejects with the exact timeout message; the worker is terminated exactly
  once on the timeout path; a failing `terminate` does not replace the user-facing error; the success
  path returns parsed data with the OCR warning and leaves no pending timer; a non-timeout failure
  surfaces the generic image error with no internals; a worker that finishes starting after the
  timeout is still terminated; a worker that fails to start is logged as a startup failure; and OCR
  text under 20 characters still reports the not-enough-text error.
- `src/views/importRecipe.test.js` (2) — 502/503/504 with an HTML body surfaces the new timeout copy,
  and a 400 with a JSON body still wins with the server's own message.

No test spawns a real Tesseract worker or performs real OCR; every case injects a fake through
`createWorkerImpl`.

## Unverified — needs a human

These were explicitly not checked, because QA did not run. Do not read them as passing.

1. **Does a real ~4MB phone photo finish OCR inside 8 seconds on a deployed function?** And if it
   does not, does the browser actually show our JSON error rather than a Vercel timeout page? This is
   the central claim of the ticket and it has only been verified against injected fakes.
2. **Does the 2000 ms reserve hold once REW-95's `sharp` normalization shares the invocation?**
   Normalization runs before the OCR timer starts, so it spends the reserve rather than the OCR
   budget. 2000 ms is an estimate; nobody has measured normalization on real input.
3. **Warm-container behaviour on the import immediately after a timed-out one.** Worker termination
   is asserted in unit tests against a fake; it has not been observed on a real warm container.

## Known limitations and follow-ups

- **[REW-97](https://wanderingnerds.atlassian.net/browse/REW-97)** — the PDF import path has no
  timeout at all. `parsePdf` calls `pdf.js-extract` with no budget, so a large multi-page PDF hits
  exactly the platform-timeout symptom this ticket fixes for images. Filed during this work and
  linked to REW-93; deliberately out of scope here to keep the diff reviewable. This is also why the
  new client-side 502/503/504 copy is format-neutral ("Try a smaller file", not "a smaller image").
- **A longer OCR budget may still be needed.** If unverified item 1 above shows real photos failing
  at 8 seconds, the fix is either a longer `maxDuration` on a plan tier that supports it — now a
  safe, test-guarded two-value change — or moving OCR off the request path. File it only once there
  is evidence.
- **The two pre-existing Windows `csrf.integration.test.js` failures** still make "the suite is
  green" untrue on Windows. Unrelated to this change; still unticketed.

## Merge coordination — read before merging

**[REW-95](https://wanderingnerds.atlassian.net/browse/REW-95)** is implemented and
reviewer-approved but **unmerged** on `REW-95-ocr-decoded-pixel-cap`, and it rewrites the same
`parseImage` function. **A merge conflict is expected.** Whoever merges second must resolve it by
combining the two changes, not by taking one side:

- Merge the two option seams into **one** options object — do not create a second one.
- Keep exactly **one** `clearTimeout`.
- Keep REW-95's `sharp` normalization **before** the OCR timer is created, so normalization spends
  `FUNCTION_RESERVE_MS` rather than the OCR budget. That is what the reserve is documented to cover.
- Keep exactly **one** terminate cleanup.

If the conflict turns out to be non-trivial, stop and raise it rather than resolving it by deleting
the other ticket's work.

## Deployment

Standard application deployment only. **No migration, no new environment variable, no new
dependency, no `vercel.json` change, no Vercel project setting to update.** `tesseract.js` (`^5.0.0`)
was already a dependency and `createWorker` ships in the same package.

The new budget takes effect on deploy. Nothing needs to be run manually. Rollback is a code revert of
`src/config/functionLimits.js`, `src/utils/recipeImporter.js`, and `public/js/import.js`.

One operational note for whoever owns the deploy: **if `vercel.json`'s `maxDuration` is ever changed
— including from the Vercel dashboard rather than the file — `src/config/functionLimits.js` must be
changed in the same commit.** The pinning test catches a file-level drift but cannot see a
dashboard-level override.

## Documentation updated

- `docs/api/recipe-import-limits.md` — the "OCR timeout vs. platform timeout" known-limitation bullet
  now documents the derived budget and the pinning test (replaced by the Developer; verified here),
  plus a new error-contract row for the timeout, the client's 502/503/504 fallback, a `Source:` line
  covering the new config module, and a changelog entry.
- `docs/api/recipe-import-ocr-parsing.md` — new "OCR execution budget and worker lifecycle" section;
  the stale `Tesseract.recognize(...)` usage example was corrected to the current worker lifecycle.
- `README.md` — the Recipe Import feature section now states the 8-second OCR budget and the
  behaviour change; `src/config/functionLimits.js` added to the project structure.
- `docs/RELEASE_NOTES_REW-93.md` — this page.
- `docs/confluence/JIRA_COMMENT_REW-93.md` — the Jira comment posted to the ticket.
- Confluence: "Release: REW-93 - OCR Timeout vs Vercel maxDuration" (new) and the existing
  "REW-93: OCR Timeout vs Vercel maxDuration - Enhancement Plan" page updated to as-shipped.
- No database documentation change: there are no database changes to document.

## Open items for a human

1. Run QA, or consciously accept the three unverified items above before release.
2. Leave REW-93 In Progress. It was deliberately not transitioned to Done: the branch is unmerged and
   QA never ran.
3. Merge REW-93 and REW-95 in a deliberate order and resolve the `parseImage` conflict per the
   coordination section above.
4. Decide whether the 8-second budget is acceptable as a product decision once a real photo has been
   measured on a deployed function.

## Related documentation

- [Implementation plan](plans/rew-93-ocr-timeout-vercel-maxduration.md)
- [Recipe Import Limits & Error Contract](api/recipe-import-limits.md)
- [OCR/PDF Text Parsing](api/recipe-import-ocr-parsing.md)
- [Release notes: REW-43](RELEASE_NOTES_REW-43.md) — where this defect was first recorded
