# REW-94: Recipe photo upload limit exceeds Vercel's request-body cap

## Jira issue

[REW-94 — Recipe image upload limit (5MB) exceeds Vercel's 4.5MB request-body cap](https://wanderingnerds.atlassian.net/browse/REW-94)
— Task, Priority Medium, Status **To Do**, label `QA-findings`, reported/assigned Andrew Carroll.

Related:

- [REW-43 — Increase recipe import limit](https://wanderingnerds.atlassian.net/browse/REW-43) (Done)
  — established the 4MB-under-4.5MB pattern on the *import* path that this ticket mirrors onto the
  *photo* path. REW-94 was filed as a deliberate follow-up during that work.
- [REW-93 — OCR timeout vs Vercel maxDuration](https://wanderingnerds.atlassian.net/browse/REW-93)
  — introduced `src/config/functionLimits.js`, the existing home for "platform limit" constants.
- [REW-96 — no decoded-pixel cap on the recipe photo upload path](https://wanderingnerds.atlassian.net/browse/REW-96)
  — same route, different risk (decompression bombs). **Out of scope here.** Encoded-byte caps and
  decoded-pixel caps are independent; do not fold REW-96 into this change.

## Confluence page

[REW-94: Recipe Photo Upload Limit vs Vercel Request-Body Cap - Bug Fix Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/31096833/REW-94+Recipe+Photo+Upload+Limit+vs+Vercel+Request-Body+Cap+-+Bug+Fix+Plan)

## Summary

`src/routes/recipeRoutes.js` configures its Multer instance with `fileSize: 5 * 1024 * 1024`, but
Vercel Functions reject any request body over 4.5MB with a platform-level `FUNCTION_PAYLOAD_TOO_LARGE`
413 *before* application code runs. Photo uploads in the ~4.5–5MB band therefore can never succeed in
production: the advertised limit is unreachable, and the user sees an opaque Vercel error page instead
of this app's error handling. This change lowers the recipe photo cap to 4MB using the same named-constant
style REW-43 used for imports, surfaces the limit in the recipe form views (which currently state no
size at all), converts Multer rejections on the photo routes into a flash-and-redirect instead of the
generic HTML 500 page, and pins the limit below the platform cap with tests so it cannot drift back.

## Open questions / assumptions

1. **Scope of the error-handling fix.** The ticket's literal suggested fix is "limit + copy + test."
   But the stated user harm is "the user sees an opaque error rather than our error handling," and
   today a `LIMIT_FILE_SIZE` (or non-image `fileFilter`) rejection on `POST /recipes` falls through to
   `errorHandler` in `src/middleware/errorHandler.js`, which renders a generic 500 "Something went
   wrong" page and discards everything the user typed into the form. **Assumption: a Multer error
   handler on these two routes is in scope**, mirroring `handleImportUploadError` in shape but
   redirecting with a flash (HTML form context) rather than returning JSON. If the user wants the
   narrowest possible diff, drop Task 4 and the criteria that depend on it — but then a 4.1MB upload
   still produces a 500 page, just at a lower threshold.
2. **Client-side pre-check.** `public/js/import.js` blocks oversize files before upload; the photo
   path has no equivalent, so a user on a slow connection waits for a full 4MB round trip to be told
   no. **Assumption: mirror the import client's pre-check.** It is UX only — the server limit stays
   authoritative and the pre-check must never be the sole enforcement.
3. **4MB vs a value closer to the cap.** **Assumption: 4MB**, exactly as the ticket asks and matching
   imports, so there is one number to remember. The ~0.5MB of headroom covers multipart framing,
   field data, and headers, all of which count toward the platform's body measurement.
4. **View copy wording.** **Assumption:** reuse the import page's phrasing, "Maximum file size: 4MB",
   so the two upload surfaces read identically.
5. **Where the 4.5MB platform number lives.** **Assumption:** add it as a named constant to
   `src/config/functionLimits.js` (which already exists for exactly this class of platform mirror)
   rather than repeating the `4.5 * 1024 * 1024` literal a third time. See Task 1.
6. **Not asked, not assumed:** no change to the 10-uploads-per-15-minutes limiter (the ticket says
   leave it), no change to `validateImageFile` / `optimizeImage` / `generateThumbnail`, no decoded-pixel
   cap (REW-96), no change to the import path's 4MB constant.

## Tasks

Ordered so each step leaves the suite green.

1. **Add the platform request-body cap as a shared constant.** In `src/config/functionLimits.js`, add
   an exported `VERCEL_MAX_REQUEST_BODY_BYTES` alongside the existing duration constants, derived from
   `4.5 * 1024 * 1024` and commented with the same reasoning style as the neighbours: what the platform
   does, why it is mirrored in JS rather than read at runtime, and a link to the
   `FUNCTION_PAYLOAD_TOO_LARGE` docs. Do not touch the duration constants. Add a case to
   `src/config/functionLimits.test.js` pinning the value and asserting it is a positive number.
2. **Introduce the photo-size constants in `src/routes/recipeRoutes.js`.** Mirror `importRoutes.js`
   exactly: an exported byte constant (suggested `MAX_RECIPE_IMAGE_SIZE_BYTES = 4 * 1024 * 1024`) with
   a comment stating it sits deliberately below the platform cap, plus an exported label derived from
   it (`MAX_RECIPE_IMAGE_SIZE_LABEL`) so copy cannot go stale, plus an exported message constant built
   from the label (suggested text: `Photo must be under 4MB`) and a message for non-image / malformed
   uploads. Replace the `5 * 1024 * 1024` literal and the now-wrong `// 5MB limit` comment with the
   constant.
3. **Rename and export the Multer instance and the limiter.** The local `const upload` is referenced
   only on lines 426 and 761. Rename it to `imageUpload` (the name the ticket and all the docs already
   use) and export it, and export the existing `uploadLimiter`, so the new tests can assert against the
   real objects the router uses rather than a copy. Change the `fileFilter`'s generic `new Error(...)`
   to carry a `code` the way `importRoutes.js` does, so the error handler in Task 4 can distinguish it.
   **Do not change the filter's behaviour** — it must keep rejecting anything whose mimetype does not
   start with `image/`, and `validateImageFile`'s magic-byte check must stay the real gate.
4. **Add a Multer error handler for the two photo routes.** Mirror `handleImportUploadError`, exported
   for tests, but HTML-shaped: on `LIMIT_FILE_SIZE` flash the too-large message; on any other
   `MulterError` flash the invalid-upload message; on the `fileFilter` rejection flash the not-an-image
   message; delegate everything else untouched via `next(err)`. Redirect target is derived from the
   request: back to `/recipes/new` when there is no `:id`, back to that recipe's edit page when there
   is. **Validate `req.params.id` against the module's existing `UUID_PATTERN` before putting it in a
   redirect**, falling back to `/recipes` when it does not match, so a hostile `:id` can never shape
   the `Location` header. Register the handler on both routes *between* `imageUpload.single("photo")`
   and `csrfProtection`, exactly where the import route registers its equivalent. Do not reorder any
   other middleware (see Security considerations).
5. **Add the size copy to the recipe form views.** In `views/recipes/new.ejs` and
   `views/recipes/edit.ejs`, add a muted hint line under the photo picker reading `Maximum file size: 4MB`,
   styled like the equivalent line in `views/recipes/import.ejs`. Also add a small, initially-hidden,
   `aria-live="polite"` error element near the photo input for Task 6 to write into. Keep the new
   markup free of any new required EJS local — `src/views/recipeVisibility.test.js` and
   `src/views/recipeCreateMealPlan.test.js` render these templates with a fixed locals object and will
   throw if a new undefined local is referenced.
6. **Add the client-side pre-check to `public/js/recipe-form.js`.** In the existing photo-preview
   `DOMContentLoaded` block, declare a `MAX_PHOTO_SIZE` constant (same `4 * 1024 * 1024` expression
   `public/js/import.js` uses, with the comment pointing at the server constant), plus a derived label
   and message. On `change`, if the selected file exceeds it: clear the input value so the oversize
   file cannot be submitted, leave the preview in its empty state, and show the message in the
   `aria-live` element from Task 5. Otherwise clear any previous message and preview as today. Do not
   alter the REW-52 required-times block below it.
7. **Write the tests.** New `src/routes/recipeImageUpload.test.js` (co-located, Node test runner) and
   new `src/views/recipePhotoUpload.test.js`, plus the `functionLimits.test.js` case from Task 1. See
   "Acceptance criteria" for what each must assert. Model the route test's structure on
   `src/routes/importRoutes.test.js` — in particular its `responseRecorder` helper and its
   `router.stack` / `names.indexOf("multerMiddleware")` middleware-order guard — and the view test on
   `src/views/importRecipe.test.js`, including its `vm.runInNewContext` trick for extracting the client
   constant from the script source and comparing it to the server constant.
8. **Correct the two stale "still broken" doc claims.** `docs/api/README.md` and
   `docs/api/recipe-import-limits.md` both currently assert in prose that recipe photo uploads are
   configured at 5MB and cannot work in production, "tracked as REW-94". Once this ships those
   sentences are false, so update them in the same change. Anything beyond correcting those two claims
   (a proper photo-upload reference page, release notes, Confluence as-shipped write-up) belongs to the
   Documentation agent.
9. **Run `npm test`.** Expect the pre-existing `src/csrf.integration.test.js` Windows `/tmp` socket
   `EACCES` failures — confirm they fail identically on `main` before attributing anything to this
   change.

## Affected files

- `src/config/functionLimits.js` — new exported `VERCEL_MAX_REQUEST_BODY_BYTES` constant with rationale
  comment. Existing duration constants untouched.
- `src/config/functionLimits.test.js` — one new case pinning the new constant.
- `src/routes/recipeRoutes.js` — the core change. New size/label/message constants; `5 * 1024 * 1024`
  literal and its stale comment removed; `upload` renamed to `imageUpload` and exported; `uploadLimiter`
  exported; `fileFilter` error given a `code`; new exported Multer error handler; handler registered on
  the `POST /` (line ~426) and `POST /:id/update` (line ~761) chains between Multer and `csrfProtection`.
  The rate limiter's 10-per-15-minutes policy is **unchanged**.
- `src/routes/recipeImageUpload.test.js` — **new.** Route-level unit tests: constant values, the Multer
  instance's actual `limits.fileSize`, the sub-4.5MB assertion, error-handler branches including the
  redirect-target and UUID-validation behaviour, and the middleware-order guard for both routes.
- `views/recipes/new.ejs` — size hint under the photo picker; hidden `aria-live` photo error element.
- `views/recipes/edit.ejs` — same two additions; the existing "Remove current photo" checkbox and
  `photo_url` conditionals must keep working unchanged.
- `public/js/recipe-form.js` — `MAX_PHOTO_SIZE` + derived label/message; oversize pre-check that clears
  the input and writes the message; existing preview and REW-52 validation behaviour preserved.
- `src/views/recipePhotoUpload.test.js` — **new.** Renders both templates and asserts the copy matches
  the server-derived label, that no "5MB" string survives anywhere on these surfaces, and that the
  client constant equals the server constant.
- `docs/api/README.md` — the "Upload size caps" paragraph (~lines 245–250) claiming photo uploads are
  at 5MB and "cannot fully work in production; tracked as REW-94".
- `docs/api/recipe-import-limits.md` — the known-limitation bullet (~lines 180–181) making the same
  claim.
- `src/views/recipeVisibility.test.js`, `src/views/recipeCreateMealPlan.test.js` — **no edits expected**,
  but they render `new.ejs`/`edit.ejs` directly and are the regression canaries for Task 5. If either
  breaks, the view change introduced a local it should not have.

**Explicitly not touched:** `src/routes/importRoutes.js` and its 4MB constant, `src/utils/imageUtils.js`,
`src/middleware/csrfMiddleware.js`, `src/middleware/authMiddleware.js`, `src/middleware/errorHandler.js`,
`vercel.json`, `src/app.js`.

## Database changes

**None.** No migration, no schema change, no RLS change, no Supabase Storage policy change. This is an
in-process request-size limit; `recipes.photo_url` / `recipes.thumbnail_url` and every storage path are
unaffected. If the Developer finds themselves writing SQL for this ticket, stop — it is out of scope.

## Security considerations

- **Middleware order is a hard boundary.** Both routes are `requireAuth → uploadLimiter →
  imageUpload.single("photo") → [new error handler] → csrfProtection`. The app-level
  `csrfProtectionExceptMultipart` deliberately skips multipart requests, so route-level `csrfProtection`
  runs *after* Multer because it needs the parsed `_csrf` body field. Nothing may be reordered, removed,
  or made conditional. The new test's order guard exists to enforce this.
- **The error handler answers before CSRF validation.** This is intentional and matches the import path:
  the request is already past `requireAuth`, and the handler performs no state change — it only flashes
  and redirects. Reviewer should confirm the handler never touches Supabase, never writes a record, and
  never echoes attacker-controlled input into the response body.
- **Redirect target must be validated.** `req.params.id` flows into the `Location` header on the update
  route. Gate it on the existing `UUID_PATTERN` and fall back to a fixed path; do not interpolate raw
  input.
- **Lowering a limit cannot weaken anything, but the surrounding checks must survive it.** The
  `fileFilter` mimetype check, `validateImageFile`'s magic-byte sniff, and `requireAuth` ownership
  filtering (`.eq("user_id", req.user.id)` on update) must be byte-identical after this change. Note
  that mimetype is client-supplied and is *not* the real gate — `validateImageFile` is.
- **The 10-uploads-per-15-minutes limiter stays exactly as-is** per the ticket. Lowering the per-file
  cap incidentally lowers the worst case per IP from 50MB to 40MB per window, which is a free
  improvement, not a reason to touch the limiter.
- **The client-side pre-check is UX, never enforcement.** It is trivially bypassed; the Multer limit is
  the control. A reviewer should confirm the server rejects an oversize upload even with the script
  disabled.
- **Do not raise the cap "to be safe".** Anything at or above 4.5MB re-creates the exact defect this
  ticket fixes; that is what the sub-cap assertion test defends.

## Acceptance criteria

- [ ] `src/config/functionLimits.js` exports `VERCEL_MAX_REQUEST_BODY_BYTES` equal to `4.5 * 1024 * 1024`
      (4,718,592), and `src/config/functionLimits.test.js` pins it. `VERCEL_MAX_DURATION_SECONDS`,
      `VERCEL_MAX_DURATION_MS`, `FUNCTION_RESERVE_MS`, and `OCR_TIMEOUT_MS` are unchanged.
- [ ] `src/routes/recipeRoutes.js` exports a photo-size byte constant equal to `4 * 1024 * 1024`
      (4,194,304), and a label constant derived from it that renders as `4MB`. No `5 * 1024 * 1024`
      literal and no `5MB` string remains anywhere in the file.
- [ ] A test asserts the exported Multer instance's live `limits.fileSize` equals that constant — read
      off the actual `imageUpload` object the router uses, not a re-declared copy.
- [ ] A test asserts the photo limit is **strictly less than** `VERCEL_MAX_REQUEST_BODY_BYTES`, with a
      message naming `FUNCTION_PAYLOAD_TOO_LARGE`. Temporarily setting the limit to `5 * 1024 * 1024`
      makes this test fail (verify by hand, revert).
- [ ] Given a `MulterError` with code `LIMIT_FILE_SIZE` and no `:id` param, the exported error handler
      flashes the too-large message, redirects to `/recipes/new`, and does **not** call `next`.
- [ ] Given the same error with a valid UUID `:id`, it redirects to that recipe's edit page; given a
      non-UUID `:id` (e.g. `../../evil`, `%0d%0aSet-Cookie:+x`), it redirects to a fixed safe path and
      never reflects the raw value.
- [ ] Given any other `MulterError` code (`LIMIT_UNEXPECTED_FILE`, `LIMIT_PART_COUNT`, `LIMIT_FIELD_VALUE`),
      the handler answers with its own flash-and-redirect rather than delegating.
- [ ] Given the `fileFilter` rejection, the handler flashes the not-an-image message and redirects.
- [ ] Given an unrelated error (e.g. `new Error("database unavailable")`), the handler calls `next(err)`
      with that exact error and sends no response itself.
- [ ] A middleware-order test asserts that on **both** `POST /recipes` and `POST /recipes/:id/update`,
      the chain order is `requireAuth` → `uploadLimiter` → Multer → the new error handler →
      `csrfProtection`, with all five present.
- [ ] The upload rate limiter is still 10 requests per 15-minute window on both routes — verified by
      diff inspection; no change expected.
- [ ] Rendering `views/recipes/new.ejs` and `views/recipes/edit.ejs` each produces text matching
      `Maximum file size: 4MB`, and the rendered HTML of both contains no `5MB` / `5 MB` string.
- [ ] Both templates still render successfully with the exact locals objects used by the existing
      `src/views/recipeVisibility.test.js` and `src/views/recipeCreateMealPlan.test.js` cases — i.e.
      those suites pass unmodified.
- [ ] `public/js/recipe-form.js` declares a photo-size constant whose evaluated value equals the server
      constant, asserted by a test that extracts it from the file source (as
      `src/views/importRecipe.test.js` does for `public/js/import.js`).
- [ ] Selecting a file larger than the limit in the browser shows the size message, leaves the preview
      empty, and clears the file input so submitting the form sends no photo. Selecting a valid file
      previews as before and shows no message. (Manual, QA.)
- [ ] Submitting a >4MB photo with the client script disabled produces this app's flashed message on the
      form page — not the generic error template and not a Vercel error page. (Manual, QA; the
      platform-page half of this claim can only be confirmed on a deployment.)
- [ ] A ~3.9MB photo still uploads, optimizes, thumbnails, and saves successfully on both create and
      update. (Manual, QA — this is the regression that matters most; the fix is worthless if it clips
      legitimate uploads.)
- [ ] `docs/api/README.md` and `docs/api/recipe-import-limits.md` no longer claim the photo path is at
      5MB or that REW-94 is outstanding.
- [ ] `npm test` passes, except the pre-existing `src/csrf.integration.test.js` Windows socket failures,
      which must be confirmed to fail identically on `main`.

## Notes for the Developer

- The ticket calls the Multer instance `imageUpload`; the code currently calls it `upload`. Task 3's
  rename closes that gap — the docs already use the ticket's name.
- REW-94 already exists and is in **To Do**; no new ticket is needed for this work. If the Multer error
  handler (Task 4) or the client pre-check (Task 6) is dropped as out of scope, file a follow-up rather
  than leaving the 500-page behaviour undocumented.
