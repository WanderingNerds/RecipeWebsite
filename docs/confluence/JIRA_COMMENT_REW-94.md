# Jira Comment for REW-94

*POSTED — added to [REW-94](https://wanderingnerds.atlassian.net/browse/REW-94) as comment id 10292 on 2026-09-15. The issue was **deliberately left at In Progress**: QA was deliberately skipped on this run and nothing is committed or merged. This file is the repo-side record of the posted content.*

**Confluence pages referenced in the comment:**
- [Release: REW-94 - Recipe Photo Upload Limit vs Vercel Request-Body Cap](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/31162369/Release+REW-94+-+Recipe+Photo+Upload+Limit+vs+Vercel+Request-Body+Cap) — created (page 31162369, v1), filed under *Releases*
- [REW-94: Recipe Photo Upload Limit vs Vercel Request-Body Cap - Bug Fix Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/31096833/REW-94+Recipe+Photo+Upload+Limit+vs+Vercel+Request-Body+Cap+-+Bug+Fix+Plan) — updated to as-shipped state (page 31096833, v2)

---

## Documentation Complete — Reviewed on Branch, QA Skipped, Not Merged

The recipe photo upload limit fix is implemented, code-reviewed (approved), and now documented. This is **not** a QA sign-off and **not** a release: the QA stage was deliberately skipped on this run, nothing is committed or merged, and `main` still carries the 5MB cap. Leaving this issue at **In Progress** on purpose.

**What shipped (branch `REW-94-recipe-image-upload-limit-vercel-cap`):** the recipe photo cap is `MAX_RECIPE_IMAGE_SIZE_BYTES = 4 * 1024 * 1024`, down from the 5MB literal, with `MAX_RECIPE_IMAGE_SIZE_LABEL` and all three user-facing messages derived from it so copy cannot go stale (the REW-43 pattern from `importRoutes.js`). The platform number now lives in `src/config/functionLimits.js` as `VERCEL_MAX_REQUEST_BODY_BYTES` (4.5MB), beside REW-93's duration constants, and a test asserts the photo limit stays **strictly** below it naming `FUNCTION_PAYLOAD_TOO_LARGE` — so it cannot drift back into the unreachable band.

**The opaque-error half of the ticket was fixed too.** Lowering the limit alone would have moved the generic 500 page from 5MB to 4MB, not removed it. New exported `handleRecipeImageUploadError` flashes a message and redirects instead: oversize, other Multer codes, and the non-image `fileFilter` rejection each get their own wording; anything else is delegated untouched via `next(err)`. The redirect target is derived server-side and `req.params.id` is gated on the existing UUID pattern with a `/recipes` fallback, so a hostile `:id` can never shape the `Location` header. The handler drains the aborted request (`req.unpipe()`, `req.resume()`) before redirecting, but only on the branches that answer — the delegating branch leaves the stream intact.

**Middleware order held:** `requireAuth` → `uploadLimiter` → `imageUpload.single("photo")` → `handleRecipeImageUploadError` → `csrfProtection` on both photo routes, asserted by tests. Route-level CSRF still runs after Multer because `csrfProtectionExceptMultipart` skips multipart requests and CSRF needs the parsed `_csrf` field. **The 10-uploads-per-15-minutes limiter is unchanged**, per this ticket.

**UX:** both recipe forms now state "Maximum file size: 4MB" (they previously stated no size at all) and carry an `aria-live="polite"` error region. `public/js/recipe-form.js` blocks an oversize file before upload, clearing the input and restoring the load-time preview — which preserves an already-saved photo on the edit form while dropping a just-previewed file.

**Database:** none. **Deployment:** no new env vars, no new dependencies, no migrations, no `vercel.json` change. Both caps are compile-time constants, not configuration. Note that the 4.5MB number is a Vercel property — if the deployment target or the platform cap ever changes, the mirrored constant must be updated by hand.

**Testing:** `npm test` — 452 tests, 450 pass, 2 fail. Both failures are the pre-existing Windows-only `EACCES /tmp/*.sock` cases in `src/csrf.integration.test.js`, a file this change does not touch; the same two failed on the pre-change baseline. **Worth flagging:** one of them, *"multipart CSRF validation runs after Multer exposes the token"*, covers the exact invariant this change relies on and **still needs to be confirmed green on a Linux CI runner before merge.** New: `src/routes/recipeImageUpload.test.js` (15 cases), `src/views/recipePhotoUpload.test.js` (10 cases), plus a pinning case in `src/config/functionLimits.test.js`.

**Unverified because QA was skipped** — the first item is the regression that matters most:
- A ~3.9MB photo still uploads, optimizes, thumbnails, and saves on both create and update.
- A >4MB photo submitted with JavaScript disabled lands on the flashed message, not the generic error template.
- The platform `FUNCTION_PAYLOAD_TOO_LARGE` page no longer appears in the old 4.5–5MB band. Only confirmable on a deployment.

**Known limitation recorded:** on a server-side Multer rejection the create form redirects, so typed content is lost. The client-side pre-check makes this rare but does not eliminate it (JavaScript disabled). Re-rendering would require reading a multipart body Multer has already aborted.

**Documentation updated:** `docs/api/recipe-photo-upload.md` (new reference page — there was no photo-upload API doc before), `docs/api/README.md`, `docs/api/recipe-import-limits.md`, `README.md`, `docs/RELEASE_NOTES_REW-94.md`. `database/README.md` needed no change. `docs/RELEASE_NOTES_REW-95.md` got a single dated annotation where its REW-96 follow-up note described the photo path as "behind a 5MB Multer cap" — annotated rather than rewritten, since it is a point-in-time record.

**Out of scope, left alone:** [REW-96](https://wanderingnerds.atlassian.net/browse/REW-96) (no decoded-pixel cap on the photo path) remains open. An encoded-byte cap of any size does not bound how large an image decompresses, so lowering this limit does not address it.

---
