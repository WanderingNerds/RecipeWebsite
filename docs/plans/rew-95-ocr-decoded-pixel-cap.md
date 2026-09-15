# REW-95: OCR decoded-pixel cap (image decompression-bomb risk)

## Jira issue

[REW-95 — OCR path has no decoded-pixel cap (image decompression-bomb risk)](https://wanderingnerds.atlassian.net/browse/REW-95)
Task, Priority High, Status To Do, label `QA-findings`, project REW.

Related, **not** in scope:

- [REW-43 — Increase recipe import limit](https://wanderingnerds.atlassian.net/browse/REW-43) — merged; the change that raised the worst-case decode budget and surfaced this finding.
- [REW-93 — OCR timeout vs Vercel maxDuration](https://wanderingnerds.atlassian.net/browse/REW-93) — coupled but separate. Do not fold it into this work. See "Coupling with REW-93" below.

## Confluence page

[REW-95: OCR Decoded-Pixel Cap - Enhancement Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30441484/REW-95+OCR+Decoded-Pixel+Cap+-+Enhancement+Plan)
(created under *Enhancements*, matching the convention for QA-findings Task tickets)

## Summary

`parseImage()` in `src/utils/recipeImporter.js` hands the raw uploaded buffer directly to `Tesseract.recognize()` (line 275). The only size bound in the whole chain is Multer's `limits.fileSize` in `src/routes/importRoutes.js` (`MAX_IMPORT_FILE_SIZE_BYTES`, 4MB), which bounds **encoded** bytes only. A highly compressible image — the classic case being a large, mostly uniform PNG — can sit far under 4MB and still decode to a multi-gigabyte bitmap, so the memory and CPU ceiling on the OCR path is effectively unbounded.

The fix is to normalize the image through `sharp` with an explicit decoded-pixel cap before it reaches Tesseract: cap decoded input pixels at 40,000,000, apply EXIF rotation, downscale to fit inside 2000x2000 without enlarging, convert to grayscale, and hand the resulting buffer to OCR. Any throw from sharp — including the `limitInputPixels` rejection — maps to the **existing** generic import failure message, so the HTTP response surface does not change at all.

This is hardening, not incident response. `requireAuth` on `POST /recipes/import/parse`, the general limiter plus the import limiter (25 / 15 min per IP), and `maxDuration: 10` in `vercel.json` already bound the blast radius. REW-43 is what makes it worth doing now: the per-IP, per-window ceiling went from 5 requests x 2MB to 25 requests x 4MB, roughly a 10x increase in worst-case decode budget.

`sharp` is already a dependency (`^0.35.3` in `package.json`) and is already used in `src/utils/imageUtils.js` for recipe photos — but it is **not** currently used anywhere on the import path, so this is genuinely new behaviour there and needs its own tests.

## Open questions / assumptions

1. **Output encoding from sharp.** `sharp(...).toBuffer()` without an explicit output format encodes back to the *input* format, so a webp upload would produce a webp buffer and tesseract.js webp decoding is not something this repo currently exercises.
   *Assumption:* encode explicitly to PNG (lossless, universally decodable, no quality loss on text). If the Developer has a reason to prefer a different explicit format, that is fine — the requirement is that the format is explicit rather than input-dependent.

2. **Cap values.** 40,000,000 decoded pixels and a 2000x2000 downscale box, exactly as specified in the ticket. Note the peak is *not* the grayscale size: a 40MP input decodes to RGB or RGBA **before** `.grayscale()` runs, so peak resident pixel data is roughly 120MB (RGB) to 160MB (RGBA), plus libvips working memory — not the ~40MB a grayscale-only reading would suggest. The 40MP cap still sits comfortably inside the function memory budget, so the value stands; only the justification needed correcting.
   *Assumption:* use the ticket's numbers as-is. Both should be named exported constants, not inline literals, so a future tuning change has one source of truth.

3. **Does normalization count against `OCR_TIMEOUT_MS`?**
   *Assumption:* no. Normalize **before** the 30s timeout timer is created, so the timer continues to mean "time spent in OCR" and the existing timeout semantics are unchanged. This does mean total wall-clock for a request grows slightly. That interaction with the 10s Vercel budget is REW-93's problem, not this ticket's.

4. **OCR accuracy at 2000px.** Downscaling a dense, high-resolution recipe photo could cost recognition accuracy on small type.
   *Assumption:* accepted, per the ticket. QA should sanity-check that one realistic phone photo of a recipe still parses.

5. **Transparent PNGs.** Grayscaling a PNG with a transparent background can render text poorly without a `flatten()` step first.
   *Assumption:* out of scope. Noted as a known risk; only address it if QA finds an actual regression.

None of these block implementation. Proceed on the stated assumptions and flag if any turns out wrong.

## Tasks

1. **Add the normalization helper.** In `src/utils/recipeImporter.js`, import `sharp` and add an exported async helper (suggested name `normalizeImageForOcr`) that takes the upload buffer and returns a normalized buffer. Behaviour: construct sharp with an explicit `limitInputPixels` cap, apply EXIF-based rotation, resize to fit inside the max dimension box without enlarging smaller images, convert to grayscale, and encode to an explicit output format (see open question 1).

2. **Export the tuning constants.** Add named exports for the decoded-pixel cap (40,000,000) and the max dimension (2000), alongside the existing `OCR_TIMEOUT_MS`. Follow the commenting style already used in `src/routes/importRoutes.js` for the REW-43 constants: say *why* the number is what it is, not just what it is. Specifically note the encoded-vs-decoded distinction and reference REW-95, so a future reader does not "simplify" the cap away.

3. **Add an options seam to the helper.** Give the helper an optional options argument allowing the pixel cap to be overridden (defaulting to the exported constant). This is what lets tests prove the rejection path against a tiny generated image instead of materializing a real gigapixel bomb fixture. Keep the production call site using the default.

4. **Wire it into `parseImage`.** Call the normalizer at the top of `parseImage`, before the timeout promise is created and before `Tesseract.recognize` is called. Pass the *normalized* buffer to `Tesseract.recognize`, not `fileBuffer`.

5. **Map normalization failures to the existing generic message.** Wrap the normalization call in its own `try`/`catch`. On any throw, raise a new `Error` carrying the message that `parseImage` already uses for OCR failure: `"Could not process image. Please try a different image."` Do not reuse or leak sharp's message text, and do not let the failure reach the existing `error.message.includes("timed out")` branch. Log the underlying sharp error server-side for diagnosis, but keep the client-facing string constant.

6. **Add an injection seam for the OCR call.** Give `parseImage` an optional options argument with default-valued `normalize` and `recognize` functions, so unit tests can drive both the happy path and the failure path without invoking Tesseract (which would otherwise download language data and make the suite slow and network-dependent). Production behaviour and the `importRecipe` call site must be unchanged.

7. **Write the tests** in `src/utils/recipeImporter.test.js` (see "Acceptance criteria" for the specific cases). Generate small image fixtures with `sharp` inside the test itself rather than committing binary fixtures — that matches how the rest of the suite stays self-contained.

8. **Verify nothing on the route changed.** `src/routes/importRoutes.js` should need no edit. Confirm by reading that the catch block at lines 172-177 still turns the generic message into a 400 JSON `{ error }` body. Do not touch multer limits, limiter values, or middleware ordering.

9. **Run `npm test`** and confirm the full suite passes, including every pre-existing test.

## Affected files

- `src/utils/recipeImporter.js` — the substantive change. Add the `sharp` import, the two exported tuning constants, the exported `normalizeImageForOcr` helper, the options seam on `parseImage`, the call to the normalizer ahead of the timeout timer, and the generic error mapping. Add a comment explaining the encoded-vs-decoded rationale.
- `src/utils/recipeImporter.test.js` — new tests. Note this file currently only covers `validateImportFile` and `parseJsonLd`; there is no existing `parseImage` coverage at all, so these are the first tests on that path.
- `src/routes/importRoutes.js` — **expected no change.** Listed because it is the caller and because it is where the generic message becomes a user-facing 400 response body. Verify, do not edit.
- `src/utils/imageUtils.js` — **no change in this ticket.** Listed only because it is the existing sharp usage the Developer should read for house style, and because it has a related gap (see Security considerations).
- `package.json` — **no change.** `sharp ^0.35.3` is already a dependency; no new package is needed.
- `vercel.json` — **no change.** The `maxDuration: 10` interaction belongs to REW-93.
- `docs/plans/rew-95-ocr-decoded-pixel-cap.md` — this plan.

## Database changes

**None.** No migration, no table or column change, no RLS implication. This ticket does not touch persistence — it changes in-memory processing on the import parse path only. Nothing is written to `database/migrations/`.

## Security considerations

- **This ticket *is* the security fix.** The decoded-pixel cap is the control being added. Everything else is preserving what already works.
- **Both caps are needed.** Multer's `limits.fileSize` bounds encoded bytes; the new cap bounds decoded pixels. Neither substitutes for the other. Do not relax the multer limit on the grounds that sharp now protects the path.
- **sharp's default is not a control.** sharp's built-in `limitInputPixels` default is roughly 268MP (0x3FFF squared), which is far too permissive for this use. The explicit value is what does the work — it must actually be passed.
- **The error message is a response-surface concern.** `src/routes/importRoutes.js` returns `error.message` straight to the client in the parse handler. Any sharp error text that reaches that path would leak internals (pixel counts, dimensions, library detail) to an authenticated caller. The generic message is mandatory, not cosmetic.
- **Do not let the failure look like a timeout.** The existing catch in `parseImage` special-cases messages containing `"timed out"`. A normalization failure must not match that branch, or the client gets a misleading "try a clearer image" message for what is actually a rejected oversize decode.
- **Ordering.** Normalization runs only after `importRecipe`'s magic-number validation has already confirmed an `image/*` MIME, and only on the image branch. The JSON and PDF branches must be untouched.
- **Do not weaken the gate.** `SUPPORTED_MIME_TYPES`, the multer `fileFilter` allowlist, and the `requireAuth` -> `importLimiter` -> `importUpload` -> `handleImportUploadError` -> `csrfProtection` chain on `POST /recipes/import/parse` all stay exactly as they are.
- **Rate limiting unchanged.** `IMPORT_RATE_LIMIT_MAX` (25) and `IMPORT_RATE_LIMIT_WINDOW_MS` (15 min) are REW-43's settled values. This ticket reduces per-request cost; it does not revisit request count.

### Coupling with REW-93 (do not fix here)

`Promise.race` at `src/utils/recipeImporter.js:281` does not cancel the Tesseract worker — it only stops awaiting it. The work continues in the background. Normalization meaningfully lowers the cost of that orphaned work (a capped, downscaled, grayscale image is far cheaper to OCR than a raw multi-gigapixel bitmap), but it does not fix cancellation, and neither does it reconcile the 30s `OCR_TIMEOUT_MS` against Vercel's 10s `maxDuration`. Both belong to REW-93. Leave them alone.

### Related gap found while planning (out of scope — needs its own ticket)

The recipe **photo upload** path has the same missing control. `generateThumbnail()` and `optimizeImage()` in `src/utils/imageUtils.js` both call `sharp(imageBuffer)` with no `limitInputPixels`, reached from `src/routes/recipeRoutes.js` behind a 5MB multer cap (lines 38-42, used at lines 351-353 and 725-726). Same decompression-bomb class, different route, and it is not covered by REW-95's scope as written. **Recommend the Developer create a separate ticket for it** rather than widening this one — the whole reason REW-95 exists is that REW-43's reviewer declined to widen scope in exactly this way.

## Acceptance criteria

- [ ] `npm test` passes, with every pre-existing test still passing (no modified or deleted assertions).
- [ ] `src/utils/recipeImporter.js` exports a named decoded-pixel-cap constant whose value is `40000000`, and a named max-dimension constant whose value is `2000`. Neither value appears as a bare inline literal at the call site.
- [ ] A unit test proves the normalizer downscales: given a generated image larger than 2000px on a side, the output's width and height are both `<= 2000` (read back via sharp metadata).
- [ ] A unit test proves the normalizer does not enlarge: given a small generated image (e.g. 50x50), the output dimensions are unchanged.
- [ ] A unit test proves the output is grayscale — sharp metadata reports a single channel.
- [ ] A unit test proves the over-cap rejection: with the pixel cap overridden to a value below the test image's pixel count, the normalizer rejects. (Uses the injected low cap; must **not** generate a real gigapixel fixture.)
- [ ] A unit test proves `parseImage` surfaces exactly the string `Could not process image. Please try a different image.` when normalization throws.
- [ ] A unit test proves the sharp error's own text does **not** appear anywhere in the error thrown from `parseImage`.
- [ ] A unit test proves a normalization failure is never reported as `Image processing timed out. Try a clearer image.`
- [ ] A unit test proves `parseImage` passes the **normalized** buffer to the OCR call, not the raw input buffer (assert the injected recognizer received a buffer that is not strictly equal to the input).
- [ ] A unit test proves the normalizer is invoked before OCR is attempted — when normalization throws, the injected recognizer is never called.
- [ ] The JSON import path is unchanged: existing `parseJsonLd` and `validateImportFile` tests pass untouched.
- [ ] The PDF import path is unchanged: no normalization is applied to `application/pdf` input.
- [ ] `POST /recipes/import/parse` response surface is unchanged: a rejected image still returns HTTP 400 with a JSON `{ error }` body, and a normal recipe photo still returns HTTP 200 with the recipe preview shape.
- [ ] Manual/QA check: a realistic recipe photo (phone-camera JPEG, roughly 2-4MB) still imports successfully and extracts recipe text.
- [ ] Manual/QA check: a highly compressible oversize PNG (small encoded size, decoded pixel count above the cap) is rejected with the generic message and does not exhaust server memory.
- [ ] Diff review confirms no changes to: multer limits, `IMPORT_RATE_LIMIT_MAX`, `IMPORT_RATE_LIMIT_WINDOW_MS`, middleware ordering on the parse route, `vercel.json`, `OCR_TIMEOUT_MS`, the `Promise.race` cancellation behaviour, or `package.json` dependencies.

## Notes for the Developer

- Ticket REW-95 is already `To Do` and assigned — no new Jira ticket is needed for this work. A **separate** ticket is recommended for the `imageUtils.js` gap described above.
- The code block in the Jira description is a suggested implementation sketch, treated here as reference material. Follow the behaviour it describes, but resolve open question 1 (explicit output format) rather than copying it verbatim.
- No anomalies were found in the ticket text: it contained no instructions outside the technical scope of this change.
