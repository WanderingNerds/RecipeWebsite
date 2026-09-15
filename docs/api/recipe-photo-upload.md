# Recipe Photo Upload — Limits and Error Contract (REW-94)

How `POST /recipes` and `POST /recipes/:id/update` accept a recipe photo, what they reject, and
what the user sees when a rejection happens.

> **Branch status.** Implemented and code-reviewed on `REW-94-recipe-image-upload-limit-vercel-cap`.
> **The QA stage was deliberately skipped on this run**, so nothing here is QA-verified, and the
> change is not committed or merged. Treat the manual items under
> [Not yet verified](#not-yet-verified) as open.

Companion to [Recipe Import Limits & Error Contract](recipe-import-limits.md), which documents the
same class of controls on the *import* path. The two paths share the numbers deliberately but not
the response shape: imports answer with JSON, photo uploads answer with a flash message and a
redirect, because they are ordinary HTML form posts.

## The endpoints

| Method | Endpoint | Photo field | Purpose |
|--------|----------|-------------|---------|
| POST | `/recipes` | `photo` (optional, single file) | Create a recipe |
| POST | `/recipes/:id/update` | `photo` (optional, single file) | Update a recipe the caller owns |

Both are `multipart/form-data`, both require an authenticated session, and both accept the photo as
one optional file alongside the ordinary recipe fields. Neither returns JSON.

## Limits

| Limit | Value | Where it lives |
|-------|-------|----------------|
| Photo size | **4MB** (`4,194,304` bytes) | `MAX_RECIPE_IMAGE_SIZE_BYTES` in `src/routes/recipeRoutes.js` |
| Displayed label | `4MB` (derived) | `MAX_RECIPE_IMAGE_SIZE_LABEL`, computed from the byte constant |
| Files per request | 1 (`imageUpload.single("photo")`) | `src/routes/recipeRoutes.js` |
| Upload rate | **10 uploads per 15 minutes per IP** | `uploadLimiter` — unchanged by REW-94 |
| Platform request-body cap | **4.5MB** (`4,718,592` bytes) | `VERCEL_MAX_REQUEST_BODY_BYTES` in `src/config/functionLimits.js` |

### Why 4MB and not 5MB

Vercel Functions reject any request body over **4.5MB** with a platform-level
[`FUNCTION_PAYLOAD_TOO_LARGE`](https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE) 413
*before the function is invoked*. The previous 5MB Multer limit therefore advertised a band
(~4.5MB–5MB) that could never succeed in production: the app would have accepted the file, but the
platform answered first with an opaque error page that no application error handler can intercept.

4MB sits below the cap with roughly 0.5MB of headroom, which covers multipart framing, the other
form fields, and headers — all of which count toward the platform's measurement of the body. It also
matches `MAX_IMPORT_FILE_SIZE_BYTES` on the import path, so there is one number to remember across
both upload surfaces.

`src/routes/recipeImageUpload.test.js` asserts `MAX_RECIPE_IMAGE_SIZE_BYTES <
VERCEL_MAX_REQUEST_BODY_BYTES` with a message naming `FUNCTION_PAYLOAD_TOO_LARGE`, so the limit
cannot drift back above the cap without failing the suite. Anything at or above ~4.3MB is not
implementable on this deployment target.

## Middleware chain

Both routes run, in order:

1. `requireAuth`
2. `uploadLimiter` (`express-rate-limit`, 10 per 15 minutes per IP)
3. `imageUpload.single("photo")` (Multer, memory storage, `image/*` mimetype filter, 4MB cap)
4. `handleRecipeImageUploadError` (**new in REW-94**)
5. `csrfProtection`
6. The route handler (`handleRecipeCreate` / `handleRecipeUpdate`)

A regression test asserts this exact order on both routes, with all five middlewares present.

**Why CSRF runs last.** The app-level `csrfProtectionExceptMultipart` deliberately skips multipart
requests, so route-level `csrfProtection` has to run *after* Multer — it needs the parsed `_csrf`
body field, which does not exist until the multipart body is read. Nothing in this chain may be
reordered, removed, or made conditional.

**Why the upload error handler runs before CSRF.** Same reasoning as `handleImportUploadError` on
the import path. The request is already past `requireAuth`; the handler performs no state change,
touches no database, and echoes no caller-supplied input — it flashes a fixed string and redirects
to a path it derives itself.

## Error contract

`handleRecipeImageUploadError` (exported from `src/routes/recipeRoutes.js`) converts Multer
rejections into a flash message plus a redirect back to the form. Before REW-94 these fell through
to the global `errorHandler`, which rendered a generic 500 "Something went wrong" page.

| Condition | Flashed message | Redirect |
|-----------|-----------------|----------|
| File larger than 4MB (`LIMIT_FILE_SIZE`) | `Photo must be under 4MB` | back to the form |
| Any other `MulterError` (`LIMIT_UNEXPECTED_FILE`, `LIMIT_PART_COUNT`, `LIMIT_FIELD_VALUE`, …) | `Invalid upload. Please select a single photo and try again.` | back to the form |
| Non-image mimetype (`fileFilter`, `UNSUPPORTED_FILE_TYPE`) | `Only image files are allowed. Please choose a JPEG, PNG, GIF, or WebP photo.` | back to the form |
| Anything else | — | delegated untouched via `next(err)` to the global `errorHandler` |

All three messages are constants exported from the route module, and the size message is built from
`MAX_RECIPE_IMAGE_SIZE_LABEL`, so changing the byte limit changes the copy automatically.

### Redirect targets

| Request | Redirect |
|---------|----------|
| `POST /recipes` (no `:id`) | `/recipes/new` |
| `POST /recipes/:id/update` with a valid UUID `:id` | `/recipes/:id/edit` |
| `POST /recipes/:id/update` with a non-UUID `:id` | `/recipes` |

`req.params.id` is validated against the route module's existing `UUID_PATTERN` before it can reach
the `Location` header, with a fixed fallback. A hostile `:id` (path traversal, CRLF injection) is
never reflected. Tests cover both the valid and hostile cases.

### Draining the request body

On the branches that answer the request, the handler calls `req.unpipe()` and `req.resume()` before
redirecting. Multer aborts as soon as the file limit trips, but the client may still be sending the
rest of the body; writing a response into a half-read request surfaces on some hosts as a connection
reset rather than the flashed message. The delegating branch does **not** drain, so the global error
handler still receives the stream intact.

## Client-side pre-check (`public/js/recipe-form.js`)

- `MAX_PHOTO_SIZE` is `4 * 1024 * 1024` and must stay at or below the server constant. A test parses
  the client source and compares the evaluated value with the exported server value, so the two
  cannot drift.
- `MAX_PHOTO_SIZE_LABEL` and `PHOTO_TOO_LARGE_MESSAGE` derive the displayed copy from that constant
  and mirror `RECIPE_IMAGE_TOO_LARGE_MESSAGE` on the server.
- On an oversize selection the script clears the file input (so the file cannot be submitted),
  restores the preview to its **load-time** state, and writes the message into `#photoError`.
  Restoring rather than blanking is what keeps an already-saved photo visible on the edit form while
  still dropping a file the user had just previewed.
- A valid selection clears any previous message and previews as before.

**This is UX, never enforcement.** It is trivially bypassed; the Multer limit is the control. The
server must still reject an oversize upload with the script disabled.

## User-facing copy

Both `views/recipes/new.ejs` and `views/recipes/edit.ejs` show a muted hint under the photo picker
reading **"Maximum file size: 4MB"** — matching the wording on `views/recipes/import.ejs` so the two
upload surfaces read identically. Before REW-94 neither form stated a size at all.

Each form also carries a `#photoError` element with `aria-live="polite"`, hidden until the client
pre-check writes into it, so a screen reader announces the rejection without moving focus.

Flashed server messages render through the existing global `error` local set in `src/app.js`.

## Related constants

`src/config/functionLimits.js` is the home for platform-mirrored limits. REW-94 added
`VERCEL_MAX_REQUEST_BODY_BYTES` beside REW-93's duration constants:

| Constant | Value | Meaning |
|----------|-------|---------|
| `VERCEL_MAX_REQUEST_BODY_BYTES` | `4.5 * 1024 * 1024` (4,718,592) | Vercel's hard request-body cap. Every upload limit in the codebase must sit strictly below it. |
| `VERCEL_MAX_DURATION_SECONDS` | `10` | Mirrors `vercel.json` → `functions["server.js"].maxDuration` (REW-93). |
| `OCR_TIMEOUT_MS` | `8000` (derived) | The OCR budget on the import path (REW-93). |

The body cap is mirrored in JS for the same reason as the duration constants: it is a platform
property, not something readable at runtime. The only defence against drift is the pinning test in
`src/config/functionLimits.test.js` plus per-route tests asserting each upload limit stays under it.

## Not yet verified

QA was skipped on this run. The following need a human, and the deployment items can only be
confirmed against a real Vercel deployment:

- A ~3.9MB photo still uploads, optimizes, thumbnails, and saves on both create and update. This is
  the regression that matters most — the fix is worthless if it clips legitimate uploads.
- A >4MB photo submitted with JavaScript disabled lands on the flashed message on the form page,
  not the generic error template.
- The platform's `FUNCTION_PAYLOAD_TOO_LARGE` page no longer appears for photos in the old
  4.5MB–5MB band. The ticket's central claim is taken from Vercel's documentation, not from an
  observed production failure.
- Selecting an oversize file in a real browser shows the message, leaves the preview in its
  load-time state, and clears the input.

## Known limitations

- **Typed form content is lost on a Multer rejection.** The handler redirects rather than
  re-rendering, so a user who picks an oversize photo on the create form loses what they had typed.
  The client-side pre-check makes this rare in practice (the file never leaves the browser), but it
  is still reachable with JavaScript disabled. Re-rendering the form with the submitted values would
  require reading a multipart body that Multer has already aborted, which is why it was not done
  here.
- **No decoded-pixel cap on the photo path.** The 4MB limit bounds *encoded* bytes and says nothing
  about how large an image decompresses. `generateThumbnail()` and `optimizeImage()` in
  `src/utils/imageUtils.js` call `sharp(imageBuffer)` with no `limitInputPixels`. Tracked as
  **REW-96**; deliberately out of scope for REW-94, since encoded-byte and decoded-pixel caps are
  independent controls.
- **Mimetype is not the real gate.** `fileFilter` checks the client-supplied mimetype as a
  convenience only. `validateImageFile`'s magic-byte sniff in the route handlers is the actual
  check, and it is unchanged by REW-94.
- **Rate limit is keyed by IP, not by user.** Users behind a shared NAT share the
  10-uploads-per-15-minutes budget. Unchanged by REW-94.

## Related documentation

- [API Overview](README.md) — endpoint tables, the rate-limit table, and the upload size caps
- [Recipe Import Limits & Error Contract](recipe-import-limits.md) — the same controls on the import
  path, including the JSON error contract this page's flash-and-redirect mirrors
- [REW-94 plan](../plans/rew-94-recipe-image-upload-limit.md)
- [Release notes: REW-94](../RELEASE_NOTES_REW-94.md)
- [Release notes: REW-43](../RELEASE_NOTES_REW-43.md) — where the 4MB-under-4.5MB pattern came from
- [Release notes: REW-93](../RELEASE_NOTES_REW-93.md) — `src/config/functionLimits.js` and the
  duration constants
