# OCR/PDF Text Parsing - Technical Documentation

**Feature:** REW-12 File Import; image normalization added in REW-95
**Component:** `src/utils/recipeImporter.js`
**Last Updated:** 2026-09-14

---

## Overview

The Recipe Importer utility extracts recipe data from unstructured text sources such as OCR-processed images and PDF documents. It uses a **two-pass section-based parsing approach** to accurately identify recipe components (title, ingredients, instructions, metadata) from free-form text that lacks structured markup.

### Design Philosophy

Unlike JSON-LD imports which have well-defined schemas, OCR and PDF text extraction produces unstructured output that requires intelligent parsing. The implementation uses a combination of:

1. **Section boundary detection** - Finding where ingredients and instructions sections start/end
2. **Pattern matching** - Identifying content types through regex and heuristics
3. **Fallback classification** - Line-by-line analysis when explicit sections are not found

---

## Image Normalization Before OCR (REW-95)

**Status:** implemented on branch `REW-95-ocr-decoded-pixel-cap`, code-reviewed and approved
(2 rounds). **Not QA-verified and not yet merged to `main`.**

Before REW-95, `parseImage()` handed the raw uploaded buffer straight to `Tesseract.recognize()`.
The only size bound anywhere in the chain was Multer's `limits.fileSize` (4MB), which bounds
**encoded** bytes only. A highly compressible image — a large, mostly uniform PNG being the classic
case — fits comfortably under 4MB and still decodes to a multi-gigabyte bitmap, so the memory and
CPU ceiling on the OCR path was effectively unbounded (a decompression bomb).

Every image now passes through `normalizeImageForOcr()` before OCR is attempted.

### `normalizeImageForOcr(imageBuffer, options)`

**Purpose:** Bound and standardize the bitmap handed to Tesseract.

**Exported from:** `src/utils/recipeImporter.js`

| Parameter | Type | Description |
|-----------|------|-------------|
| `imageBuffer` | Buffer | Raw uploaded image contents |
| `options.maxInputPixels` | number | Decoded-pixel cap, defaults to `OCR_MAX_INPUT_PIXELS` |
| `options.maxDimension` | number | Longest-edge cap, defaults to `OCR_MAX_DIMENSION` |

**Returns:** `Promise<Buffer>` — a single-channel grayscale PNG.

**Pipeline, in order:**

1. `sharp(buffer, { limitInputPixels: maxInputPixels })` — rejects before decode if the image
   exceeds the cap.
2. `.rotate()` — applies EXIF orientation so OCR sees upright text.
3. `.resize({ width, height, fit: "inside", withoutEnlargement: true })` — downscales to fit the
   2000x2000 box, preserving aspect ratio; smaller images are never enlarged.
4. `.grayscale()` + `.toColourspace("b-w")` — `grayscale()` alone still encodes three identical
   sRGB channels, so the explicit colourspace conversion is what makes the output genuinely
   single-channel.
5. `.png()` — explicit output format. Without this, `toBuffer()` would echo the *input* format back
   out, and a webp upload would hand webp to tesseract.js, which this repo does not exercise.

The helper throws sharp's own error. Callers on the request path must map it to a generic message
(see below); the `options` argument exists so tests can prove the rejection path against a small
generated fixture instead of materializing a real gigapixel image.

### Tuning constants

| Constant | Value | Why |
|----------|-------|-----|
| `OCR_MAX_INPUT_PIXELS` | `40000000` (40MP) | Bounds the **decoded** side. sharp's own default is ~268MP, far too permissive, so this must be passed explicitly. A 40MP input decodes to RGB/RGBA *before* `grayscale()` runs, so peak resident pixel data is roughly 120MB (RGB) to 160MB (RGBA) plus libvips working memory — not the ~40MB a grayscale-only reading suggests. That peak still fits the function memory budget. |
| `OCR_MAX_DIMENSION` | `2000` | Post-cap downscale box. A 2000x2000 grayscale bitmap is a few MB of pixel data, which keeps OCR cost predictable inside Vercel's function budget while staying legible for recipe-sized type. |

Both are named exports, not inline literals, so future tuning has one source of truth.

The Multer encoded-byte cap and this decoded-pixel cap are **complementary**. Neither substitutes
for the other; do not relax the upload limit on the grounds that sharp now guards the path.

### Error handling

Normalization runs in its own `try`/`catch`, before the OCR timeout timer is even created. On any
throw — including the `limitInputPixels` rejection — the real cause is logged server-side via
`console.error` and a new `Error` is raised carrying the constant message:

```
Could not process image. Please try a different image.
```

This matters because `src/routes/importRoutes.js` returns `error.message` verbatim to the client.
Sharp's own text (pixel counts, dimensions, library internals) must never reach the HTTP 400 body.
The generic message also deliberately does **not** contain the substring `"timed out"`, so a
rejected decode can never be misreported as `Image processing timed out. Try a clearer image.`

### Other behaviour in this change

- Normalization happens **outside** the `OCR_TIMEOUT_MS` window, on purpose, so that timer keeps
  meaning "time spent in OCR". Total wall-clock per request grows slightly as a result.
- The OCR timeout `setTimeout` handle is now captured and cleared in a `finally`. This is handle
  cleanup only — `Promise.race` still does not cancel the Tesseract worker, which remains REW-93's
  scope. (Side effect: the importer test file dropped from ~31s to under 0.5s, because every
  `parseImage` call previously left a pending 30s timer holding the event loop open.)
- Normalization applies **only** to the `image/*` branch, after `importRecipe`'s magic-number
  validation. The JSON and PDF branches are untouched.
- `OCR_TIMEOUT_MS` (30000), `SUPPORTED_MIME_TYPES`, the Multer allow-list and size cap, rate-limiter
  values, and the middleware ordering on `POST /recipes/import/parse` are all unchanged.

### Known limitations

- **Accuracy at 2000px.** Downscaling a dense, high-resolution recipe photo could cost recognition
  accuracy on small type. Accepted per the ticket; **not yet verified against a real phone photo**.
- **Transparent PNGs.** Grayscaling a PNG with a transparent background can render text poorly
  without a `flatten()` step first. Knowingly out of scope; revisit only if a regression appears.
- **Recipe photo upload path is still unguarded.** `generateThumbnail()` and `optimizeImage()` in
  `src/utils/imageUtils.js` still call `sharp(imageBuffer)` with no `limitInputPixels`. Same
  decompression-bomb class, different route — tracked in **REW-96**.

---

## Key Functions

### `parseUnstructuredText(text, baseConfidence)`

**Purpose:** Main entry point for parsing unstructured text (OCR or PDF) into recipe structure.

**Location:** Lines 743-844

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | string | Raw text extracted from OCR or PDF |
| `baseConfidence` | number | Starting confidence score (0.6 for PDF, 0.4 for OCR) |

**Returns:** Parsed recipe object with `title`, `description`, `ingredients`, `instructions`, `prepTime`, `cookTime`, `servings`, `confidence`, and `warnings`.

**Algorithm (Two-Pass Approach):**

1. **Pass 1 - Preprocessing:**
   - Clean and normalize text via `cleanOcrText()`
   - Extract metadata (prep time, cook time, servings) via `extractRecipeMetadata()`
   - Split into lines and sanitize each

2. **Pass 2 - Section Parsing:**
   - Find section boundaries via `findSectionBoundaries()`
   - Extract title and description from beginning via `extractTitle()`
   - Parse ingredients section via `parseIngredientSection()`
   - Parse instructions section via `parseInstructionSection()`

3. **Fallback:**
   - If no sections found, classify each line individually using `looksLikeIngredient()` and `looksLikeInstruction()` heuristics

---

### `findSectionBoundaries(lines)`

**Purpose:** Identifies where each recipe section (ingredients, instructions) starts and ends.

**Location:** Lines 483-552

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `lines` | string[] | Array of text lines |

**Returns:** Object with section indices:
```javascript
{
  title: { start: 0, end: -1 },
  metadata: { lines: [] },
  ingredients: { start: -1, end: -1, explicit: boolean },
  instructions: { start: -1, end: -1, explicit: boolean }
}
```

**Detection Methods:**

1. **Explicit headers** - Searches for section header patterns matching `SECTION_PATTERNS`
2. **Implicit detection** - When no headers found, identifies sections by first line that matches ingredient/instruction patterns
3. **Boundary inference** - Sets end of ingredients section at start of instructions section

---

### `cleanOcrText(text)`

**Purpose:** Handles common OCR artifacts and normalizes text formatting.

**Location:** Lines 560-575

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | string | Raw OCR text |

**Returns:** Cleaned text string.

**Transformations Applied:**
- Normalizes line breaks (`\r\n` and `\r` to `\n`)
- Converts pipe character `|` to `I` (common OCR mistake)
- Converts `0` before measurements to `O` (zero vs "One")
- Normalizes whitespace while preserving paragraph breaks
- Converts various bullet point symbols to standard dash `-`
- Handles `o ` at start of line as bullet point

---

### `extractTitle(lines, metadata)`

**Purpose:** Extracts recipe title and description from the beginning of the text.

**Location:** Lines 583-635

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `lines` | string[] | Array of text lines |
| `metadata` | Object | Previously extracted metadata |

**Returns:** Object with `title` and `description` strings.

**Extraction Logic:**
- Scans first 10 lines for title candidate
- Skips empty lines, metadata lines, section headers
- Skips lines starting with measurements (likely ingredients)
- Skips numbered steps (likely instructions)
- First qualifying line becomes title (cleaned of prefixes like "Recipe:")
- Second qualifying line may become description (15-200 characters)
- Truncates overly long titles to 100 characters

---

### `extractRecipeMetadata(text)`

**Purpose:** Extracts prep time, cook time, total time, and servings from text.

**Location:** Lines 281-376

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | string | Full text to search |

**Returns:** Object with `prepTime`, `cookTime`, `totalTime`, `servings`, and `metadataLines` array.

**Patterns Recognized:**

| Metadata | Example Patterns |
|----------|------------------|
| Prep time | "Prep: 20 min", "Preparation time: 15 minutes" |
| Cook time | "Cook: 30 min", "Bake time: 1 hr" |
| Total time | "Total: 45 min", "Ready in: 1 hr 30 min" |
| Servings | "Serves 4", "Yields 24 cookies", "Makes 2 loaves" |

---

### `parseIngredientSection(lines)`

**Purpose:** Parses lines identified as belonging to the ingredients section.

**Location:** Lines 642-673

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `lines` | string[] | Lines within the ingredients section |

**Returns:** Array of cleaned ingredient strings.

**Processing:**
- Skips empty lines, section headers, metadata lines
- Skips lines that look more like instructions than ingredients
- Skips notes/tips/variations
- Cleans ingredient lines via `cleanIngredientLine()`
- Filters out lines shorter than 2 characters

---

### `parseInstructionSection(lines)`

**Purpose:** Parses lines identified as belonging to the instructions section.

**Location:** Lines 680-734

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `lines` | string[] | Lines within the instructions section |

**Returns:** Array of instruction strings, numbered if not already.

**Processing:**
- Handles multi-line instructions (joins until next numbered step or paragraph break)
- Detects numbered step patterns (e.g., "1.", "Step 2:", "3)")
- Adds numbers to unnumbered instructions
- Skips section headers and metadata

---

### `looksLikeIngredient(line)`

**Purpose:** Heuristic function to determine if a line is likely an ingredient.

**Location:** Lines 878-959

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `line` | string | Line to analyze |

**Returns:** Boolean indicating ingredient likelihood.

**Heuristics (Weighted):**

| Strength | Indicator | Example |
|----------|-----------|---------|
| **Strong** | Quantity + measurement at start | "2 cups flour" |
| **Strong exclusion** | Numbered step with cooking verb | "1. Brown the butter" |
| **Medium** | Contains measurement unit | "flour, about 2 cups" |
| **Weak** | Starts with number (not step) | "3 eggs" |
| **Weak** | Common ingredient name | "salt and pepper to taste" |

---

### `looksLikeInstruction(line)`

**Purpose:** Heuristic function to determine if a line is likely an instruction step.

**Location:** Lines 966-1018

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `line` | string | Line to analyze |

**Returns:** Boolean indicating instruction likelihood.

**Heuristics (Weighted):**

| Strength | Indicator | Example |
|----------|-----------|---------|
| **Strong** | Numbered step + cooking verb | "1. Brown the butter" |
| **Strong** | Starts with cooking verb | "Preheat oven to 350F" |
| **Strong** | Numbered step > 25 chars | "2. Mix ingredients until smooth" |
| **Medium** | Multiple cooking verbs | "stir and let simmer" |
| **Medium** | Timing phrases + verb | "cook for 10 minutes" |
| **Weak** | Long line + verb, no units | "Continue stirring until thickened" |

---

## Constants

### `COOKING_VERBS`

**Purpose:** Regular expression matching 80+ cooking action verbs that indicate instruction text.

**Location:** Line 861

**Sample verbs included:**
- Basic actions: mix, combine, stir, add, pour
- Heat methods: bake, cook, heat, simmer, boil, fry, saute
- Prep verbs: chop, dice, slice, peel, grate, mince
- Advanced: fold, knead, whisk, blend, cream, marinate
- Timing: let, rest, stand, steep, chill, refrigerate
- Process: process, pulse, puree, mash, crush, grind

---

### `MEASUREMENT_UNITS`

**Purpose:** Regular expression matching common recipe measurement units.

**Location:** Line 866

**Units included:**

| Category | Units |
|----------|-------|
| Volume | cup, tbsp, tsp, tablespoon, teaspoon, ml, liter |
| Weight | oz, ounce, lb, pound, g, gram, kg |
| Count | clove, can, jar, package, stick, slice, piece, whole, half |
| Produce | bunch, head, sprig, stalk, leaves, ears |
| Approximate | pinch, dash, handful, drop, scoop |

---

### `SECTION_PATTERNS`

**Purpose:** Object containing regex patterns for detecting section headers.

**Location:** Lines 472-475

**Patterns:**

```javascript
{
  ingredients: /^(ingredients?|what you(?:'ll)? need|you(?:'ll)? need|shopping list)[:.]?\s*$/i,
  instructions: /^(instructions?|directions?|method|steps?|how to (?:make|prepare)|preparation|procedure)[:.]?\s*$/i
}
```

---

### `NUMBER_PATTERN`

**Purpose:** Matches numeric patterns including Unicode fractions.

**Location:** Line 871

**Pattern:** `/^[\d\u00BD\u00BC\u00BE\u2153\u2154\u215B\u215C\u215D\u215E][\d\/\s\u00BD\u00BC\u00BE\u2153\u2154\u215B\u215C\u215D\u215E\-to]*/`

**Matches:** Numbers, fractions (1/2), Unicode fractions, and ranges (2-3, 2 to 3)

---

## Confidence Scoring

The parser assigns a confidence score based on extraction success:

| Factor | Score Adjustment |
|--------|------------------|
| Base (PDF) | 0.6 |
| Base (OCR) | 0.4 |
| Ingredients found | +0.1 |
| Instructions found | +0.1 |
| Title extracted | +0.1 |
| Explicit section headers | +0.1 |
| Prep or cook time found | +0.05 |
| Servings found | +0.05 |
| **Maximum** | 0.9 |

---

## Usage Examples

### PDF Import Flow

```javascript
// In parsePdf()
const fullText = extractTextFromPdf(pdfBuffer);
return parseUnstructuredText(fullText, 0.6); // Base confidence 0.6
```

### OCR Import Flow

```javascript
// In parseImage() - REW-95 normalization runs first, outside the OCR timeout
const normalizedBuffer = await normalizeImageForOcr(imageBuffer);
const ocrResult = await Tesseract.recognize(normalizedBuffer, 'eng');
const parsed = parseUnstructuredText(ocrResult.data.text, 0.4); // Base confidence 0.4
parsed.warnings.push("Text was extracted from an image using OCR. Please verify accuracy.");
return parsed;
```

---

## OCR execution budget and worker lifecycle (REW-93)

`parseImage` runs inside a serverless function with a hard wall clock, so the OCR step is bounded
before the platform can kill the request out from under it.

### Where the budget comes from

`src/config/functionLimits.js` is the single source of truth. `VERCEL_MAX_DURATION_SECONDS` (`10`)
mirrors `vercel.json` → `functions["server.js"].maxDuration`; `FUNCTION_RESERVE_MS` (`2000`) covers
the non-OCR work in the same invocation; `OCR_TIMEOUT_MS` is the remainder, **8000 ms**.
`recipeImporter.js` imports that value and re-exports it, so there is no OCR timeout literal in the
importer. `src/config/functionLimits.test.js` reads the real `vercel.json` from disk and fails if
the mirrored value drifts. `vercel.json` is not read at runtime — it is build configuration and is
not guaranteed to be in the deployed function bundle.

Before REW-93 the importer used a 30-second literal that the 10-second platform deadline made
unreachable, so a slow OCR produced an opaque platform timeout page rather than the application's
own JSON error.

### Signature

```javascript
parseImage(fileBuffer, mimeType, { timeoutMs, createWorkerImpl })
```

Both options are test seams with production defaults (`OCR_TIMEOUT_MS` and the internal
`createOcrWorker`). Production callers pass nothing. Tests inject a fake worker so no test spawns
Tesseract or performs real OCR.

### Lifecycle

`createWorker` → `recognize` → `terminate`, rather than the one-shot `Tesseract.recognize` helper,
specifically so the timeout path can reclaim the worker. Worker startup happens inside the raced
promise, so a slow cold start spends the OCR budget rather than sitting outside the timeout
entirely. A single `finally` runs on all paths — success, timeout, and OCR error — and it:

1. Clears the pending timeout handle, so a successful OCR does not hold the event loop for the
   remainder of the budget.
2. Terminates the worker. If `terminate` throws, the failure is logged as
   `"Failed to terminate OCR worker:"` and swallowed; it must never replace the user-facing error.
3. Handles the cold-start race where the timeout fires before the worker finishes starting: the
   response is not blocked on startup, but the worker is terminated as soon as it exists. A worker
   that never starts is logged distinctly as `"OCR worker startup failed:"`.

### Error messages

| Condition | Message |
|-----------|---------|
| OCR exceeded the budget | `Image processing timed out. Try a clearer image.` |
| OCR failed for any other reason | `Could not process image. Please try a different image.` |
| OCR returned fewer than 20 characters | `Could not extract enough text from image. Try a clearer image.` |

The `"timed out"` substring is **load-bearing**: `parseImage` branches on
`error.message.includes("timed out")` to decide whether to re-throw the timeout or replace it with
the generic message, and REW-95's tests assert that non-timeout import errors never contain it. Do
not reword the timeout message. None of these messages may carry buffer sizes, pixel counts, file
paths, timing values, worker internals, or stack traces — `src/routes/importRoutes.js` returns
`error.message` straight to the client.

### Unverified

QA did not run for REW-93. It has not been confirmed on a deployed function that a real ~4MB phone
photo completes OCR within 8 seconds, that the 2000 ms reserve is sufficient once REW-95's `sharp`
normalization shares the invocation, or that a warm container is unaffected by the import
immediately following a timed-out one.

### Not covered: the PDF path

`parsePdf` has no timeout at all. A large multi-page PDF can still run to the platform deadline.
Tracked in **REW-97**.

---

## Sample Input/Output

### Input (OCR Text)

```
Grandma's Chocolate Chip Cookies

A family favorite for generations!

Prep Time: 15 minutes
Cook Time: 12 minutes
Yields: 24 cookies

Ingredients

2 1/4 cups all-purpose flour
1 tsp baking soda
1 cup butter, softened
3/4 cup granulated sugar
2 large eggs
2 cups chocolate chips

Instructions

1. Preheat oven to 375 degrees F.
2. Combine flour and baking soda in a bowl.
3. Beat butter and sugar until creamy.
4. Add eggs and beat well.
5. Gradually blend in flour mixture.
6. Stir in chocolate chips.
7. Drop rounded tablespoon onto baking sheets.
8. Bake for 9 to 11 minutes or until golden brown.
```

### Output (Parsed Object)

```javascript
{
  title: "Grandma's Chocolate Chip Cookies",
  description: "A family favorite for generations!",
  ingredients: "2 1/4 cups all-purpose flour\n1 tsp baking soda\n1 cup butter, softened\n3/4 cup granulated sugar\n2 large eggs\n2 cups chocolate chips",
  instructions: "1. Preheat oven to 375 degrees F.\n2. Combine flour and baking soda in a bowl.\n3. Beat butter and sugar until creamy.\n4. Add eggs and beat well.\n5. Gradually blend in flour mixture.\n6. Stir in chocolate chips.\n7. Drop rounded tablespoon onto baking sheets.\n8. Bake for 9 to 11 minutes or until golden brown.",
  prepTime: "15 min",
  cookTime: "12 min",
  servings: "24 cookies",
  sourceUrl: "",
  confidence: 0.9,
  warnings: []
}
```

---

## Related Documentation

- [Recipe Import Plan](../plans/REW-12-file-import.md) - Full feature specification
- [Recipe Import Limits & Error Contract](recipe-import-limits.md) - Upload cap, rate limit, time budget, and the JSON error contract
- [Recipe Scaling API](recipe-scaling.md) - How imported recipes can be scaled
- [API Overview](README.md) - All API endpoints
- [Release notes: REW-93](../RELEASE_NOTES_REW-93.md) - The derived OCR budget and worker lifecycle

---

## Changelog

| Date | Change |
|------|--------|
| 2026-08-16 | Initial documentation for REW-12 OCR/PDF parsing |
| 2026-09-14 | Added the REW-95 image-normalization section (decoded-pixel cap, downscale, grayscale, generic error mapping). Branch-only; reviewed, not QA-verified, not merged. |
