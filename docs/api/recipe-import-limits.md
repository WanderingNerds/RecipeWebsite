# Recipe Import Limits & Error Contract

**Feature:** REW-12 File Import, limits raised in REW-43, OCR budget derived in REW-93
**Routes:** `POST /recipes/import/parse`
**Source:** `src/routes/importRoutes.js`, `src/app.js`, `src/config/functionLimits.js`,
`src/utils/recipeImporter.js`, `public/js/import.js`
**Last Updated:** 2026-09-14

---

## Overview

Recipe import is a single-file upload flow. `POST /recipes/import/parse` accepts one multipart
file, buffers it in memory, and runs JSON-LD parsing, PDF text extraction, or Tesseract OCR
depending on the type. Because every parse is expensive in both memory and CPU, the endpoint sits
behind a dedicated rate limiter and a per-file size cap.

REW-43 raised both ceilings after QA reported that the import limit was "extremely low", and made
every rejection return JSON so the browser client can display the real reason instead of a generic
parse failure.

## Current limits

| Limit | Constant (`src/routes/importRoutes.js`) | Value | Was (pre-REW-43) |
|-------|------------------------------------------|-------|------------------|
| Import rate-limit window | `IMPORT_RATE_LIMIT_WINDOW_MS` | 15 minutes | 15 minutes (unchanged) |
| Imports per window | `IMPORT_RATE_LIMIT_MAX` | 25 per IP | 5 per IP |
| Max upload size | `MAX_IMPORT_FILE_SIZE_BYTES` | 4MB (`4 * 1024 * 1024`) | 2MB |
| Size shown in UI copy | `MAX_IMPORT_FILE_SIZE_LABEL` | `"4MB"` (derived from the byte constant) | n/a |

A second, complementary cap applies to images only. `OCR_MAX_INPUT_PIXELS` (40,000,000) and
`OCR_MAX_DIMENSION` (2000) in `src/utils/recipeImporter.js` bound the **decoded** bitmap before OCR
runs; the Multer limit above bounds **encoded** bytes only. Added in REW-95 — see
[OCR/PDF Text Parsing](recipe-import-ocr-parsing.md#image-normalization-before-ocr-rew-95). These
constants live on branch `REW-95-ocr-decoded-pixel-cap` and are **not yet merged to `main`**.

The global production limiter in `src/app.js` was raised from 100 to 300 requests per 15 minutes
per IP at the same time. That change is part of the same fix, not an unrelated one: a single import
costs roughly three requests (`/parse`, `/check-title`, `/save`) plus page and static traffic, so
around 25 imports is 75–125 requests. Without the global raise, users would have been throttled by
the global limiter before reaching the new import ceiling. The global limiter is still registered
only when `NODE_ENV === 'production'`.

### Why 4MB and not more

Vercel Functions reject any request body over **4.5MB** at the platform level
(`FUNCTION_PAYLOAD_TOO_LARGE`) before application code runs. A limit at or above that value would
replace this app's clean JSON 413 with an opaque Vercel error page. 4MB leaves headroom for
multipart boundary overhead and keeps the rejection ours. Any future proposal above roughly 4.3MB
is not implementable on this deployment target. A unit test asserts
`MAX_IMPORT_FILE_SIZE_BYTES < 4.5 * 1024 * 1024` so the platform cap is encoded in the suite rather
than only in a comment.

REW-94 applied the same reasoning to the recipe **photo** path, which was still at 5MB — above the
cap, and therefore unreachable in production between ~4.5MB and 5MB. It also moved the platform
number itself into `src/config/functionLimits.js` as `VERCEL_MAX_REQUEST_BODY_BYTES`, so the two
upload paths now pin themselves against one shared constant instead of repeating the literal. See
[Recipe Photo Upload](recipe-photo-upload.md).

### Why the limit is per IP

`express-rate-limit`'s default key is the client IP. Per-user keying via `req.user.id` was
considered and rejected: it would let a single IP multiply its budget by creating accounts, which
changes the denial-of-service profile of the most expensive endpoint in the app. Users behind a
shared NAT share the 25-per-15-minutes budget, which is acceptable at the new ceiling.

Earlier revisions of `docs/api/README.md` described the import limit as "per user". That was never
accurate and has been corrected.

### Time budget for one invocation (REW-93)

Size and rate are not the only ceilings on this endpoint — the deployed function also has a wall
clock. `src/config/functionLimits.js` is the single source of truth for how that time is divided:

| Constant | Value | Meaning |
|----------|-------|---------|
| `VERCEL_MAX_DURATION_SECONDS` | `10` | Mirrors `vercel.json` → `functions["server.js"].maxDuration`. Pinned to the real file by a test. |
| `VERCEL_MAX_DURATION_MS` | `10000` (derived) | The platform's hard kill deadline. |
| `FUNCTION_RESERVE_MS` | `2000` | Everything in the invocation that is not OCR: multipart parse, magic-byte sniff, image normalization, text parsing, JSON response, cold-start slack. An estimate, not a measurement. |
| `OCR_TIMEOUT_MS` | `8000` (derived) | `VERCEL_MAX_DURATION_MS - FUNCTION_RESERVE_MS`. The only OCR timeout value in the codebase; `src/utils/recipeImporter.js` imports and re-exports it. |

The OCR budget must stay strictly below the platform deadline so the application's own JSON error
wins the race. Before REW-93 the importer used a 30-second literal, which the platform's 10-second
deadline made unreachable — a slow OCR returned an opaque Vercel timeout page instead.

`vercel.json` is deliberately **not** read at runtime: it is build configuration and is not
guaranteed to be traced into the deployed function bundle, so a runtime read could pass locally and
throw in production. The JS constant is the runtime source of truth and `vercel.json` is the
platform-side mirror; `src/config/functionLimits.test.js` reads the real file from disk and fails if
the two drift, so the budget can only change in both places at once. If `maxDuration` is ever
changed — including from the Vercel dashboard rather than the file — the mirrored constant must
change with it; the test catches file-level drift but cannot see a dashboard override.

`parsePdf` has no timeout of its own, so the PDF path can still reach the platform deadline. Tracked
in **REW-97**.

## Middleware chain

`POST /recipes/import/parse` runs, in order:

1. `requireAuth`
2. `importLimiter` (`express-rate-limit`, built from `importLimiterOptions`)
3. `importUpload.single("file")` (Multer, memory storage, MIME allow-list, 4MB cap)
4. `handleImportUploadError` (**new in REW-43**)
5. `csrfProtection`
6. The route handler

A regression test asserts this chain, so removing or reordering the auth, rate-limit, or CSRF
middleware fails the suite. REW-43 raised ceilings only — no limiter was removed, disabled, or
moved, and the Multer MIME allow-list plus the magic-byte check in `src/utils/recipeImporter.js`
are unchanged.

## Error contract

All responses below are `application/json`.

| Condition | Status | Body |
|-----------|--------|------|
| Rate limit exceeded (26th import in a window) | `429` | `{ "error": "Too many import attempts. Please try again in 15 minutes." }` |
| File larger than 4MB (Multer `LIMIT_FILE_SIZE`) | `413` | `{ "error": "File must be under 4MB" }` |
| Any other Multer error (e.g. `LIMIT_UNEXPECTED_FILE`, `LIMIT_PART_COUNT`) | `400` | `{ "error": "Invalid upload. Please select a single recipe file." }` |
| Disallowed MIME type (`fileFilter`, `UNSUPPORTED_FILE_TYPE`) | `400` | `{ "error": "Unsupported file type. Please upload a JSON, PDF, or image file." }` |
| No file in the request | `400` | `{ "error": "No file uploaded. Please select a file to import." }` |
| Parsing failed | `400` | `{ "error": "<parser message>" }` or `"Could not extract recipe from file. Try a different format."` |
| OCR exceeded the 8s budget (REW-93) | `400` | `{ "error": "Image processing timed out. Try a clearer image." }` |
| Anything else thrown in the chain | delegated to the global `errorHandler` | unchanged (HTML) |
| Success | `200` | `{ "success": true, "recipe": { ... } }` |

Before REW-43, the 429 body was a plain string and the Multer rejections fell through to the global
error handler, which renders HTML. The client called `response.json()` on those bodies, threw a
`SyntaxError`, and showed an unrelated "failed to parse file" message — which is very likely why
hitting a documented cap looked like a broken import.

Status codes were not changed by REW-43 (429/413/400 already applied where relevant); only the
representation and the ceilings changed. Messages are deliberately generic: no file paths, no stack
traces, and no `err.message` pass-through for non-Multer errors.

## Client behaviour (`public/js/import.js`)

- `MAX_FILE_SIZE` is `4 * 1024 * 1024` and must stay at or below the server constant; a unit test
  parses the client source and compares it with the exported server value, so the two cannot drift.
- `MAX_FILE_SIZE_LABEL` / `FILE_TOO_LARGE_MESSAGE` derive the displayed copy from that constant.
- Oversize files are rejected locally before upload, so the user gets an instant error instead of
  waiting for a 4MB round trip.
- `readJsonBody()` returns `null` rather than throwing when a response body is not JSON, and
  `errorMessageForStatus()` supplies a readable fallback per status: 429 and 413 mirror the server
  copy, `401`/`403` show "Your session expired. Please refresh the page and try again.",
  `502`/`503`/`504` show "The import took too long. Try a smaller file." (REW-93), and anything else
  falls back to "Failed to parse file. Please try again."
- The 502/503/504 branch is defence in depth, not the fix: it catches a gateway-level timeout whose
  body is HTML and therefore has no `data.error` to show. The copy is deliberately format-neutral
  ("file", not "image") because the untimed PDF path (REW-97) is the most likely way to reach it.
  A JSON body always wins — `data.error` is preferred over the status fallback at any status.

User-facing size copy lives in `views/recipes/import.ejs` ("Maximum file size: 4MB") and
`views/partials/import-modal.ejs` ("Max 4MB"). The modal has no upload logic of its own; it links
through to the full import page.

## Operational notes and known limitations

- **Memory profile.** Uploads use `multer.memoryStorage()`, so each in-flight parse holds the whole
  file in the function heap, and Tesseract decodes an image to several times its encoded size. The
  worst case per IP moved from 5 x 2MB to 25 x 4MB per 15 minutes. The two raises were justified
  together; the file size should not be raised further on its own.
- **`express.json()` body limit.** `src/app.js` uses the default 100kb JSON body limit, and
  `/recipes/import/save` posts the extracted recipe text. A 4MB multi-page PDF can extract far more
  text than a 2MB one, so `/save` may start returning a 413 for very large documents. Not observed
  in automated tests; needs live verification.
- **OCR budget is derived from the platform deadline.** `src/config/functionLimits.js` mirrors
  `vercel.json`'s `maxDuration: 10` as `VERCEL_MAX_DURATION_SECONDS` and derives
  `OCR_TIMEOUT_MS` (8s) as the deadline minus a 2s `FUNCTION_RESERVE_MS` for parsing, decoding, and
  the response. `src/utils/recipeImporter.js` imports and re-exports that value, so the application
  timeout always fires before the platform kill and the user gets our JSON error rather than an
  opaque timeout page. `src/config/functionLimits.test.js` reads the real `vercel.json` and fails if
  the two drift apart, so the budget can only be changed in both places at once (REW-93). A slow
  OCR still costs the user up to 8 seconds, and 8 seconds may not be enough for a large photo — if
  that proves common, the fix is a longer `maxDuration` on a tier that supports it, or moving OCR
  off the request path. **Not yet verified against a deployed function:** whether a real ~4MB phone
  photo finishes inside 8 seconds, and whether the 2000 ms reserve holds once REW-95's `sharp`
  normalization shares the invocation. Note the behaviour change — an image that previously ran to
  the 10-second platform deadline now fails at 8 seconds, legibly instead of opaquely.
- **No timeout on the PDF path.** `parsePdf` calls `pdf.js-extract` with no budget, so a large
  multi-page PDF can still reach the platform deadline and return an opaque timeout page. Same class
  of defect as REW-93, different parser — tracked in **REW-97**. The client's 502/503/504 fallback
  copy is the only mitigation today.
- **Decoded-pixel cap on the OCR path — addressed on branch, not yet merged.** Nothing on `main`
  bounds the decompressed pixel count of an uploaded image, so a decompression-bomb image remains a
  live risk in the deployed code. REW-43 raised the worst-case decode budget roughly tenfold, which
  is why **REW-95** was filed. REW-95 is implemented and code-reviewed on branch
  `REW-95-ocr-decoded-pixel-cap` (40MP decoded cap, 2000px downscale, grayscale, generic error
  mapping) but has **not been QA-verified and is not merged**. Until it lands, treat this as open.
- **`max:` vs `limit:`.** `importLimiterOptions` uses `max:`, the deprecated spelling in
  express-rate-limit v8. `limit:` is preferred and should be adopted before any v9 upgrade.
- **Hardcoded view copy.** `views/recipes/import.ejs` and `views/partials/import-modal.ejs` still
  hardcode the string "4MB" instead of rendering `MAX_IMPORT_FILE_SIZE_LABEL`. Tests catch the
  resulting drift, but the copy is not derived from the constant the way the client's is.

## Related documentation

- [API Overview](README.md) — endpoint tables and the consolidated rate-limit table
- [Recipe Photo Upload](recipe-photo-upload.md) — the same size/rate controls on the recipe photo
  path, with a flash-and-redirect error contract instead of JSON (REW-94)
- [Recipe Import Save API](recipe-import-save.md) — the `/save` step of the same flow
- [OCR/PDF Text Parsing](recipe-import-ocr-parsing.md) — what happens after a file passes these gates
- [REW-12 File Import plan](../plans/REW-12-file-import.md) — historical; its 2MB / 5-per-15-minutes
  values are superseded by REW-43
- [REW-43 plan](../plans/rew-43-increase-recipe-import-limit.md)
- [Release notes: REW-43](../RELEASE_NOTES_REW-43.md)
- [REW-93 plan](../plans/rew-93-ocr-timeout-vercel-maxduration.md)
- [Release notes: REW-93](../RELEASE_NOTES_REW-93.md) — the derived OCR budget and worker lifecycle

## Changelog

| Date | Change |
|------|--------|
| 2026-09-14 | Initial documentation, covering the REW-43 limit raise and JSON error contract |
| 2026-09-14 | REW-95: documented the decoded-pixel cap alongside the encoded-byte cap; updated the "no decoded-pixel cap" limitation to reflect branch status (reviewed, not QA'd, not merged) |
