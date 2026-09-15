## Jira issue

[REW-43 — Increase recipe import limit](https://wanderingnerds.atlassian.net/browse/REW-43) (Task, Priority High, Status To Do, label `QA-findings`, reported by Victoria Johnson)

Branch: `REW-43-increase-recipe-import-limit`

## Confluence page

[REW-43: Increase Recipe Import Limit - Enhancement Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30539777/REW-43+Increase+Recipe+Import+Limit+-+Enhancement+Plan) (child of [Enhancements](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/24150042/Enhancements))

Related existing page: [REW-12: File Import - Feature Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/15269890/REW-12+File+Import+-+Feature+Plan) — this is where the original 2MB / 5-per-15-minutes limits were specified. It is a historical plan; the REW-43 page supersedes its limit values and a pointer comment has been added there.

## Summary

QA reports the recipe import limit is "extremely low", preventing users from importing a reasonably sized recipe collection. There are three distinct ceilings behind that symptom, and this ticket raises all three while leaving every limiter in place: the per-route import rate limit (`max: 5` per 15 minutes on `POST /recipes/import/parse`), the global production rate limit (`max: 100` per 15 minutes per IP, which throttles the end-to-end import flow before the import limiter's new ceiling can be reached), and the per-file upload size (`2MB`, low for phone photos and scanned PDFs). Alongside the raised values, the two error paths a user hits when they exceed a limit are made legible: the 429 response and multer's file-size/file-type rejections currently return plain text or a rendered HTML error page, while `public/js/import.js` calls `response.json()` on them and shows an unrelated parse-failure message — which is very likely what made the limit look "extremely low" rather than "hit a documented cap".

Chosen values and why:

| Limit | Location | Old | New | Rationale |
|---|---|---|---|---|
| Import parses per window | `src/routes/importRoutes.js` `importLimiter.max` | `5` | `25` | 25 parses / 15 min ≈ one every 36 s sustained. Each parse buffers the file in memory and runs pdf.js-extract or Tesseract OCR, so the cost per request is high; 25 supports importing a collection in one sitting without turning the endpoint into a cheap CPU/memory amplifier. Window stays at 15 minutes. |
| Import window | `src/routes/importRoutes.js` `importLimiter.windowMs` | `15 * 60 * 1000` | unchanged | Changing the window changes the burst profile without helping the user-facing goal. |
| Per-file upload size | `src/routes/importRoutes.js` `importUpload.limits.fileSize` | `2 * 1024 * 1024` (2MB) | `4 * 1024 * 1024` (4MB) | **In scope** — phone photos of a recipe page and scanned PDFs routinely exceed 2MB, so OCR/PDF imports fail for legitimate files. 4MB is the maximum defensible value: Vercel Functions reject any request body over **4.5 MB** with a platform-level `FUNCTION_PAYLOAD_TOO_LARGE` 413 before our code ever runs (https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE). Setting our limit at or above 4.5MB would replace our own clean JSON error with an opaque Vercel error page. 4MB leaves headroom for multipart boundary overhead. |
| Global requests per window (production only) | `src/app.js` `generalLimiter.max` | `100` | `300` | **In scope, and required for the ticket's outcome.** The global limiter counts every request from the IP. One import costs roughly 3 requests (`/recipes/import/parse`, `/recipes/import/check-title`, `/recipes/import/save`) plus page/static traffic, so ~25 imports ≈ 75–125 requests and users would be throttled globally before reaching the new import ceiling. 300/15 min per IP still bounds abuse for a server-rendered site and is roughly one request every 3 seconds sustained. |

Explicitly **not** changing: the limiter is not removed, disabled, bypassed, or moved off `POST /recipes/import/parse`; `requireAuth` and `csrfProtection` are untouched; the multer `fileFilter` allow-list and the magic-byte check in `src/utils/recipeImporter.js` are untouched.

## Open questions / assumptions

- **What "import limit" means.** The ticket is ambiguous. Assumption (per the phrase "import larger recipe collections"): the primary blocker is the per-window request count (5 imports per 15 minutes), so that is primary scope. The 2MB per-file limit is included as secondary scope with the justification above. Decided, not left open.
- **Batch / multi-file import is out of scope.** The import UI is single-file by design (`importUpload.single("file")`, and REW-12 explicitly deferred batch import). If QA actually meant "let me select 20 files at once", that is a separate feature and needs its own ticket — flag to the user; do not build it here.
- **Rate-limit keying stays IP-based.** `express-rate-limit`'s default key is the client IP, so the limit is per IP, not per user (`docs/api/README.md` currently mis-documents it as "per user" — fix the doc, not the behavior). Per-user keying via `req.user.id` was considered and **rejected**: it would let one IP multiply its budget by creating accounts, changing the DoS profile of the most expensive endpoint in the app. Shared-NAT users share the 25/15 min budget; acceptable at the new ceiling.
- **Assumption on request cost per import:** parse + debounced check-title + save ≈ 3 requests. If QA measures materially more (e.g. check-title firing repeatedly while editing a title), the global limiter headroom should be re-evaluated rather than the import limiter.
- Two pre-existing defects are surfaced but **out of scope** — flag to the user so the Developer can file tickets: (a) `OCR_TIMEOUT_MS = 30000` in `src/utils/recipeImporter.js` exceeds `vercel.json`'s `maxDuration: 10`, so slow OCR is killed by the platform, not by our timeout — raising the file size makes this more likely to be hit; (b) `src/routes/recipeRoutes.js` `imageUpload` allows 5MB, which is above Vercel's 4.5MB request cap and can never fully work in production.

## Tasks

1. In `src/routes/importRoutes.js`, introduce and export named constants for the limits so they are testable and greppable: an import rate-limit window constant (15 minutes, unchanged), an import rate-limit max constant (`5` → `25`), and a max import file size constant (`2 * 1024 * 1024` → `4 * 1024 * 1024`). Update the two stale comments on lines 27 and 36 to match the new values.
2. In the same file, build `importLimiter` from those constants and change its `message` from a bare string to an object carrying an `error` key with the same wording ("Too many import attempts. Please try again in 15 minutes."), so the 429 body is JSON and `public/js/import.js` can read `data.error`. Keep `standardHeaders: true`, `legacyHeaders: false`, and keep the limiter applied to `POST /recipes/import/parse` in its current position (after `requireAuth`, before multer).
3. In the same file, add a multer-aware error-handling middleware directly after `importUpload.single("file")` in the `/parse` chain that converts multer's `LIMIT_FILE_SIZE` error into a `413` JSON response whose message matches the client copy ("File must be under 4MB"), converts the `fileFilter` unsupported-type error into a `400` JSON response with the existing unsupported-type wording, and delegates anything else to `next(err)`. Export it for unit testing. Without this, both errors fall through to `errorHandler` in `src/middleware/errorHandler.js`, which renders an HTML page — and the client's `response.json()` then throws a `SyntaxError` and shows a misleading message.
4. In `src/app.js`, raise the production `generalLimiter` `max` from `100` to `300`, leaving `windowMs`, `message`, header options, and the `NODE_ENV === 'production'` guard untouched. Add a short comment explaining the value is sized to allow a multi-recipe import session. Do not move or remove `app.use(generalLimiter)`.
5. In `public/js/import.js`, update `MAX_FILE_SIZE` (line 48) from `2 * 1024 * 1024` to `4 * 1024 * 1024`, its comment on line 47, and the validation copy on line 118 ("File must be under 2MB" → "File must be under 4MB"). The client pre-check must stay at or below the server limit so users get an instant local error instead of a wasted upload.
6. In `public/js/import.js` `uploadFile()`, make the non-JSON response path safe: if the response is not OK and the body cannot be parsed as JSON (a 429 body, or any HTML error page), fall back to a status-appropriate message rather than surfacing the JSON parse error. Keep the existing behavior for well-formed JSON error bodies.
7. Update user-facing copy that states the old size: `views/recipes/import.ejs` line 33 ("Maximum file size: 2MB" → 4MB) and `views/partials/import-modal.ejs` line 30 ("Max 2MB" → "Max 4MB"). The modal has no upload logic of its own (it redirects to `/recipes/import`), so this is copy only.
8. Update `docs/api/README.md` lines 207–209: General 100 → 300 requests per 15 minutes per IP, Recipe Imports 5 → 25 per 15 minutes **per IP** (correcting the inaccurate "per user"), and correct the documented rate-limit response body to the actual shape now returned (`error` key). Leave the File Uploads line (10 per 15 minutes) alone — that is `recipeRoutes.js` and out of scope.
9. Add a one-line pointer in `docs/plans/REW-12-file-import.md` near its limits table noting the 2MB / 5-per-15-minutes values are superseded by REW-43. Do not rewrite that historical plan.
10. Extend `src/routes/importRoutes.test.js` (server-side constants, limiter options, multer error handler, middleware-chain regression guard) and `src/views/importRecipe.test.js` (client constant and view copy staying in sync) per the test list below.
11. Run the focused import tests, then the full `npm test` suite.

## Affected files

- `src/routes/importRoutes.js` — raise `importLimiter.max` `5` → `25`; keep `windowMs` at `15 * 60 * 1000`; convert the limiter `message` to a JSON object with an `error` key; raise `importUpload.limits.fileSize` `2 * 1024 * 1024` → `4 * 1024 * 1024`; export the three limit constants and the new multer error handler; add that handler to the `/parse` chain; fix the stale comments on lines 27 and 36. The limiter, `requireAuth`, `csrfProtection`, and the `fileFilter` allow-list stay exactly as they are.
- `src/app.js` — production `generalLimiter.max` `100` → `300` (line 74), with a comment tying the value to the import flow. No other middleware change.
- `public/js/import.js` — `MAX_FILE_SIZE` `2 * 1024 * 1024` → `4 * 1024 * 1024` (line 48) and its comment (line 47); validation copy "File must be under 2MB" → "File must be under 4MB" (line 118); resilient non-JSON error handling in `uploadFile()`.
- `views/recipes/import.ejs` — line 33 "Maximum file size: 2MB" → "Maximum file size: 4MB".
- `views/partials/import-modal.ejs` — line 30 "Max 2MB" → "Max 4MB" (copy only; no upload logic in this partial).
- `src/routes/importRoutes.test.js` — new cases for the exported constants, limiter options, multer error handler, and `/parse` middleware-chain guard.
- `src/views/importRecipe.test.js` — new cases asserting the client-side constant and both views' copy match the server limit.
- `docs/api/README.md` — Rate Limiting section values, "per IP" correction, and documented response body.
- `docs/plans/REW-12-file-import.md` — one-line superseded-by-REW-43 pointer next to the limits it records.
- Not changed, but worth reading while implementing: `src/middleware/errorHandler.js` (the HTML fallback the new multer handler prevents), `src/utils/recipeImporter.js` (`OCR_TIMEOUT_MS`, magic-byte validation), `vercel.json` (`maxDuration: 10`), `src/routes/recipeRoutes.js` (separate 10-uploads / 5MB limits — out of scope).

## Database changes

**None.** Confirmed: no migration, no table/column change, no RLS change, no storage change. All three limits are application-layer middleware configuration; nothing about imports is persisted per-user for rate-limiting purposes (`express-rate-limit` uses its default in-memory store). No new file in `database/migrations/`.

## Security considerations

- **Hard boundary respected.** `importLimiter` remains constructed with `express-rate-limit` and remains applied to `POST /recipes/import/parse` in the same chain position. This ticket raises its ceiling only. `requireAuth` and `csrfProtection` on `/parse` and `/save` are untouched. Reviewer should reject any diff that removes, conditionally skips, or reorders these.
- **The global limiter change is the most security-sensitive line in this diff** (`src/app.js` line 74, 100 → 300). It remains applied to every request in production with the same window. Reviewer should confirm the `NODE_ENV === 'production'` guard and `app.use(generalLimiter)` placement are unchanged.
- **Memory / DoS profile is the real constraint.** Uploads use `multer.memoryStorage()`, so each in-flight parse holds the whole file in the function's heap, and Tesseract decodes an image to several times its encoded size. The new worst case per IP is 25 × 4MB buffered over 15 minutes versus the old 5 × 2MB. Both raises must be justified together; do not raise file size further "while we're here".
- **Platform cap.** 4MB deliberately sits under Vercel's 4.5MB request-body cap so oversize uploads produce our JSON 413 rather than an opaque platform error. Any future proposal above ~4.3MB is not implementable on this deployment target.
- **Error-path hardening, not weakening.** Converting the 429 and multer rejections to JSON changes only the response representation; status codes stay 429/413/400 and no additional detail about the server is disclosed. Keep the messages generic — no file paths, no stack traces, no `err.message` pass-through for non-multer errors.
- **Validation unchanged.** The multer `fileFilter` MIME allow-list and `fileTypeFromBuffer` magic-byte check in `src/utils/recipeImporter.js` stay as-is; a larger allowed size must not become a looser allowed type set.
- **Downstream size risk to flag for QA:** `src/app.js` uses `express.json()` at its default 100kb body limit, and `/recipes/import/save` posts the extracted recipe text. A 4MB multi-page PDF can extract far more text than a 2MB one, so `/save` could start returning a 413 HTML page. If QA reproduces this, it needs a follow-up ticket rather than a silent bump here.
- **Timeout risk to flag for QA:** bigger images mean longer OCR, and `vercel.json`'s `maxDuration: 10` cuts the function off well before `OCR_TIMEOUT_MS = 30000`. Expect more platform timeouts on large images than on small ones.

## Acceptance criteria

- [ ] `src/routes/importRoutes.js` exports an import rate-limit max constant equal to `25` and an import window constant equal to `15 * 60 * 1000`, and `importLimiter` is constructed from them.
- [ ] `src/routes/importRoutes.js` exports a max import file size constant equal to `4 * 1024 * 1024`, it is used as `importUpload.limits.fileSize`, and its value is strictly less than `4.5 * 1024 * 1024` (Vercel's request-body cap).
- [ ] `POST /recipes/import/parse` still has, in order, `requireAuth`, the import rate limiter, the multer single-file middleware, and `csrfProtection`; a test fails if any of them is removed from that chain.
- [ ] `src/app.js` production `generalLimiter` has `max: 300` and an unchanged `windowMs` of `15 * 60 * 1000`, is still registered via `app.use`, and is still inside the `NODE_ENV === 'production'` guard.
- [ ] Exceeding the import rate limit returns HTTP 429 with a JSON body containing an `error` key whose value is the "Too many import attempts. Please try again in 15 minutes." message — not plain text and not an HTML page.
- [ ] Uploading a file larger than 4MB returns HTTP 413 with a JSON body containing an `error` key reading "File must be under 4MB" — not a rendered HTML error page.
- [ ] Uploading a disallowed type (e.g. `.txt`, `.docx`) still returns HTTP 400 with the existing unsupported-type JSON message; the allow-list is unchanged.
- [ ] A non-multer error thrown in the `/parse` chain is still delegated to the global `errorHandler` (the new handler does not swallow unrelated errors).
- [ ] `public/js/import.js` `MAX_FILE_SIZE` equals the exported server constant (asserted programmatically, not by eye), and its rejection copy reads "File must be under 4MB".
- [ ] `views/recipes/import.ejs` renders "Maximum file size: 4MB" and `views/partials/import-modal.ejs` renders "Max 4MB"; no "2MB" string remains in `views/`, `public/js/`, or `src/`.
- [ ] When the server returns a non-JSON error body, the import UI shows a human-readable message rather than a JSON parse error.
- [ ] A 3.5MB image/PDF import that previously failed the size check now uploads and reaches parsing (parse success itself depends on content; the size gate must not be the failure).
- [ ] 25 successive imports from one IP within a 15-minute window all pass the import rate limiter; the 26th is rejected with the 429 JSON body above — the limiter is still enforced.
- [ ] `docs/api/README.md` states General 300 per 15 minutes per IP, Recipe Imports 25 per 15 minutes per IP (not "per user"), and documents the actual rate-limit response body shape.
- [ ] `docs/plans/REW-12-file-import.md` notes that its 2MB / 5-per-15-minutes values are superseded by REW-43.
- [ ] No file was added to `database/migrations/` and no schema/RLS change is present in the diff.
- [ ] Focused import tests and the full `npm test` suite pass.

## Test cases to add or update

`src/routes/importRoutes.test.js` (extend; it already stubs `SUPABASE_URL`/`SUPABASE_ANON_KEY` before importing the module):

1. Exported limit constants have the expected values (`25`, `15 * 60 * 1000`, `4 * 1024 * 1024`) — locks the intended change against accidental drift.
2. Max import file size is strictly below `4.5 * 1024 * 1024` — encodes the Vercel platform cap as a test, not a comment.
3. Limiter options: `windowMs` and `max` come from the constants, `message` is an object with a non-empty `error` string, `standardHeaders` is `true`, `legacyHeaders` is `false`.
4. Multer error handler: `LIMIT_FILE_SIZE` → status 413 and `{ error: "File must be under 4MB" }`; unsupported-type error → 400 with the unsupported-type message; an unrelated `Error` → `next(err)` called once and no response written.
5. `/parse` middleware-chain guard: the route's handler stack contains `requireAuth` and `csrfProtection` by function identity plus a rate-limiting middleware (export `importLimiter` if identity is otherwise unreachable from the test).

`src/views/importRecipe.test.js` (extend; it already reads `public/js/import.js` as source text and renders `views/recipes/import.ejs` with EJS — reuse that pattern):

6. Parse `MAX_FILE_SIZE` out of the client source and assert it equals the exported server constant.
7. Assert the client source contains the "File must be under 4MB" copy and no "2MB" string.
8. Render `views/recipes/import.ejs` and assert it contains "Maximum file size: 4MB" and no "2MB".
9. Render `views/partials/import-modal.ejs` and assert it contains "Max 4MB" and no "2MB".

Manual/QA checks that automated tests cannot cover: a real >4MB upload returning the JSON 413 in the browser UI; a real 26th import in a window showing the 429 message in the UI; a large multi-page PDF still saving successfully through `/recipes/import/save` (watch for the `express.json()` 100kb limit); and OCR of a ~4MB photo against `vercel.json`'s 10-second `maxDuration`.
