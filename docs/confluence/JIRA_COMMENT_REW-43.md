# Jira Comment for REW-43

## Implementation and documentation complete; QA was not run — leaving this In Progress

All three import ceilings are raised and every rejection from `POST /recipes/import/parse` now returns JSON:

- Import rate limit **5 → 25 per 15 minutes per IP** (window unchanged at 15 minutes, keying still per IP, limiter still applied to `/recipes/import/parse` in the same chain position).
- Per-file upload size **2MB → 4MB**, deliberately under Vercel's hard 4.5MB request-body cap so oversize uploads produce our JSON `413` instead of an opaque platform error page.
- Production-only global limiter **100 → 300 requests per 15 minutes per IP**, because one import costs ~3 requests and the global limiter would otherwise re-throttle users before the raised import limit helped. Still inside the `NODE_ENV === 'production'` guard.

Error contract: `429` → `{"error": "Too many import attempts. Please try again in 15 minutes."}`, `413` → `{"error": "File must be under 4MB"}`, other Multer errors → `400` `{"error": "Invalid upload. Please select a single recipe file."}`, unsupported type → `400`. Non-Multer errors are still delegated to the global error handler. The import client no longer surfaces a raw JSON `SyntaxError` on non-JSON responses, and 401/403 now prompt a refresh instead of reporting a parse failure.

**Review:** Approved, no blocking issues.

**Automated validation:** `npm test` — **339 tests, 337 passing, 2 failing.** The suite is not fully green. The 2 failures are pre-existing, environmental, and unrelated to this change: `src/csrf.integration.test.js` fails on Windows with `listen EACCES` because it binds `/tmp/*.sock` Unix-domain sockets and its skip guard only handles `EPERM`. The reviewer confirmed both fail identically on `main`.

**Automated QA was not run in this pipeline, and the acceptance criteria have not been verified.** Nothing here has been exercised in a browser or against a deployed environment. Specifically unverified: a real >4MB upload returning the JSON 413 in the UI; a real 26th import in a window showing the 429; a ~3.5MB file that previously failed the size gate now reaching parsing; a large multi-page PDF still saving through `/recipes/import/save` (the default 100kb `express.json()` limit is a live risk); and OCR of a ~4MB photo against `vercel.json`'s 10-second `maxDuration`. This ticket still needs QA sign-off and has deliberately been left **In Progress**.

**Documentation:**
- [Release: REW-43 - Increase Recipe Import Limit](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30605313/Release+REW-43+-+Increase+Recipe+Import+Limit) — as-shipped write-up
- [REW-43: Increase Recipe Import Limit - Enhancement Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30539777/REW-43+Increase+Recipe+Import+Limit+-+Enhancement+Plan) — updated with the as-shipped outcome and acceptance-criteria status
- Repo: `docs/api/recipe-import-limits.md` (new), `docs/api/README.md`, `README.md`, `docs/RELEASE_NOTES_REW-43.md`

**Follow-ups filed during this work:** REW-93 (`OCR_TIMEOUT_MS` exceeds Vercel `maxDuration`), REW-94 (5MB `imageUpload` exceeds the 4.5MB platform cap), REW-95 (no decoded-pixel cap on the OCR path — REW-43 raises the worst-case decode budget ~10x).

No database migration, backfill, dependency, environment variable, or `vercel.json` change is required.
