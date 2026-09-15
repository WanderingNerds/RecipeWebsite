# REW-93: OCR timeout vs Vercel maxDuration

## Jira issue

[REW-93 — OCR_TIMEOUT_MS (30s) exceeds Vercel maxDuration (10s)](https://wanderingnerds.atlassian.net/browse/REW-93) (Task, Priority Medium, Status To Do, label `QA-findings`)

Branch: `REW-93-ocr-timeout-vercel-maxduration`

Related: [REW-43 — Increase recipe import limit](https://wanderingnerds.atlassian.net/browse/REW-43) (Done; raised the import upload cap 2MB → 4MB, which is why this now matters) and [REW-95 — OCR decoded-pixel cap](https://wanderingnerds.atlassian.net/browse/REW-95) (implemented on an unmerged branch, edits the same function — see "Coordination risk").

## Confluence page

[REW-93: OCR Timeout vs Vercel maxDuration - Enhancement Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30605346/REW-93+OCR+Timeout+vs+Vercel+maxDuration+-+Enhancement+Plan) (new page, child of [Enhancements](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/24150042/Enhancements), matching the REW-43 / REW-95 sibling pattern)

Also relevant and already written: [REW-43: Increase Recipe Import Limit - Enhancement Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30539777/REW-43+Increase+Recipe+Import+Limit+-+Enhancement+Plan), which is where this defect was first recorded.

## QA note for this run

**The QA stage is being skipped for this pipeline run.** The Developer must write the co-located `*.test.js` cases listed under "Test cases to add" as part of the implementation — there is no later QA pass that will add them. Anything that genuinely cannot be automated is listed separately under "Manual checks not covered by tests" and should be reported as unverified rather than assumed to work.

## Summary

`src/utils/recipeImporter.js` line 15 sets `OCR_TIMEOUT_MS = 30000`, while `vercel.json` caps the `server.js` function at `maxDuration: 10`. The platform kills the invocation at 10 seconds, so the application's own 30-second OCR timeout is dead code in production: a slow OCR produces an opaque Vercel timeout page instead of the controlled `{ "error": "Image processing timed out. Try a clearer image." }` JSON that `public/js/import.js` knows how to display. REW-43 raised the upload cap from 2MB to 4MB, so slower OCR runs are now more likely to reach this path. This work makes the two values consistent by deriving the OCR budget from the platform deadline in a single shared module, pins the mirrored `vercel.json` value with a test so they cannot drift apart again, cancels the abandoned Tesseract work when the timeout fires, and adds a client-side fallback message for any gateway timeout that still slips through.

## Chosen approach (single recommendation — do not re-open the choice)

**Keep `vercel.json` at `maxDuration: 10`. Derive the OCR budget from it in a new `src/config/functionLimits.js`.**

| Constant | Value | Meaning |
|---|---|---|
| `VERCEL_MAX_DURATION_SECONDS` | `10` | Mirrors `vercel.json` → `functions["server.js"].maxDuration`. Pinned to the real file by a test. |
| `VERCEL_MAX_DURATION_MS` | derived, `10000` | The platform's hard kill deadline, in milliseconds. |
| `FUNCTION_RESERVE_MS` | `2000` | Everything in the invocation that is not OCR: multipart parse, magic-byte sniff, sharp normalization (once REW-95 merges), unstructured-text parsing, JSON serialization, cold-start slack. |
| `OCR_TIMEOUT_MS` | derived, `8000` | `VERCEL_MAX_DURATION_MS - FUNCTION_RESERVE_MS`. The only OCR timeout value in the codebase. |

Why not raise `maxDuration` instead (the ticket's second option): the maximum allowed value is plan/tier dependent, and a value the deployment cannot honour either fails the deploy or is silently clamped — meaning the same class of invisible mismatch this ticket exists to remove. `10` is valid on every tier. Independently, making a user sit on an upload for 30 seconds is bad UX; returning a clear, actionable error at 8 seconds is better than either a 30-second wait or a platform error page. If the team later decides to buy a longer budget, it is a two-value change (`vercel.json` plus the mirrored constant) that the pinning test forces to happen together.

Why mirror the value in JS rather than reading `vercel.json` at runtime: `vercel.json` is build configuration and is not guaranteed to be traced into the deployed function bundle, so a runtime `readFileSync` or JSON import could work locally and throw in production. The JS constant is the runtime source of truth; `vercel.json` is the platform-side mirror; a dev-time test (where the repo root always exists) makes drift unmergeable. State this tradeoff in a comment in the config module so the next reader does not "improve" it into a runtime read.

## Open questions / assumptions

- **Is 8 seconds actually enough OCR time for a 4MB phone photo?** Assumption: often, but not always — Tesseract on a serverless CPU can exceed it. Proceeding anyway, because the ticket's goal is a *correct, legible* failure rather than a guaranteed success, and 8 seconds of useful work followed by a clear message strictly beats 10 seconds followed by an opaque one. If real-world imports fail frequently at 8s, that is a product decision (longer `maxDuration` on a suitable tier, or OCR off the request path) and needs its own ticket — flagged below, not silently absorbed here.
- **Reserve size.** Assumption: 2000 ms is enough for multipart parse + magic-byte sniff + REW-95's sharp normalization + text parsing + response. This is an estimate, not a measurement. It is expressed as a named constant precisely so it can be re-tuned with one edit; the test asserts a floor (≥ 1500 ms), not the exact number.
- **Timeout HTTP status stays `400`.** Considered `504`/`503` as more semantically accurate; rejected because `src/routes/importRoutes.js` already returns `error.message` as JSON with 400, the client reads `data.error` from the JSON body regardless of status, and changing it buys nothing while touching route, client, and docs. Decided, not left open.
- **Timeout message text is unchanged** ("Image processing timed out. Try a clearer image."). The `"timed out"` substring is load-bearing: `parseImage` re-throws on it (`error.message.includes("timed out")`), and REW-95's tests assert that *other* import errors do not contain it. Do not reword it.
- **Assumption about worker cancellation being in scope.** The REW-95 Confluence page explicitly defers Tesseract worker cancellation to this ticket, and a shorter timeout makes abandonment more frequent, so it is in scope here. It is the only behaviourally risky item in the change; everything else is constants and message copy.

## Coordination risk (read before starting)

REW-95 is implemented and reviewer-approved but **unmerged** on `REW-95-ocr-decoded-pixel-cap`, and it rewrites the same function this ticket touches (`parseImage` in `src/utils/recipeImporter.js`). Specifically it adds a `sharp` normalization step ahead of the timeout timer, an options seam `{ normalize, recognize }`, and a `clearTimeout` in a `finally`. Whichever branch merges second must rebase onto the other rather than overwrite it:

- Keep exactly one `clearTimeout` cleanup, not two.
- Keep REW-95's normalization *before* the OCR timer is created; that means normalization spends the reserve, not the OCR budget — which is exactly what `FUNCTION_RESERVE_MS` is documented to cover.
- Merge the options seams into one options object rather than creating a second one.

If a conflict is non-trivial, stop and raise it rather than resolving it by deleting the other ticket's work.

## Tasks

1. Create `src/config/functionLimits.js` exporting the four constants in the table above. `VERCEL_MAX_DURATION_SECONDS` is a literal that mirrors `vercel.json`; `VERCEL_MAX_DURATION_MS` and `OCR_TIMEOUT_MS` are computed, never hardcoded. Comment each constant with *why* the number is what it is, note that `vercel.json` is the platform-side mirror pinned by a test, and note why the file is not read at runtime. No imports, no side effects — this module must stay safe to import from anywhere, including tests that do not stub Supabase env vars.
2. In `src/utils/recipeImporter.js`, delete the `OCR_TIMEOUT_MS = 30000` literal (lines 14–15), import the constant from `../config/functionLimits.js`, and re-export it so tests and future readers find it at the importer as well as the config module.
3. In `parseImage`, add an options parameter with a `timeoutMs` default of `OCR_TIMEOUT_MS` and an injectable OCR implementation, following the existing precedent in `src/services/assignmentEmail.js` (`timeoutMs = 5000`, injected `fetchImpl`, `clearTimeout` in `finally`). Production callers pass nothing; tests inject a fast fake so no test ever spawns Tesseract.
4. In `parseImage`, replace the one-shot `Tesseract.recognize(...)` call with an explicit worker lifecycle (`createWorker` → `recognize` → `terminate`) so the timeout path can reclaim the worker instead of leaving abandoned OCR running inside a warm container. Terminate in a `finally` that runs on all three paths (success, timeout, OCR error). A failure inside `terminate` must be logged server-side and swallowed — it must never replace the user-facing error. Keep the `logger: () => {}` progress suppression.
5. In `parseImage`, capture the `setTimeout` handle and `clearTimeout` it in the same `finally`. Today it is never cleared, so a successful OCR keeps a pending timer for the remainder of the budget (this is also why the importer test file currently has a long tail). If REW-95 merges first, this is already done — keep one copy.
6. Verify — do not change — `src/routes/importRoutes.js`: the `/parse` handler already catches and returns `{ error: error.message }` with status 400, so the timeout error reaches the client as JSON with no route change. Note the verification in the change summary.
7. In `public/js/import.js`, extend `errorMessageForStatus()` with a 502/503/504 branch returning a readable timeout message (e.g. "The import took too long. Try a smaller or clearer image."). This is defence in depth for any gateway-level timeout that still produces a non-JSON body; it does not replace the server-side fix. Leave the existing 429/413/401/403 branches and the default untouched.
8. Update the "OCR timeout vs. platform timeout" known-limitation bullet in `docs/api/recipe-import-limits.md` (lines 123–125) — it currently documents the 30s/10s mismatch as an open defect tracked in REW-93, which will be false. Replace it with a short description of the derived budget and the pinning test, in the same style as the surrounding bullets.
9. Write the co-located tests listed under "Test cases to add" (QA is skipped this run — these are not optional).
10. Run the focused files first (`src/config/functionLimits.test.js`, `src/utils/recipeImporter.test.js`, `src/views/importRecipe.test.js`), then the full `npm test`. The two `src/csrf.integration.test.js` failures on Windows (hardcoded `/tmp/*.sock` paths, `EACCES`) are pre-existing and unrelated; nothing else may newly fail.

## Affected files

- `src/config/functionLimits.js` — **new.** Single source of truth for the invocation budget: mirrored `maxDuration`, its ms form, the non-OCR reserve, and the derived `OCR_TIMEOUT_MS`. Constants only, no side effects.
- `src/config/functionLimits.test.js` — **new.** Reads the real `vercel.json` from disk and pins it to the mirrored constant; asserts the derivation and the reserve floor.
- `src/utils/recipeImporter.js` — remove the `30000` literal; import and re-export `OCR_TIMEOUT_MS`; add the `timeoutMs` / injected-OCR seam to `parseImage`; switch to an explicit Tesseract worker lifecycle with `terminate` in `finally`; `clearTimeout` the timer. No change to `SUPPORTED_MIME_TYPES`, `validateImportFile`, the JSON-LD/PDF paths, or any error-message text.
- `src/utils/recipeImporter.test.js` — new cases for the derived value, the timeout path, worker termination, timer cleanup, and message hygiene. Do not modify existing assertions.
- `public/js/import.js` — 502/503/504 branch in `errorMessageForStatus()` only.
- `src/views/importRecipe.test.js` — new case driving a 504 response with an HTML body through the existing `runImportClient` harness.
- `docs/api/recipe-import-limits.md` — rewrite the now-stale known-limitation bullet (lines 123–125).
- `vercel.json` — **no change.** `maxDuration` stays `10`; it becomes test-pinned.
- `src/routes/importRoutes.js` — **no change.** Verify only: the `/parse` catch already emits JSON 400 with `error.message`.
- Worth reading, not changing: `src/services/assignmentEmail.js` (the injectable-timeout pattern to copy), `src/middleware/errorHandler.js` (the HTML fallback we are staying clear of), `docs/plans/rew-43-increase-recipe-import-limit.md` (where this defect was first recorded).

## Database changes

**None.** No migration file, no table, column, index, RLS policy, or storage change. This is entirely application-layer timeout configuration. Nothing is added to `database/migrations/`.

## Security considerations

- **Hard boundaries untouched.** `requireAuth`, `csrfProtection`, `importLimiter`, the global `generalLimiter`, the multer `limits.fileSize` (4MB), the multer `fileFilter` allow-list, `handleImportUploadError`, and the `fileTypeFromBuffer` magic-byte check must all be byte-for-byte unchanged. Nothing in this ticket needs them relaxed; a diff touching any of them is wrong.
- **This change tightens a resource control, so verify it in the tightening direction.** A shorter OCR budget plus worker termination lowers worst-case CPU per request. The reviewer should confirm the new value is strictly below the platform deadline and that `terminate` is actually reached on the timeout path — an unterminated worker in a warm container is a slow resource leak that degrades subsequent requests.
- **No information disclosure in the new error paths.** `src/routes/importRoutes.js` returns `error.message` straight to the client, so the timeout message must stay the existing generic string: no buffer sizes, pixel counts, file paths, timing values, worker internals, or stack traces. A `terminate` failure must not surface its own message to the user.
- **Do not let a decode/normalize failure be reported as a timeout.** REW-95 asserts that non-timeout import errors never contain `"timed out"`, because `parseImage` branches on that substring. Preserve that property.
- **Client copy only on the client.** The new 502/503/504 message is static text; do not interpolate any part of the server response into it.
- **No new dependency.** `tesseract.js` (`^5.0.0`) is already a dependency; `createWorker` is part of the same package. Adding a package for this would be out of scope.

## Acceptance criteria

- [ ] `src/config/functionLimits.js` exists and exports `VERCEL_MAX_DURATION_SECONDS`, `VERCEL_MAX_DURATION_MS`, `FUNCTION_RESERVE_MS`, and `OCR_TIMEOUT_MS`.
- [ ] `OCR_TIMEOUT_MS === 8000`, and it is computed as `VERCEL_MAX_DURATION_MS - FUNCTION_RESERVE_MS` rather than written as a literal (asserted by recomputing from the other exports, not by eye).
- [ ] `VERCEL_MAX_DURATION_MS === VERCEL_MAX_DURATION_SECONDS * 1000`.
- [ ] A test reads the real `vercel.json` from disk and fails if `functions["server.js"]` is missing or if its `maxDuration` is not equal to `VERCEL_MAX_DURATION_SECONDS`.
- [ ] A test asserts `OCR_TIMEOUT_MS < VERCEL_MAX_DURATION_MS` and that the reserve is at least 1500 ms.
- [ ] No `30000` OCR timeout literal remains anywhere in `src/`; `src/utils/recipeImporter.js` imports the value from `src/config/functionLimits.js` and re-exports it, and the re-exported value equals the config module's.
- [ ] An OCR that exceeds the budget rejects with exactly "Image processing timed out. Try a clearer image." (message unchanged from today).
- [ ] With an injected OCR implementation that never settles and a short injected `timeoutMs`, `parseImage` rejects within roughly that timeout rather than hanging.
- [ ] On the timeout path the Tesseract worker's `terminate` is called exactly once.
- [ ] If `terminate` throws, `parseImage` still rejects with the timeout message, not with the termination error.
- [ ] On the success path the pending timeout handle is cleared: the importer test file completes without an added multi-second tail.
- [ ] A non-timeout OCR failure still rejects with "Could not process image. Please try a different image.", and that message does not contain "timed out".
- [ ] The timeout and generic OCR error messages contain no file paths, buffer sizes, pixel counts, timing values, or stack traces.
- [ ] `POST /recipes/import/parse` returns HTTP 400 with a JSON body whose `error` key carries the timeout message (route file unchanged; verified, and the client reads `data.error`).
- [ ] `public/js/import.js` shows a readable timeout message — not "Failed to parse file. Please try again." and not a JSON parse error — when the server returns 504 with an HTML body.
- [ ] `vercel.json` still contains exactly `maxDuration: 10` for `server.js`; the diff does not change it.
- [ ] `requireAuth`, `csrfProtection`, `importLimiter`, `generalLimiter`, the multer limits, `fileFilter`, `handleImportUploadError`, and `SUPPORTED_MIME_TYPES` are unchanged in the diff.
- [ ] No file added to `database/migrations/`; no schema or RLS change in the diff.
- [ ] `docs/api/recipe-import-limits.md` no longer describes the 30s/10s mismatch as an open REW-93 defect and instead documents the derived budget and the pinning test.
- [ ] No test in the suite spawns a real Tesseract worker or performs real OCR.
- [ ] Focused tests pass, and `npm test` shows no new failures beyond the two pre-existing `src/csrf.integration.test.js` Windows socket failures.

## Test cases to add

`src/config/functionLimits.test.js` (new):

1. `functions["server.js"].maxDuration` in the real `vercel.json` equals `VERCEL_MAX_DURATION_SECONDS` — read the file relative to `import.meta.url`, do not hardcode an absolute path.
2. The `server.js` key exists in `vercel.json`'s `functions` map (guards against the pin passing vacuously if the entry is renamed).
3. `VERCEL_MAX_DURATION_MS === VERCEL_MAX_DURATION_SECONDS * 1000`, and `OCR_TIMEOUT_MS === VERCEL_MAX_DURATION_MS - FUNCTION_RESERVE_MS`.
4. `OCR_TIMEOUT_MS` is a positive integer strictly less than `VERCEL_MAX_DURATION_MS`, with `FUNCTION_RESERVE_MS >= 1500`.

`src/utils/recipeImporter.test.js` (extend; the file already imports named exports directly):

5. The importer's re-exported `OCR_TIMEOUT_MS` is the same value as the config module's.
6. `parseImage` with an injected OCR that never resolves and `timeoutMs` of a few milliseconds rejects with the exact timeout message.
7. On that timeout, the injected worker's `terminate` was called exactly once.
8. A `terminate` that rejects does not change the surfaced error — still the timeout message.
9. `parseImage` with an injected OCR that resolves quickly with enough text returns parsed recipe data and appends the existing OCR warning; the test completes promptly (no lingering timer).
10. An injected OCR that rejects with a non-timeout error produces "Could not process image. Please try a different image.", and the thrown message does not contain "timed out", "tesseract", or a file path.
11. Injected OCR returning fewer than 20 characters still produces the existing "Could not extract enough text from image" error (regression guard on ordering).

`src/views/importRecipe.test.js` (extend; reuse the existing `runImportClient` harness and its stubbed `fetch`):

12. A stubbed 504 response with an HTML body surfaces the new timeout copy in `uploadErrorMessage`, not the generic parse-failure copy.
13. A stubbed 400 response with a JSON body containing the server's timeout message surfaces that server message verbatim (the JSON path still wins over the status fallback).

## Manual checks not covered by tests

Report these as unverified rather than assuming them, since QA is skipped this run:

- A real ~4MB phone photo imported against a deployed function: does OCR finish inside 8 seconds, and if not, does the browser show our JSON message instead of a Vercel timeout page?
- Whether 2000 ms of reserve is actually sufficient once REW-95's sharp normalization is also in the same invocation.
- Warm-container behaviour after a timeout: a second import immediately following a timed-out one should not be slowed by leftover OCR work.

## Follow-up tickets to file (Developer, not Planner)

The Planner does not create Jira issues. Two should exist before or alongside this work:

1. **No timeout on the PDF import path.** `parsePdf` calls `pdf.js-extract` with no timeout at all, so a large multi-page PDF hits exactly the platform-timeout symptom this ticket fixes for images. Same class of defect, different parser; deliberately out of scope here to keep the diff reviewable.
2. **Longer OCR budget, if 8 seconds proves too short.** Either raise `maxDuration` on a plan tier that supports it (now a safe, test-guarded two-value change) or move OCR off the request path. Only file this if the manual check above shows real photos failing.
