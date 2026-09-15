# Release Notes: REW-95 - OCR Decoded-Pixel Cap (Image Decompression-Bomb Risk)

**Date:** 2026-09-14
**Jira Issue:** [REW-95](https://wanderingnerds.atlassian.net/browse/REW-95)
**Branch:** `REW-95-ocr-decoded-pixel-cap`
**Pipeline:** Planner → Developer → Reviewer (approved, 2 rounds, no blocking issues). **The QA stage was intentionally skipped on this run.** Nothing is committed or merged; the change exists only in the working tree of the branch. Jira status deliberately left at **In Progress**.

---

## Summary

The recipe import OCR path had no bound on how large an uploaded image decompresses. `parseImage()` handed the raw upload buffer straight to `Tesseract.recognize()`, and the only size limit anywhere in the chain was Multer's 4MB `limits.fileSize` — which bounds **encoded** bytes only. A highly compressible image (a large, mostly uniform PNG being the classic case) fits comfortably under 4MB and still decodes to a multi-gigabyte bitmap, so the memory and CPU ceiling on that path was effectively unbounded.

Imported images now pass through a `sharp` normalization step before OCR, with an explicit decoded-pixel cap. Any failure — including the cap rejection — maps to the generic import failure message the route already used, so the HTTP response surface is byte-for-byte unchanged.

This is hardening, not incident response. `requireAuth`, two rate limiters (25 imports / 15 min per IP plus the general limiter), and Vercel's `maxDuration: 10` already bounded the blast radius. REW-43 is what made it worth doing now: it raised the per-IP, per-window worst-case decode budget from 5 requests x 2MB to 25 requests x 4MB, roughly tenfold.

---

## User-Facing Changes

Essentially none for legitimate use. Specifically:

- An image whose decoded size exceeds the cap is rejected with `HTTP 400` and the existing message **"Could not process image. Please try a different image."** — the same response a corrupt or unreadable image has always produced. No new status code, no new error string, no new UI copy.
- Normal recipe photos continue to import and parse as before, with the same preview shape.
- **Tradeoff:** images larger than 2000px on the longest edge are now downscaled before OCR. For a dense, high-resolution photo of small print, this may cost some recognition accuracy. Accepted per the ticket; **not yet verified against a real phone-camera photo** (see Testing).
- Total wall-clock time per image import grows slightly, since normalization is an extra step.

---

## Technical Changes

### `src/utils/recipeImporter.js`

- Added the `sharp` import. `sharp ^0.35.3` was already a project dependency (used in `src/utils/imageUtils.js` for recipe photos) but was **not** used anywhere on the import path, so this is genuinely new behaviour there.
- New exported constant `OCR_MAX_INPUT_PIXELS = 40000000` — the decoded-pixel cap.
- New exported constant `OCR_MAX_DIMENSION = 2000` — the downscale box, longest edge.
- New exported `normalizeImageForOcr(imageBuffer, options)`. Pipeline, in order: `sharp(buffer, { limitInputPixels })` → `.rotate()` (EXIF) → `.resize({ fit: "inside", withoutEnlargement: true })` → `.grayscale()` + `.toColourspace("b-w")` → `.png()` → `.toBuffer()`. The `options` argument (`maxInputPixels`, `maxDimension`) is a test seam; production call sites use the defaults.
- `parseImage()` now normalizes first and passes the **normalized** buffer to Tesseract. It also takes an optional `{ normalize, recognize }` options argument so tests can drive both paths without invoking Tesseract (which would otherwise download language data).
- The OCR `setTimeout` handle is now captured and cleared in a `finally`.

### Decisions and tradeoffs

| Decision | Rationale |
|----------|-----------|
| Explicit `.png()` output | `toBuffer()` without a format encodes back to the *input* format, so a webp upload would hand webp to tesseract.js — a path this repo does not exercise. PNG is lossless, universally decodable, and costs nothing on text. |
| `.toColourspace("b-w")` in addition to `.grayscale()` | `grayscale()` alone still encodes three identical sRGB channels. The explicit colourspace conversion is what actually makes the bitmap single-channel, and what satisfies the `metadata.channels === 1` acceptance criterion. This was a deviation from the ticket's sketch, raised and accepted in review. |
| Normalize **before** the OCR timeout timer starts | Keeps `OCR_TIMEOUT_MS` meaning "time spent in OCR". The cost is slightly longer total wall-clock, and the interaction with Vercel's 10s `maxDuration` belongs to REW-93, not here. |
| Exported constants rather than inline literals | One source of truth for future tuning, and it makes the values assertable in tests. |
| Generic error message, sharp's text logged server-side only | `src/routes/importRoutes.js` returns `error.message` verbatim to the client. Any sharp text reaching that path would leak pixel counts, dimensions, and library internals to the caller. This is a response-surface control, not cosmetics. |
| Generic message must not contain `"timed out"` | `parseImage` special-cases that substring. A rejected oversize decode reported as "Image processing timed out. Try a clearer image." would be actively misleading. Normalization is caught in its own `try`/`catch` before the timeout promise is even constructed. |
| 40MP cap kept despite corrected sizing math | A 40MP input decodes to RGB/RGBA *before* `grayscale()` runs, so peak resident pixel data is ~120MB (RGB) to ~160MB (RGBA) plus libvips working memory — not the ~40MB originally documented. The value still fits the function memory budget, so only the justification needed correcting, not the number. |

### `src/utils/recipeImporter.test.js`

16 new co-located tests (34 in the file total, all passing). Fixtures are generated in-memory with `sharp`; no binary fixtures were committed. Coverage: constant values, downscale, no-enlargement, single-channel grayscale, explicit PNG output regardless of input format, over-cap rejection via an injected low cap, under-cap acceptance, corrupt-buffer rejection through the real sharp path, normalized-buffer-reaches-OCR, generic-message mapping, no sharp-text leakage, no false "timed out" classification, OCR never attempted when normalization fails, a real over-cap image through the real normalizer, the OCR accuracy warning, and PDF input routing away from the image branch.

No pre-existing assertion was modified or deleted (`git diff main` on the test file shows zero removed lines).

### Explicitly unchanged

`src/routes/importRoutes.js`, `src/utils/imageUtils.js`, `package.json`, `vercel.json`, Multer limits and `fileFilter`, `SUPPORTED_MIME_TYPES`, `IMPORT_RATE_LIMIT_MAX` / `IMPORT_RATE_LIMIT_WINDOW_MS`, helmet, the `requireAuth → importLimiter → importUpload → handleImportUploadError → csrfProtection` chain, `OCR_TIMEOUT_MS` (30000), and the `Promise.race` non-cancellation semantics.

---

## Database Changes

**None.** No migration, no table or column change, no RLS implication. Nothing was added to `database/migrations/`. This change affects in-memory processing on the import parse path only.

---

## API Changes

**None to the contract.** `POST /recipes/import/parse` keeps the same statuses and body shapes. The only behavioural difference is that a previously-accepted class of input (images decoding above 40MP) now falls into the existing `400` + `{ "error": "Could not process image. Please try a different image." }` branch instead of being handed to OCR.

Not a breaking change for any legitimate client.

---

## Configuration and Deployment

- **No new environment variables.**
- **No new dependencies.** `sharp ^0.35.3` was already in `package.json`; it is unchanged.
- **No migrations to run.**
- **No `vercel.json` change.** `maxDuration` stays at 10.
- **No security middleware changes.**

The two cap values are compile-time constants in `src/utils/recipeImporter.js`, not configuration. Tuning them requires a code change and a deploy — deliberate, so the security-relevant value cannot be loosened by an env var at runtime.

---

## Testing

**Automated.** `npm test`: **390 tests, 388 pass, 2 fail.** Both failures are pre-existing and unrelated — `src/csrf.integration.test.js` binds hardcoded `/tmp/*.sock` Unix socket paths, which Windows cannot bind (`EACCES`). The reviewer independently confirmed these fail identically on a clean `main` worktree. `src/utils/recipeImporter.test.js` alone: **34/34 pass.**

**QA: not performed.** The QA stage was intentionally skipped on this run. Nothing in this release note should be read as QA-verified. The following acceptance criteria from `docs/plans/rew-95-ocr-decoded-pixel-cap.md` remain **unverified**:

- A realistic phone-camera recipe photo (~2-4MB) still imports successfully and extracts recipe text at the 2000px downscale.
- A highly compressible oversize PNG is rejected with the generic message and does not exhaust server memory (measure against the corrected ~120-160MB peak figure, not ~40MB).
- End-to-end `POST /recipes/import/parse` behaviour in a running app — the automated coverage is unit-level against injected seams plus the real sharp path, not an HTTP round trip.

Recommend a QA pass before merge, or at minimum before production deployment.

---

## Known Non-Blocking Follow-Ups

Left at the developer's discretion by the round-2 reviewer; neither gates QA:

1. The new corrupt-buffer test uses a bare `assert.rejects` with no validator — the same loose pattern that was tightened elsewhere. Suggested validator: `/unsupported image format/i`.
2. `const ocrPromise = recognize(normalizedBuffer)` sits outside the `try`/`finally`, so a synchronously-throwing recognizer would bypass the generic-message mapping and leak the timer. Same shape as on `main` and not reachable via Tesseract, so cosmetic.

Pre-existing, untouched: `parseImage`'s `mimeType` parameter is still unused.

---

## Related Tickets (out of scope, still open)

- **[REW-93](https://wanderingnerds.atlassian.net/browse/REW-93)** — `OCR_TIMEOUT_MS` (30s) exceeds Vercel's `maxDuration: 10`, and `Promise.race` does not cancel the Tesseract worker; it only stops awaiting it, so orphaned work continues in the background. REW-95 meaningfully lowers the *cost* of that orphaned work (a capped, downscaled, grayscale bitmap is far cheaper to OCR) but does not fix cancellation or the timeout mismatch. Deliberately untouched.
- **[REW-96](https://wanderingnerds.atlassian.net/browse/REW-96)** — the same decompression-bomb class on the recipe **photo** path: `generateThumbnail()` and `optimizeImage()` in `src/utils/imageUtils.js` call `sharp(imageBuffer)` with no `limitInputPixels`, behind a 5MB Multer cap in `src/routes/recipeRoutes.js`. Filed during this run rather than widening REW-95's scope.
  *(Later note, 2026-09-15: that photo cap is 4MB as of REW-94, on branch `REW-94-recipe-image-upload-limit-vercel-cap`. The "5MB" above was accurate when this release note was written and is left as the point-in-time record. REW-96 itself is unaffected — an encoded-byte cap of any size does not bound the decoded bitmap.)*

---

## Documentation

- `docs/api/recipe-import-ocr-parsing.md` — new "Image Normalization Before OCR (REW-95)" section covering the pipeline, both constants, the error-handling contract, and known limitations; OCR usage example and changelog updated.
- `docs/api/recipe-import-limits.md` — decoded-pixel cap documented alongside the encoded-byte cap; the "no decoded-pixel cap" operational limitation rewritten to reflect branch status.
- `docs/api/README.md` — import endpoint note, rate-limit/upload-cap section, and detailed-docs list updated.
- `README.md` — Recipe Import feature section and Security section updated.
- `database/README.md` — **no change; none required.** This ticket touches no persistence.
- `docs/RELEASE_NOTES_REW-95.md` — this file.
- Confluence: release notes page plus the existing enhancement-plan page, updated to as-shipped state.
