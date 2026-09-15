# Jira Comment for REW-95

*POSTED — added to [REW-95](https://wanderingnerds.atlassian.net/browse/REW-95) as comment id 10279 on 2026-09-14. The issue was **deliberately left at In Progress**: QA was intentionally skipped on this run and nothing is committed or merged. This file is the repo-side record of the posted content.*

**Confluence pages referenced in the comment:**
- [Release: REW-95 - OCR Decoded-Pixel Cap](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30703617/Release+REW-95+-+OCR+Decoded-Pixel+Cap) — created (page 30703617, v1), filed under *Releases*
- [REW-95: OCR Decoded-Pixel Cap - Enhancement Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30441484/REW-95+OCR+Decoded-Pixel+Cap+-+Enhancement+Plan) — updated to as-shipped state (page 30441484, v2)

---

## Documentation Complete — Reviewed on Branch, QA Skipped, Not Merged

The OCR decoded-pixel cap is implemented, code-reviewed (approved, 2 rounds, no blocking issues), and now documented. This is **not** a QA sign-off and **not** a release: the QA stage was intentionally skipped, nothing is committed or merged, and `main` is still unprotected against this input class.

**What shipped (branch `REW-95-ocr-decoded-pixel-cap`):** imported images are normalized through `sharp` before OCR — decoded input capped at `OCR_MAX_INPUT_PIXELS = 40000000`, EXIF rotation, fit-inside resize to `OCR_MAX_DIMENSION = 2000` without enlargement, `.grayscale()` + `.toColourspace("b-w")`, explicit PNG output. The 4MB Multer limit bounds *encoded* bytes; this bounds the *decoded* bitmap. Both caps are needed, and the docs say so explicitly so neither gets "simplified away" later.

**Response surface unchanged.** Any sharp throw, including the `limitInputPixels` rejection, is logged server-side and re-thrown as the constant `Could not process image. Please try a different image.` `importRoutes.js` returns `error.message` verbatim, so this is the control that keeps pixel counts, dimensions and library internals out of the 400 body. The message deliberately excludes `"timed out"`, so a rejected decode can never be misrouted into the OCR-timeout branch.

**Decisions documented:** explicit PNG output (`toBuffer()` would otherwise echo the input format); `.toColourspace("b-w")` because `.grayscale()` alone still emits three identical sRGB channels; normalization runs *outside* `OCR_TIMEOUT_MS` so that timer keeps meaning "time in OCR"; the 40MP cap value is unchanged even though the memory rationale was corrected to ~120-160MB peak.

**Database:** none. **Deployment:** no new env vars, no new dependencies (`sharp ^0.35.3` already present), no `vercel.json` change, no security middleware change. Cap values are compile-time constants, not configuration.

**Testing:** `npm test` — 390 tests, 388 pass, 2 fail; both failures are the pre-existing `src/csrf.integration.test.js` `EACCES /tmp/*.sock` cases, independently confirmed failing on clean `main`. `src/utils/recipeImporter.test.js` alone: 34/34 (16 new). **Unverified because QA was skipped:** realistic phone-camera photo still parses at 2000px; highly compressible oversize PNG rejected without exhausting memory; end-to-end `POST /recipes/import/parse` in a running app.

**Documentation updated:** `docs/api/recipe-import-ocr-parsing.md`, `docs/api/recipe-import-limits.md`, `docs/api/README.md`, `README.md`, `docs/RELEASE_NOTES_REW-95.md`. `database/README.md` needed no change.

**Out of scope, left alone:** REW-93 (`OCR_TIMEOUT_MS` vs Vercel `maxDuration`; `Promise.race` non-cancellation) and REW-96 (same decompression-bomb class on the recipe-photo path in `src/utils/imageUtils.js`).

**Gap flagged for a human:** the Confluence page [RecipeWebsite API Documentation](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/15007745/RecipeWebsite+API+Documentation) has not been touched since 2026-08-14 and is well behind `docs/api/README.md`. Not updated here — that is a broader cleanup, not a REW-95 edit.

---
