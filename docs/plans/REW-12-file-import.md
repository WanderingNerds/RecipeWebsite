# Implementation Plan: REW-12 File Import

**Jira Issue:** [REW-12](https://wanderingnerds.atlassian.net/browse/REW-12)
**Status:** Planning Complete
**Created:** 2026-08-15

---

## Summary

Implement recipe import functionality allowing users to import recipes from supported file formats. This feature will parse uploaded files and extract recipe data (title, ingredients, instructions, etc.) to create new recipes.

---

## Requirements (Clarified)

| Requirement | Decision |
|-------------|----------|
| Maximum file size | **2MB** |
| Priority formats | **JSON imports and PDF/image** (text files lower priority) |
| Batch import | **No** - Single imports only for initial release |
| Duplicate titles | **Force user to create a new title** if recipe title already exists |

---

## Supported Import Formats

### Phase 1 (This Release)

| Format | Extension | Description |
|--------|-----------|-------------|
| JSON-LD/Schema.org Recipe | `.json` | Web standard recipe format used by most recipe websites |
| PDF | `.pdf` | Extract text from PDF recipes using pdf.js-extract |
| Image (OCR) | `.jpg`, `.png`, `.webp` | Extract text from recipe images/screenshots |

### Phase 2 (Future)

| Format | Extension | Description |
|--------|-----------|-------------|
| Plain text | `.txt` | Free-form text parsing using existing ingredient parser |
| Paprika | `.paprikarecipes` | Popular recipe app export format |

---

## Technical Architecture

### Dependencies to Add

```json
{
  "pdf.js-extract": "^0.2.1",
  "tesseract.js": "^5.0.0"
}
```

- **pdf.js-extract**: Node.js wrapper for PDF.js to extract text from PDFs
- **tesseract.js**: OCR library for extracting text from images

### File Structure

```
src/
├── routes/
│   └── importRoutes.js          # NEW: Import endpoints
├── utils/
│   └── recipeImporter.js        # NEW: Import parsing logic
│       ├── parseJsonLd()
│       ├── parsePdf()
│       └── parseImage()
views/
├── recipes/
│   └── import.ejs               # NEW: Import preview/edit page
├── partials/
│   └── import-modal.ejs         # NEW: File upload modal
public/
├── js/
│   └── import.js                # NEW: Client-side import handling
```

---

## Implementation Tasks

### Task 1: Create Import Utilities

**File:** `src/utils/recipeImporter.js`

```javascript
// Core functions to implement:

/**
 * Parse JSON-LD/Schema.org Recipe format
 * @param {Buffer} fileBuffer - File contents
 * @returns {Object} Parsed recipe data
 */
async function parseJsonLd(fileBuffer) { }

/**
 * Extract text from PDF and parse as recipe
 * @param {Buffer} fileBuffer - PDF file contents
 * @returns {Object} Parsed recipe data
 */
async function parsePdf(fileBuffer) { }

/**
 * OCR image and parse extracted text as recipe
 * @param {Buffer} fileBuffer - Image file contents
 * @param {string} mimeType - Image MIME type
 * @returns {Object} Parsed recipe data
 */
async function parseImage(fileBuffer, mimeType) { }

/**
 * Detect file type and route to appropriate parser
 * @param {Buffer} fileBuffer - File contents
 * @param {string} originalName - Original filename
 * @param {string} mimeType - Declared MIME type
 * @returns {Object} Parsed recipe data
 */
async function importRecipe(fileBuffer, originalName, mimeType) { }
```

**Parsed Recipe Data Structure:**
```javascript
{
  title: String,           // Required
  description: String,     // Optional
  ingredients: String,     // Newline-separated ingredients
  instructions: String,    // Newline-separated steps
  prepTime: String,        // Optional (e.g., "15 minutes")
  cookTime: String,        // Optional
  servings: String,        // Optional (e.g., "4 servings")
  sourceUrl: String,       // Optional - original recipe URL
  confidence: Number,      // 0-1 parsing confidence score
  warnings: Array<String>  // Any parsing warnings/issues
}
```

### Task 2: Create Import Routes

**File:** `src/routes/importRoutes.js`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/recipes/import` | Render import page with upload form |
| POST | `/recipes/import/parse` | Parse uploaded file, return JSON preview |
| POST | `/recipes/import/save` | Save imported recipe (after user confirmation) |

**Rate Limiting:** 5 imports per 15 minutes per user

**Multer Configuration:**
```javascript
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/json',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  }
});
```

### Task 3: Handle Duplicate Titles

When saving an imported recipe:

1. Check if title already exists for the user
2. If duplicate found, return error with `duplicateTitle: true`
3. Client displays inline error asking user to modify the title
4. User must change the title before saving

```javascript
// In save route
const existingRecipe = await supabase
  .from('recipes')
  .select('id')
  .eq('user_id', userId)
  .ilike('title', importedTitle)
  .single();

if (existingRecipe.data) {
  return res.status(400).json({
    error: 'A recipe with this title already exists',
    duplicateTitle: true
  });
}
```

### Task 4: Create Import UI

**Import Modal** (`views/partials/import-modal.ejs`):
- Drag-and-drop file upload zone
- File type badges showing supported formats
- Upload progress indicator
- Error display area

**Import Preview Page** (`views/recipes/import.ejs`):
- Editable form pre-filled with parsed data
- Title field with duplicate validation
- Ingredients textarea (parsed ingredients)
- Instructions textarea (parsed instructions)
- Optional fields: prep time, cook time, servings
- Confidence indicator showing parse quality
- Warnings display if any parsing issues
- "Save Recipe" and "Cancel" buttons

### Task 5: Client-Side JavaScript

**File:** `public/js/import.js`

```javascript
// Functions to implement:
- initImportModal()      // Set up drag-drop and file input
- uploadFile(file)       // POST to /recipes/import/parse
- displayPreview(data)   // Redirect to import preview page
- validateTitle(title)   // Check for duplicates via AJAX
- saveImportedRecipe()   // POST to /recipes/import/save
```

---

## JSON-LD/Schema.org Recipe Format

Expected input format (from web recipes):

```json
{
  "@context": "https://schema.org/",
  "@type": "Recipe",
  "name": "Chocolate Chip Cookies",
  "description": "Classic homemade chocolate chip cookies",
  "recipeIngredient": [
    "2 cups all-purpose flour",
    "1 cup butter, softened",
    "1 cup chocolate chips"
  ],
  "recipeInstructions": [
    {
      "@type": "HowToStep",
      "text": "Preheat oven to 375°F"
    },
    {
      "@type": "HowToStep",
      "text": "Mix flour and butter"
    }
  ],
  "prepTime": "PT15M",
  "cookTime": "PT12M",
  "recipeYield": "24 cookies"
}
```

**Parsing Notes:**
- `recipeInstructions` can be array of strings OR array of HowToStep objects
- Times are in ISO 8601 duration format (PT15M = 15 minutes)
- Handle both formats gracefully

---

## PDF Parsing Strategy

1. Extract all text from PDF using pdf.js-extract
2. Use heuristics to identify sections:
   - Title: First prominent text or largest font
   - Ingredients: Lines starting with quantities/measurements
   - Instructions: Numbered steps or paragraphs after ingredients
3. Leverage existing `ingredientParser.js` for ingredient line detection
4. Set lower confidence score for PDF imports (more prone to errors)

---

## Image OCR Strategy

1. Use Tesseract.js for OCR text extraction
2. Pre-process image if needed (handled by Tesseract)
3. Parse extracted text same as PDF text
4. Set lowest confidence score (OCR can be unreliable)
5. Display prominent warning about OCR accuracy

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| File type spoofing | Validate using `file-type` library (magic numbers), not just extension |
| Malicious PDFs | pdf.js-extract is read-only text extraction, no JS execution |
| XSS in parsed content | Sanitize all extracted text before display and storage |
| DoS via large files | 2MB limit enforced by multer |
| DoS via slow parsing | Timeout OCR operations after 30 seconds |
| Rate limiting | 5 imports per 15 minutes per user |

---

## Error Handling

| Error | User Message |
|-------|--------------|
| Unsupported file type | "Please upload a JSON, PDF, or image file" |
| File too large | "File must be under 2MB" |
| Parse failure | "Could not extract recipe from file. Try a different format." |
| OCR timeout | "Image processing timed out. Try a clearer image." |
| Duplicate title | "A recipe with this title already exists. Please choose a different title." |

---

## Acceptance Criteria

1. [ ] User can upload a JSON-LD recipe file and see parsed preview
2. [ ] User can upload a PDF recipe and see parsed preview
3. [ ] User can upload a recipe image and see OCR-extracted preview
4. [ ] Parsed data is editable before saving
5. [ ] Duplicate title detection prevents saving with existing title
6. [ ] User must modify title to resolve duplicate
7. [ ] Successfully saved recipe appears in user's recipe list
8. [ ] File size limit of 2MB is enforced
9. [ ] Unsupported file types show clear error message
10. [ ] Import is rate limited to 5 per 15 minutes

---

## Test Cases

### Unit Tests (`src/utils/recipeImporter.test.js`)

1. **JSON-LD Parsing**
   - Valid Schema.org Recipe with HowToStep instructions
   - Valid Schema.org Recipe with string instructions
   - JSON without @type Recipe (should fail gracefully)
   - Malformed JSON (should throw parse error)

2. **PDF Parsing**
   - PDF with clear recipe structure
   - PDF with no recognizable recipe content
   - Corrupted/invalid PDF

3. **Image OCR**
   - Clear recipe image
   - Blurry/low-quality image
   - Image with no text

### Integration Tests

1. Upload JSON file → preview → save → appears in list
2. Upload PDF file → preview → edit title → save
3. Upload with duplicate title → error → change title → save
4. Upload unsupported file type → error message
5. Upload file over 2MB → error message
6. Exceed rate limit → rate limit error

---

## Files to Create/Modify

### New Files
- `src/routes/importRoutes.js`
- `src/utils/recipeImporter.js`
- `src/utils/recipeImporter.test.js`
- `views/recipes/import.ejs`
- `views/partials/import-modal.ejs`
- `public/js/import.js`

### Modified Files
- `src/routes/index.js` - Register import routes
- `views/recipes/index.ejs` - Add "Import Recipe" button
- `views/partials/navbar.ejs` - Optional: Add import link
- `package.json` - Add dependencies

---

## Estimated Effort

| Task | Complexity |
|------|------------|
| Import utilities (JSON, PDF, OCR) | High |
| Import routes | Medium |
| Import UI (modal + preview) | Medium |
| Duplicate title handling | Low |
| Tests | Medium |
| **Total** | **~Medium-High** |

---

## Out of Scope (Future Enhancements)

- Batch/bulk import of multiple recipes
- Plain text file import
- Paprika format import
- URL import (scrape recipe from website)
- Import history/log
- Undo import

---

## Ready for Development

This plan is ready for handoff to the Developer agent. All requirements have been clarified and the implementation path is defined.
