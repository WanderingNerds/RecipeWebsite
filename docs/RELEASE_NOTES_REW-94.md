# Release Notes: REW-94 - Recipe Photo Upload Limit vs Vercel's Request-Body Cap

**Date:** 2026-09-15
**Jira Issue:** [REW-94](https://wanderingnerds.atlassian.net/browse/REW-94)
**Branch:** `REW-94-recipe-image-upload-limit-vercel-cap`
**Pipeline:** Planner → Developer → Reviewer (approved). **The QA stage was deliberately skipped on this run.** Nothing is committed or merged; the change exists only in the working tree of the branch. Jira status deliberately left at **In Progress**.

---

## Summary

`src/routes/recipeRoutes.js` capped recipe photo uploads at 5MB. Vercel Functions reject any request
body over **4.5MB** with a platform-level `FUNCTION_PAYLOAD_TOO_LARGE` 413 *before* application code
runs, so photos in the ~4.5MB–5MB band could never succeed in production. The app advertised a limit
it could not honour, and a user who hit that band got an opaque Vercel error page rather than
anything this application controls.

The photo cap is now **4MB**, matching the import path's constant and sitting below the platform cap
with headroom for multipart framing, the other form fields, and headers — all of which count toward
the platform's measurement of the body. The 4.5MB platform number now lives as a named constant in
`src/config/functionLimits.js`, and tests pin the photo limit strictly below it so it cannot drift
back.

A second, related defect was fixed in the same change. Even *below* the platform cap, a Multer
rejection on `POST /recipes` or `POST /recipes/:id/update` fell through to the global `errorHandler`,
which rendered a generic 500 "Something went wrong" page. Lowering the limit alone would have fixed
the unreachable band and left the "opaque failure" complaint half-answered, just at a lower
threshold. Photo rejections now flash a readable message and return the user to the form.

---

## User-Facing Changes

- **The recipe photo limit is 4MB, down from 5MB.** Photos above 4MB are now rejected. In practice
  nothing that previously worked stops working: anything between 4.5MB and 5MB already failed in
  production, and the 4MB–4.5MB band is the only genuine reduction.
- **Both recipe forms now state the limit.** "Maximum file size: 4MB" appears under the photo picker
  on New Recipe and Edit Recipe, matching the wording already used on the import page. Neither form
  previously stated a size at all.
- **Oversize files are caught in the browser.** Selecting a file over 4MB clears the input, restores
  the preview to its load-time state, and shows "Photo must be under 4MB" in an `aria-live="polite"`
  region — so the user is told immediately instead of waiting for a 4MB round trip. On the edit
  form, a photo already saved on the recipe stays visible; a file the user had just previewed is
  dropped along with the cleared input.
- **A rejected upload returns to the form with a message**, not the generic error page. Oversize,
  non-image, and malformed uploads each get their own wording.
- **Tradeoff:** on a server-side rejection the create form redirects, so anything the user had typed
  is lost. The client-side pre-check makes this rare (the file never leaves the browser), but it is
  still reachable with JavaScript disabled. See Known Limitations.

---

## Technical Changes

### `src/config/functionLimits.js`

- New exported `VERCEL_MAX_REQUEST_BODY_BYTES = 4.5 * 1024 * 1024` (4,718,592), documented alongside
  REW-93's duration constants with the same reasoning style: what the platform does, why it is
  mirrored in JS rather than read at runtime, and a link to the `FUNCTION_PAYLOAD_TOO_LARGE` docs.
- `VERCEL_MAX_DURATION_SECONDS`, `VERCEL_MAX_DURATION_MS`, `FUNCTION_RESERVE_MS`, and
  `OCR_TIMEOUT_MS` are untouched.

### `src/routes/recipeRoutes.js`

- New exported `MAX_RECIPE_IMAGE_SIZE_BYTES = 4 * 1024 * 1024` (4,194,304), replacing the
  `5 * 1024 * 1024` literal and its now-wrong `// 5MB limit` comment.
- New exported `MAX_RECIPE_IMAGE_SIZE_LABEL`, derived from the byte constant, plus three derived
  message constants: `RECIPE_IMAGE_TOO_LARGE_MESSAGE` ("Photo must be under 4MB"),
  `RECIPE_IMAGE_NOT_AN_IMAGE_MESSAGE`, and `RECIPE_IMAGE_INVALID_UPLOAD_MESSAGE`. Copy is built from
  the constant, mirroring the REW-43 pattern in `importRoutes.js`, so a future limit change cannot
  leave stale text behind.
- The Multer instance `upload` is renamed to `imageUpload` (the name the ticket and the docs already
  used) and exported; `uploadLimiter` is exported too, so tests assert against the real objects the
  router uses rather than a re-declared copy.
- The `fileFilter` rejection now carries `code: "UNSUPPORTED_FILE_TYPE"` so the new error handler can
  distinguish it. **The filter's behaviour is unchanged** — it still rejects anything whose mimetype
  does not start with `image/`, and `validateImageFile`'s magic-byte sniff remains the real gate.
- New exported `handleRecipeImageUploadError(err, req, res, next)`. On `LIMIT_FILE_SIZE` it flashes
  the size message; on any other `MulterError` the invalid-upload message; on the `fileFilter`
  rejection the not-an-image message; anything else is delegated untouched via `next(err)`.
- Redirect target is derived server-side: `/recipes/new` when there is no `:id`, `/recipes/:id/edit`
  when `:id` matches the module's existing `UUID_PATTERN`, and `/recipes` when it does not. Raw
  `req.params.id` never reaches the `Location` header.
- Before redirecting, the handler calls `req.unpipe()` and `req.resume()` to drain the rest of the
  upload — **only on the branches that answer the request**. The delegating branch leaves the stream
  intact for the global handler.
- Registered on both routes between `imageUpload.single("photo")` and `csrfProtection`. The full
  chain on `POST /recipes` and `POST /recipes/:id/update` is now `requireAuth` → `uploadLimiter` →
  `imageUpload.single("photo")` → `handleRecipeImageUploadError` → `csrfProtection`.
- **The 10-uploads-per-15-minutes rate limiter is unchanged**, per the ticket.

### `views/recipes/new.ejs`, `views/recipes/edit.ejs`

- A muted "Maximum file size: 4MB" hint under the photo picker, styled like the equivalent line on
  `views/recipes/import.ejs`.
- A hidden `#photoError` element with `aria-live="polite"` for the client script to write into.
- No new required EJS local was introduced, so `src/views/recipeVisibility.test.js` and
  `src/views/recipeCreateMealPlan.test.js` — which render these templates with fixed locals objects —
  pass unmodified. The edit form's "Remove current photo" checkbox and `photo_url` conditionals are
  unchanged.

### `public/js/recipe-form.js`

- `MAX_PHOTO_SIZE = 4 * 1024 * 1024` with a comment pointing at the server constant, plus a derived
  `MAX_PHOTO_SIZE_LABEL` and `PHOTO_TOO_LARGE_MESSAGE` mirroring the server copy.
- On an oversize selection: clear the input so the file cannot be submitted, restore the preview to
  its load-time snapshot, and write the message into `#photoError`. A valid selection clears any
  previous message and previews as before.
- The REW-52 required-times block below it is untouched.

### Decisions and tradeoffs

| Decision | Rationale |
|----------|-----------|
| 4MB rather than something closer to 4.5MB | Matches the import path exactly, so there is one number to remember across both upload surfaces. The ~0.5MB of headroom covers multipart framing, field data, and headers, all of which count toward the platform's body measurement. Anything above ~4.3MB is not implementable on this deployment target. |
| The platform cap lives in `src/config/functionLimits.js` | That module already exists for exactly this class of "platform property mirrored in JS" constant (REW-93). The alternative was repeating the `4.5 * 1024 * 1024` literal in a third test file. |
| Copy derived from the byte constant, not hardcoded | The REW-43 pattern. A future limit change updates the message and the label automatically; only the view hints still hardcode "4MB" (see Known Limitations). |
| A Multer error handler was added, beyond the ticket's literal "limit + copy + test" | The stated user harm is "the user sees an opaque error rather than our error handling." Lowering the limit alone moves the generic 500 page from 5MB to 4MB rather than removing it. Called out as an explicit assumption in the plan. |
| Flash-and-redirect rather than JSON | These are HTML form posts, not the import path's fetch call. Same handler shape as `handleImportUploadError`, different response medium. |
| The error handler runs before route-level `csrfProtection` | It has to: the app-level `csrfProtectionExceptMultipart` skips multipart requests, so route-level CSRF runs after Multer because it needs the parsed `_csrf` field. The request is already past `requireAuth`, and the handler performs no state change — it flashes a fixed string and redirects to a path it derives itself. |
| `req.unpipe()` / `req.resume()` only on the answering branches | Multer aborts as soon as the limit trips, but the client may still be sending. Writing a response into a half-read request surfaces on some hosts as a connection reset instead of the flashed message. The delegating branch must not drain, or the global handler receives a consumed stream. |
| Client-side pre-check is UX only | It is trivially bypassed. The Multer limit is the control, and a test asserts the client constant equals the server constant so the two cannot drift. |
| The rate limiter was left alone | The ticket says so. Lowering the per-file cap incidentally lowers the worst case per IP from 50MB to 40MB per window — a free improvement, not a reason to touch the limiter. |

### Explicitly unchanged

`src/routes/importRoutes.js` and its 4MB constant, `src/utils/imageUtils.js` (`validateImageFile`,
`optimizeImage`, `generateThumbnail`), `src/middleware/csrfMiddleware.js`,
`src/middleware/authMiddleware.js`, `src/middleware/errorHandler.js`, `vercel.json`, `src/app.js`,
the `uploadLimiter` policy, the ownership filter on update (`.eq("user_id", req.user.id)`), and the
`fileFilter`'s mimetype behaviour.

---

## Database Changes

**None.** No migration, no schema change, no RLS change, no Supabase Storage policy change. Nothing
was added to `database/migrations/`, and `database/README.md` required no edit. This is an in-process
request-size limit; `recipes.photo_url` and `recipes.thumbnail_url` and every storage path are
unaffected.

---

## API Changes

`POST /recipes` and `POST /recipes/:id/update` keep the same fields, the same success behaviour, and
the same response medium (HTML redirect). What changed:

- The accepted `photo` size drops from 5MB to 4MB.
- A Multer rejection now produces a `302` back to the form with a flashed message, where it
  previously produced the generic HTML 500 page.

| Condition | Flashed message | Redirect |
|-----------|-----------------|----------|
| Photo larger than 4MB (`LIMIT_FILE_SIZE`) | `Photo must be under 4MB` | `/recipes/new`, or `/recipes/:id/edit` for a valid UUID, or `/recipes` |
| Any other `MulterError` | `Invalid upload. Please select a single photo and try again.` | same |
| Non-image mimetype (`UNSUPPORTED_FILE_TYPE`) | `Only image files are allowed. Please choose a JPEG, PNG, GIF, or WebP photo.` | same |
| Anything else | — | delegated to the global `errorHandler`, unchanged |

**Is this breaking?** For clients, no — these are browser form posts and no JSON contract exists. For
users, a 4MB–4.5MB photo that previously reached the app is now rejected; a 4.5MB–5MB photo was
already failing at the platform. Full reference: [Recipe Photo Upload](api/recipe-photo-upload.md).

---

## Configuration and Deployment

- **No new environment variables.**
- **No new dependencies.**
- **No migrations to run.**
- **No `vercel.json` change.** `maxDuration` stays at 10; this change touches request size, not
  duration.
- **No security middleware changes** beyond the new route-level error handler described above.

Both cap values are compile-time constants, not configuration. Changing either requires a code change
and a deploy — deliberate, so a limit that has to stay under a platform cap cannot be loosened by an
env var at runtime.

**Deployment note:** the 4.5MB platform cap is a property of Vercel Functions, not of this repo. If
the deployment target ever changes, or Vercel changes the cap, `VERCEL_MAX_REQUEST_BODY_BYTES` must
be updated by hand — the pinning test checks that the constant holds its value, but nothing can
detect a platform-side change.

---

## Testing

**Automated.** `npm test`: **452 tests, 450 pass, 2 fail.** Both failures are pre-existing and
unrelated to this change — `src/csrf.integration.test.js` binds hardcoded `/tmp/*.sock` Unix socket
paths, which Windows cannot bind (`EACCES`). The same two failed identically on the pre-change
baseline, and this change does not modify that file.

**One of those two failures matters here.** The case *"multipart CSRF validation runs after Multer
exposes the token"* covers the exact invariant this change relies on — that route-level
`csrfProtection` still sees the parsed `_csrf` field after Multer runs, with the new error handler
inserted between them. It could not be executed on this machine. **It still needs to be confirmed
green on a Linux CI runner before merge.**

New coverage added by this change:

- `src/routes/recipeImageUpload.test.js` — **new, 15 cases.** Constant values and the derived label;
  the live `imageUpload.limits.fileSize`; the strict sub-`VERCEL_MAX_REQUEST_BODY_BYTES` assertion;
  all error-handler branches including the valid-UUID redirect, the hostile-`:id` fallback, other
  Multer codes being answered rather than delegated, the `fileFilter` rejection, body draining before
  the redirect, the delegated error leaving the stream intact, and unrelated errors reaching `next`
  untouched; the middleware-order guard on both routes; and the unchanged 10-per-15-minutes limiter.
- `src/views/recipePhotoUpload.test.js` — **new, 10 cases.** Both templates render the
  server-derived "Maximum file size: 4MB" copy; no "5MB" string survives on these surfaces; the
  `aria-live` region is present on both; the edit form's existing photo affordances still render;
  the client `MAX_PHOTO_SIZE` equals the server constant; and the four client pre-check behaviours
  (clear input, no preview of an oversize file, drop a just-previewed file on the new form, preserve
  a saved photo on the edit form, clear the message on a valid file).
- `src/config/functionLimits.test.js` — extended with a case pinning
  `VERCEL_MAX_REQUEST_BODY_BYTES`.

**QA: not performed.** The QA stage was deliberately skipped on this run. Nothing in this release
note should be read as QA-verified.

---

## Known Limitations

1. **Manual and deployment verification is outstanding.** Three acceptance criteria can only be
   confirmed by a human, and two of them only against a real deployment:
   - A ~3.9MB photo still uploads, optimizes, thumbnails, and saves on both create and update. This
     is the regression that matters most — the fix is worthless if it clips legitimate uploads.
   - A >4MB photo submitted with JavaScript disabled lands on this app's flashed message, not the
     generic error template.
   - The platform `FUNCTION_PAYLOAD_TOO_LARGE` page no longer appears for photos in the old
     4.5MB–5MB band. The ticket's central claim is taken from Vercel's documentation, not from an
     observed production failure.
2. **Typed form content is lost on a server-side rejection.** The handler redirects rather than
   re-rendering, so a user who submits an oversize photo on the create form loses what they had
   typed. Re-rendering would require reading a multipart body Multer has already aborted. The
   client-side pre-check makes this rare but does not eliminate it.
3. **Hardcoded view copy.** `views/recipes/new.ejs` and `views/recipes/edit.ejs` hardcode the string
   "4MB" rather than rendering `MAX_RECIPE_IMAGE_SIZE_LABEL`. Tests catch the resulting drift, but
   the copy is not derived from the constant the way the server messages and the client script are.
   Same pre-existing pattern as the import views.
4. **Mimetype is not the real gate.** `fileFilter` checks the client-supplied mimetype as a
   convenience; `validateImageFile`'s magic-byte sniff is the actual check and is unchanged.

---

## Related Tickets

- **[REW-43](https://wanderingnerds.atlassian.net/browse/REW-43)** (Done) — established the
  4MB-under-4.5MB pattern on the import path that this ticket mirrors onto the photo path. REW-94
  was filed as a deliberate follow-up during that work.
- **[REW-93](https://wanderingnerds.atlassian.net/browse/REW-93)** — introduced
  `src/config/functionLimits.js`, the home for platform-limit constants that
  `VERCEL_MAX_REQUEST_BODY_BYTES` was added to.
- **[REW-96](https://wanderingnerds.atlassian.net/browse/REW-96)** — no decoded-pixel cap on the
  recipe photo path: `generateThumbnail()` and `optimizeImage()` in `src/utils/imageUtils.js` call
  `sharp(imageBuffer)` with no `limitInputPixels`. Same route, different risk. **Still open and
  deliberately out of scope** — an encoded-byte cap of any size does not bound how large an image
  decompresses, so lowering the photo limit does not address it.

---

## Documentation

- `docs/api/recipe-photo-upload.md` — **new.** Full reference for the photo upload path: limits, the
  4MB-under-4.5MB reasoning, the middleware chain and why CSRF runs last, the error contract and
  redirect targets, the client-side pre-check, user-facing copy, unverified items, and known
  limitations.
- `docs/api/README.md` — `POST /recipes` and `POST /recipes/:id/update` rows now state the photo cap
  and upload rate limit; a new paragraph describes the multipart chain and points at the reference
  page; the upload-size-caps section notes both caps are pinned below
  `VERCEL_MAX_REQUEST_BODY_BYTES`; the detailed-docs list gained the new page.
- `docs/api/recipe-import-limits.md` — the "Why 4MB and not more" section records that REW-94 applied
  the same reasoning to the photo path and moved the platform number into a shared constant;
  cross-reference added.
- `README.md` — new Recipe Management bullet for the photo limit; two new Security bullets covering
  the platform-cap pinning and the photo-route error handler / middleware order.
- `docs/RELEASE_NOTES_REW-95.md` — one dated annotation on the REW-96 follow-up note, which described
  the photo path as "behind a 5MB Multer cap". Left as a point-in-time record rather than rewritten.
- `database/README.md` — **no change; none required.** This ticket touches no persistence.
- `docs/RELEASE_NOTES_REW-94.md` — this file.
- Confluence: a new release notes page plus the existing bug-fix plan page, updated to as-shipped
  state.
