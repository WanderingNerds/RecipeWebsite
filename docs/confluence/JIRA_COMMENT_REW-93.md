# Jira Comment for REW-93

*Posted to the REW-93 Jira issue after documentation review:*

---

## Documentation Complete — Reviewer-Approved, Not Merged, QA Skipped

The OCR timeout is now derived from the Vercel function deadline, the change is code-reviewed
(approved over two rounds, no blocking issues), and it is documented. Two caveats before anyone
reads this as finished: **the QA stage was excluded from this pipeline run by operator instruction**,
and **the branch is not merged** (`REW-93-ocr-timeout-vercel-maxduration`, uncommitted working tree).
Leaving this issue **In Progress** deliberately.

**What changed:**
- New `src/config/functionLimits.js` as the single source of truth: `VERCEL_MAX_DURATION_SECONDS = 10`
  (mirrors `vercel.json`), derived `VERCEL_MAX_DURATION_MS = 10000`, `FUNCTION_RESERVE_MS = 2000`,
  derived `OCR_TIMEOUT_MS = 8000`. `vercel.json` is deliberately not read at runtime — it is build
  config and is not guaranteed to be in the deployed function bundle — so a dev-time test reads it
  from disk instead and fails if the two values drift apart.
- `src/utils/recipeImporter.js`: the `30000` literal is gone. `parseImage` now takes
  `{ timeoutMs, createWorkerImpl }` and uses an explicit `createWorker` → `recognize` → `terminate`
  lifecycle, with `clearTimeout` and worker termination in a `finally` on every path — including a
  deferred cleanup for the cold-start case where the timeout fires before the worker finishes
  starting. Termination and startup failures are logged distinctly server-side and never replace the
  user-facing error.
- `public/js/import.js`: new 502/503/504 branch showing "The import took too long. Try a smaller
  file." Format-neutral copy, because the untimed PDF path (REW-97) is the likeliest way to reach it.
- The timeout message text and its HTTP 400 status are unchanged. The `"timed out"` substring is
  load-bearing — callers branch on it.
- `vercel.json`, `src/routes/importRoutes.js`, and all security middleware are unchanged (verified,
  not edited). No database migration.

**User-facing behaviour change worth flagging:** some image imports that previously failed opaquely
at the 10-second platform deadline will now fail clearly at 8 seconds. That is the intended
trade-off, but it is a real change, not just an internal cleanup.

**Testing:**
`npm test` — 389 tests, 387 passing, 2 failing. The 2 failures are the pre-existing Windows
`/tmp` socket `EACCES` failures in `src/csrf.integration.test.js`; the Reviewer independently
confirmed they fail identically on `main` and that the file is byte-identical to `main`. 15 new
co-located tests were written by the Developer (4 in `src/config/functionLimits.test.js`, 9 in
`src/utils/recipeImporter.test.js`, 2 in `src/views/importRecipe.test.js`). No test spawns a real
Tesseract worker. **No QA verification was performed this run.**

**Unverified — please do not treat these as passing:**
1. Whether a real ~4MB phone photo completes OCR within 8 seconds on a deployed function, and if not,
   whether the browser shows our JSON error rather than a Vercel timeout page.
2. Whether the 2000 ms reserve holds once REW-95's `sharp` normalization shares the invocation.
3. Warm-container behaviour on the import immediately after a timed-out one.

**Merge coordination:** REW-95 is reviewer-approved but unmerged on `REW-95-ocr-decoded-pixel-cap`
and rewrites the same `parseImage` function — **a conflict is expected**. Whoever merges second must
merge the two option seams into one, keep exactly one `clearTimeout`, keep `sharp` normalization
before the timer (so it spends the reserve, not the OCR budget), and keep exactly one terminate
cleanup. Do not resolve it by taking one side.

**Follow-up filed:** REW-97 — the PDF import path has no timeout, same class of defect for
`parsePdf`. Linked to this issue.

**Documentation updated:**
- `docs/api/recipe-import-limits.md` — new "Time budget for one invocation" section, the OCR timeout
  row in the error contract, the client's 502/503/504 fallback, the REW-97 gap, and a changelog entry.
- `docs/api/recipe-import-ocr-parsing.md` — new "OCR execution budget and worker lifecycle" section;
  corrected the stale `Tesseract.recognize` usage example.
- `README.md` — the 8-second OCR budget and the behaviour change in the Recipe Import section;
  `src/config/functionLimits.js` added to the project structure.
- `docs/RELEASE_NOTES_REW-93.md` — full release notes, including the unverified items.
- Confluence: [Release: REW-93 - OCR Timeout vs Vercel maxDuration](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30638094/Release+REW-93+-+OCR+Timeout+vs+Vercel+maxDuration)
  (new) and the [REW-93 Enhancement Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30605346/REW-93+OCR+Timeout+vs+Vercel+maxDuration+-+Enhancement+Plan)
  page updated from planned to as-shipped.
- No database documentation change — there are no database changes.

**Deployment:**
No migration, no new environment variable, no new dependency, no `vercel.json` change, no Vercel
project setting to update. One standing note for whoever owns the deploy: if `maxDuration` is ever
changed — including from the Vercel dashboard rather than the file — `src/config/functionLimits.js`
must change with it. The pinning test catches file-level drift but cannot see a dashboard override.

---
