/**
 * Recipe import utilities.
 *
 * Parses recipes from various file formats:
 * - JSON-LD/Schema.org Recipe format
 * - PDF files (text extraction)
 * - Images (OCR)
 */

import { fileTypeFromBuffer } from "file-type";
import { PDFExtract } from "pdf.js-extract";
import Tesseract from "tesseract.js";

// OCR timeout in milliseconds
const OCR_TIMEOUT_MS = 30000;

/**
 * Supported MIME types for import
 */
export const SUPPORTED_MIME_TYPES = [
  "application/json",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

/**
 * Validates that a file is a supported import format using magic numbers
 * @param {Buffer} buffer - The file buffer to validate
 * @returns {Promise<{valid: boolean, mime: string|null}>}
 */
export async function validateImportFile(buffer) {
  try {
    const type = await fileTypeFromBuffer(buffer);

    // JSON files don't have magic numbers, so fileType returns undefined
    // We need to check if it's valid JSON separately
    if (!type) {
      try {
        const text = buffer.toString("utf8");
        JSON.parse(text);
        return { valid: true, mime: "application/json" };
      } catch {
        return { valid: false, mime: null };
      }
    }

    if (SUPPORTED_MIME_TYPES.includes(type.mime)) {
      return { valid: true, mime: type.mime };
    }

    return { valid: false, mime: type.mime };
  } catch (error) {
    console.error("Error validating import file:", error);
    return { valid: false, mime: null };
  }
}

/**
 * Parse ISO 8601 duration format (PT15M, PT1H30M) to human-readable string
 * @param {string} duration - ISO 8601 duration string
 * @returns {string|null}
 */
function parseIsoDuration(duration) {
  if (!duration || typeof duration !== "string") return null;

  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return duration; // Return as-is if not ISO format

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0 && parts.length === 0) parts.push(`${seconds} sec`);

  return parts.join(" ") || null;
}

/**
 * Sanitize text to prevent XSS - removes HTML tags and dangerous characters
 * @param {string} text - Raw text to sanitize
 * @returns {string}
 */
function sanitizeText(text) {
  if (!text || typeof text !== "string") return "";

  return text
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

/**
 * Sanitize URL to only allow safe protocols (http/https)
 * Prevents javascript:, data:, and other dangerous URL schemes
 * @param {string} url - URL to sanitize
 * @returns {string} Sanitized URL or empty string if invalid
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();

  // Empty string is valid (no URL)
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    // Only allow http and https protocols
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return trimmed;
    }
  } catch {
    // Invalid URL format
  }
  return "";
}

/**
 * Parse JSON-LD/Schema.org Recipe format
 * @param {Buffer} fileBuffer - File contents
 * @returns {Promise<Object>} Parsed recipe data
 */
export async function parseJsonLd(fileBuffer) {
  const text = fileBuffer.toString("utf8");
  let json;

  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error("Invalid JSON format");
  }

  // Handle array of items (some sites wrap the recipe in an array)
  if (Array.isArray(json)) {
    json = json.find((item) => item["@type"] === "Recipe") || json[0];
  }

  // Handle @graph structure
  if (json["@graph"]) {
    json = json["@graph"].find((item) => item["@type"] === "Recipe") || json["@graph"][0];
  }

  // Validate it's a Recipe type
  const type = json["@type"];
  if (type !== "Recipe" && type !== "https://schema.org/Recipe") {
    throw new Error("JSON does not contain a Recipe schema");
  }

  // Extract ingredients
  let ingredients = "";
  if (json.recipeIngredient) {
    const ingredientList = Array.isArray(json.recipeIngredient)
      ? json.recipeIngredient
      : [json.recipeIngredient];
    ingredients = ingredientList.map((i) => sanitizeText(i)).join("\n");
  }

  // Extract instructions
  let instructions = "";
  if (json.recipeInstructions) {
    const instructionList = Array.isArray(json.recipeInstructions)
      ? json.recipeInstructions
      : [json.recipeInstructions];

    instructions = instructionList
      .map((step, index) => {
        if (typeof step === "string") {
          return sanitizeText(step);
        }
        if (step["@type"] === "HowToStep" || step["@type"] === "HowToSection") {
          const text = step.text || step.name || "";
          return sanitizeText(text);
        }
        return "";
      })
      .filter((s) => s)
      .map((step, index) => `${index + 1}. ${step}`)
      .join("\n");
  }

  // Extract servings/yield
  let servings = null;
  if (json.recipeYield) {
    const yieldValue = Array.isArray(json.recipeYield)
      ? json.recipeYield[0]
      : json.recipeYield;
    servings = sanitizeText(String(yieldValue));
  }

  const result = {
    title: sanitizeText(json.name || "Untitled Recipe"),
    description: sanitizeText(json.description || ""),
    ingredients,
    instructions,
    prepTime: parseIsoDuration(json.prepTime),
    cookTime: parseIsoDuration(json.cookTime),
    servings,
    sourceUrl: sanitizeUrl(json.url || json.mainEntityOfPage?.["@id"] || ""),
    confidence: 0.95, // JSON-LD is structured data, high confidence
    warnings: [],
  };

  // Add warnings for missing fields
  if (!result.title || result.title === "Untitled Recipe") {
    result.warnings.push("Recipe title could not be extracted");
  }
  if (!result.ingredients) {
    result.warnings.push("No ingredients found");
  }
  if (!result.instructions) {
    result.warnings.push("No instructions found");
  }

  return result;
}

/**
 * Extract text from PDF and parse as recipe
 * @param {Buffer} fileBuffer - PDF file contents
 * @returns {Promise<Object>} Parsed recipe data
 */
export async function parsePdf(fileBuffer) {
  const pdfExtract = new PDFExtract();

  let pdfData;
  try {
    pdfData = await pdfExtract.extractBuffer(fileBuffer);
  } catch (error) {
    throw new Error("Could not read PDF file. It may be corrupted or password-protected.");
  }

  // Extract all text from all pages
  const allText = [];
  for (const page of pdfData.pages) {
    const pageText = page.content
      .filter((item) => item.str && item.str.trim())
      .map((item) => item.str.trim())
      .join(" ");
    allText.push(pageText);
  }

  const fullText = allText.join("\n\n");

  if (!fullText.trim()) {
    throw new Error("Could not extract text from PDF. It may be an image-based PDF.");
  }

  return parseUnstructuredText(fullText, 0.6);
}

/**
 * OCR image and parse extracted text as recipe
 * @param {Buffer} fileBuffer - Image file contents
 * @param {string} mimeType - Image MIME type
 * @returns {Promise<Object>} Parsed recipe data
 */
export async function parseImage(fileBuffer, mimeType) {
  // Create a promise that rejects after timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error("Image processing timed out. Try a clearer image."));
    }, OCR_TIMEOUT_MS);
  });

  // OCR the image
  const ocrPromise = Tesseract.recognize(fileBuffer, "eng", {
    logger: () => {}, // Suppress progress logging
  });

  let result;
  try {
    result = await Promise.race([ocrPromise, timeoutPromise]);
  } catch (error) {
    if (error.message.includes("timed out")) {
      throw error;
    }
    throw new Error("Could not process image. Please try a different image.");
  }

  const text = result.data.text;

  if (!text || text.trim().length < 20) {
    throw new Error("Could not extract enough text from image. Try a clearer image.");
  }

  const parsed = parseUnstructuredText(text, 0.4);
  parsed.warnings.push("Text was extracted from an image using OCR. Please verify accuracy.");

  return parsed;
}

/**
 * Extract metadata (prep time, cook time, yield) from text
 * @param {string} text - Full text to search
 * @returns {Object} Extracted metadata
 */
function extractRecipeMetadata(text) {
  const metadata = {
    prepTime: null,
    cookTime: null,
    totalTime: null,
    servings: null,
    metadataLines: [], // Lines that contain metadata (to exclude from ingredients)
  };

  // Normalize text for matching
  const normalizedText = text.replace(/\s+/g, ' ');

  // Enhanced time pattern - handles "1 hr 30 min", "90 minutes", "1.5 hours", etc.
  const timeValuePattern = '(\\d+(?:\\.\\d+)?\\s*(?:hr|hour|hours|h)?\\s*(?:\\d+)?\\s*(?:min|mins|minute|minutes|m)?)';

  // Look for prep time with multiple variations
  const prepPatterns = [
    new RegExp(`prep(?:aration)?\\s*(?:time)?[:\\s]+${timeValuePattern}`, 'i'),
    new RegExp(`time\\s+to\\s+prep[:\\s]+${timeValuePattern}`, 'i'),
    new RegExp(`prep[:\\s]+${timeValuePattern}`, 'i'),
  ];

  for (const pattern of prepPatterns) {
    const match = normalizedText.match(pattern);
    if (match && !metadata.prepTime) {
      metadata.prepTime = normalizeTimeString(match[1]);
      metadata.metadataLines.push(match[0]);
      break;
    }
  }

  // Look for cook time with multiple variations
  const cookPatterns = [
    new RegExp(`cook(?:ing)?\\s*(?:time)?[:\\s]+${timeValuePattern}`, 'i'),
    new RegExp(`bake\\s*(?:time)?[:\\s]+${timeValuePattern}`, 'i'),
    new RegExp(`time\\s+to\\s+cook[:\\s]+${timeValuePattern}`, 'i'),
    new RegExp(`cook[:\\s]+${timeValuePattern}`, 'i'),
  ];

  for (const pattern of cookPatterns) {
    const match = normalizedText.match(pattern);
    if (match && !metadata.cookTime) {
      metadata.cookTime = normalizeTimeString(match[1]);
      metadata.metadataLines.push(match[0]);
      break;
    }
  }

  // Look for total time
  const totalPatterns = [
    new RegExp(`total\\s*(?:time)?[:\\s]+${timeValuePattern}`, 'i'),
    new RegExp(`ready\\s+in[:\\s]+${timeValuePattern}`, 'i'),
    new RegExp(`time[:\\s]+${timeValuePattern}`, 'i'), // Generic "Time: X" if no prep/cook found
  ];

  for (const pattern of totalPatterns) {
    const match = normalizedText.match(pattern);
    if (match && !metadata.totalTime) {
      metadata.totalTime = normalizeTimeString(match[1]);
      metadata.metadataLines.push(match[0]);
      break;
    }
  }

  // Look for yield/servings with multiple variations
  const yieldPatterns = [
    /(?:yield|yields)[:\s]*(\d+\s*(?:to|-)\s*\d+|\d+)\s*(cookies?|servings?|portions?|pieces?|cups?|loaves?|loaf|muffins?|people|persons?|dozen|doz|bars?|squares?|slices?)?/i,
    /(?:serves|serving)[:\s]*(\d+\s*(?:to|-)\s*\d+|\d+)\s*(people|persons?|guests?)?/i,
    /(?:makes|producing)[:\s]*(\d+\s*(?:to|-)\s*\d+|\d+)\s*(cookies?|servings?|portions?|pieces?|cups?|loaves?|loaf|muffins?|bars?|squares?|slices?|dozen|doz)?/i,
    /(?:servings?|portions?)[:\s]*(\d+)/i,
  ];

  for (const pattern of yieldPatterns) {
    const match = normalizedText.match(pattern);
    if (match && !metadata.servings) {
      // Combine number with unit if present
      let servingsText = match[1].trim();
      if (match[2]) {
        servingsText += ' ' + match[2].trim();
      }
      metadata.servings = servingsText;
      metadata.metadataLines.push(match[0]);
      break;
    }
  }

  // Fallback: Look for standalone "24 cookies" type patterns at the end of lines
  if (!metadata.servings) {
    const standaloneYieldMatch = normalizedText.match(/\b(\d+)\s+(cookies?|servings?|portions?|pieces?|bars?|muffins?|cupcakes?|slices?|squares?|rolls?)\b/i);
    if (standaloneYieldMatch) {
      metadata.servings = standaloneYieldMatch[0].trim();
    }
  }

  return metadata;
}

/**
 * Normalize time string to consistent format
 * @param {string} timeStr - Raw time string like "20 min" or "1 hr 15 min"
 * @returns {string} Normalized time string
 */
function normalizeTimeString(timeStr) {
  if (!timeStr) return null;

  let result = timeStr.trim()
    // Normalize hour formats
    .replace(/\bh\b/gi, "hr")
    .replace(/\bhours?\b/gi, "hr")
    // Normalize minute formats
    .replace(/\bm\b/gi, "min")
    .replace(/\bminutes?\b/gi, "min")
    .replace(/\bmins?\b/gi, "min")
    // Clean up spacing
    .replace(/\s+/g, " ")
    // Handle decimal hours (1.5 hr -> 1 hr 30 min)
    .replace(/(\d+)\.5\s*hr/gi, (match, hrs) => {
      return `${hrs} hr 30 min`;
    })
    .replace(/(\d+)\.25\s*hr/gi, (match, hrs) => {
      return `${hrs} hr 15 min`;
    })
    .replace(/(\d+)\.75\s*hr/gi, (match, hrs) => {
      return `${hrs} hr 45 min`;
    });

  // If result is just a number, assume minutes
  if (/^\d+$/.test(result)) {
    result = result + " min";
  }

  return result;
}

/**
 * Check if a line is a metadata line (prep time, cook time, yield, etc.)
 * @param {string} line
 * @returns {boolean}
 */
function isMetadataLine(line) {
  const trimmed = line.trim();

  // Empty lines are not metadata
  if (!trimmed) return false;

  // Check for time/yield labels
  if (/\b(prep\s*(?:time)?|cook\s*(?:time)?|bake\s*(?:time)?|total\s*(?:time)?|ready\s+in|time)\s*[:=]?\s*\d/i.test(trimmed)) {
    return true;
  }

  // Check for yield/servings patterns
  if (/\b(yield|yields|serves|servings?|makes|portions?)\s*[:=]?\s*\d/i.test(trimmed)) {
    return true;
  }

  // Check for standalone time labels
  if (/^(prep|cook|bake|total)\s*(time)?$/i.test(trimmed)) {
    return true;
  }

  // Check for lines that are primarily time values grouped together
  // (OCR often reads a row of time columns as: "20 min 11 min 1 hr 15 min")
  const timeCount = (trimmed.match(/\d+\s*(?:hr|hour|hours?|min|mins?|minutes?|h|m)\b/gi) || []).length;
  if (timeCount >= 2 && trimmed.length < 60) {
    // Make sure it's not an instruction that just mentions times
    if (!COOKING_VERBS.test(trimmed)) {
      return true;
    }
  }

  // Check for calorie/nutrition lines
  if (/\b(calories?|cal|kcal|carbs?|protein|fat|sodium|fiber)\s*[:=]?\s*\d/i.test(trimmed)) {
    return true;
  }

  // Check for rating/difficulty lines
  if (/\b(rating|difficulty|skill\s*level|stars?)\s*[:=]/i.test(trimmed)) {
    return true;
  }

  // Check for author/source lines at the start
  if (/^(by|from|source|author|recipe\s*by|adapted\s*from)\s*[:=]?\s*/i.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * SECTION MARKERS - Patterns that indicate the start of a recipe section
 */
const SECTION_PATTERNS = {
  ingredients: /^(ingredients?|what you(?:'ll)? need|you(?:'ll)? need|shopping list)[:.]?\s*$/i,
  instructions: /^(instructions?|directions?|method|steps?|how to (?:make|prepare)|preparation|procedure)[:.]?\s*$/i,
};

/**
 * Find all section boundaries in the text
 * Returns an object with indices of where each section starts
 * @param {string[]} lines - Array of text lines
 * @returns {Object} Section boundaries with start indices
 */
function findSectionBoundaries(lines) {
  const sections = {
    title: { start: 0, end: -1 },
    metadata: { lines: [] },
    ingredients: { start: -1, end: -1, explicit: false },
    instructions: { start: -1, end: -1, explicit: false },
  };

  // First pass: Find explicit section headers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (SECTION_PATTERNS.ingredients.test(line)) {
      sections.ingredients.start = i + 1; // Section starts AFTER the header
      sections.ingredients.explicit = true;
    } else if (SECTION_PATTERNS.instructions.test(line)) {
      sections.instructions.start = i + 1;
      sections.instructions.explicit = true;

      // If we found instructions and ingredients was already found, end ingredients section
      if (sections.ingredients.start !== -1 && sections.ingredients.end === -1) {
        sections.ingredients.end = i;
      }
    }
  }

  // If no explicit sections found, we'll need to infer them
  if (sections.ingredients.start === -1 && sections.instructions.start === -1) {
    // Look for the first ingredient-like line to start ingredients section
    // and first instruction-like line to start instructions section
    let foundFirstIngredient = false;
    let foundFirstInstruction = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip metadata and title candidates in the first few lines
      if (i < 3 && !foundFirstIngredient) continue;

      if (!foundFirstIngredient && looksLikeIngredient(line) && !looksLikeInstruction(line)) {
        sections.ingredients.start = i;
        foundFirstIngredient = true;
      }

      if (!foundFirstInstruction && looksLikeInstruction(line)) {
        sections.instructions.start = i;
        foundFirstInstruction = true;

        // If instructions start and ingredients were found, end ingredients
        if (sections.ingredients.start !== -1 && sections.ingredients.end === -1) {
          sections.ingredients.end = i;
        }
      }
    }
  }

  // Set default endings if not determined
  if (sections.ingredients.start !== -1 && sections.ingredients.end === -1) {
    // Ingredients end at instructions start, or at end of document
    sections.ingredients.end = sections.instructions.start !== -1
      ? sections.instructions.start
      : lines.length;
  }

  if (sections.instructions.start !== -1 && sections.instructions.end === -1) {
    sections.instructions.end = lines.length;
  }

  return sections;
}

/**
 * Clean and normalize OCR text
 * Handles common OCR artifacts and formatting issues
 * @param {string} text - Raw OCR text
 * @returns {string} Cleaned text
 */
function cleanOcrText(text) {
  return text
    // Normalize line breaks
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove excessive whitespace but preserve paragraph breaks
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    // Clean up bullet points and list markers
    .replace(/^[•●○◦▪▸►]\s*/gm, '- ')
    .replace(/^[oO]\s+(?=[A-Z])/gm, '- ') // "o " at start of line is likely a bullet
    .trim();
}

/**
 * Extract title from the beginning of the text
 * @param {string[]} lines - Array of text lines
 * @param {Object} metadata - Extracted metadata
 * @returns {Object} Title and description
 */
function extractTitle(lines, metadata) {
  let title = "Untitled Recipe";
  let description = "";

  // Look at the first several lines for the title
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) continue;

    // Skip metadata lines
    if (isMetadataLine(line)) continue;

    // Skip section headers
    if (SECTION_PATTERNS.ingredients.test(line) || SECTION_PATTERNS.instructions.test(line)) continue;

    // Skip lines that look like ingredients (start with measurements)
    if (/^[\d½¼¾⅓⅔⅛]+\s*[\/\d]*\s*(cup|tbsp|tsp|oz|lb|g|kg|ml)/i.test(line)) continue;

    // Skip lines that look like instructions (numbered steps)
    if (/^\d+[\.\)]\s+[A-Z]/i.test(line) && line.length > 30) continue;

    // Skip very short lines (probably OCR artifacts)
    if (line.length < 4) continue;

    // First good line is likely the title
    if (title === "Untitled Recipe") {
      // Clean up title - remove trailing punctuation, fix case
      title = line
        .replace(/[:\.]$/, '')
        .replace(/^recipe\s*[:.\-]?\s*/i, '') // Remove "Recipe:" prefix
        .trim();

      // If title is too long, it's probably not the title
      if (title.length > 100) {
        title = title.substring(0, 100).trim();
      }
      continue;
    }

    // Second good line might be description (but not too long, not a section header)
    if (!description && line.length > 15 && line.length < 200) {
      // Not a section header
      if (!/^(ingredients?|instructions?|directions?|prep|cook|total|yield)/i.test(line)) {
        description = line;
        break;
      }
    }
  }

  return { title, description };
}

/**
 * Parse lines within the ingredients section
 * @param {string[]} lines - Lines in the ingredients section
 * @returns {string[]} Cleaned ingredient lines
 */
function parseIngredientSection(lines) {
  const ingredients = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Skip section headers that might be in the section
    if (SECTION_PATTERNS.ingredients.test(trimmed) || SECTION_PATTERNS.instructions.test(trimmed)) continue;

    // Skip metadata lines
    if (isMetadataLine(trimmed)) continue;

    // Skip lines that look more like instructions
    if (looksLikeInstruction(trimmed) && !looksLikeIngredient(trimmed)) continue;

    // Skip obvious non-ingredients
    if (/^(note|tip|hint|variation)s?[:.]?\s/i.test(trimmed)) continue;

    // Clean the ingredient line
    const cleaned = cleanIngredientLine(trimmed);

    // Only add if there's substance
    if (cleaned.length > 1) {
      ingredients.push(cleaned);
    }
  }

  return ingredients;
}

/**
 * Parse lines within the instructions section
 * @param {string[]} lines - Lines in the instructions section
 * @returns {string[]} Cleaned instruction lines
 */
function parseInstructionSection(lines) {
  const instructions = [];
  let currentStep = "";
  let stepNumber = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines (but might indicate paragraph break)
    if (!trimmed) {
      // If we have a current step, finish it
      if (currentStep) {
        instructions.push(currentStep);
        currentStep = "";
      }
      continue;
    }

    // Skip section headers
    if (SECTION_PATTERNS.ingredients.test(trimmed) || SECTION_PATTERNS.instructions.test(trimmed)) continue;

    // Skip metadata lines
    if (isMetadataLine(trimmed)) continue;

    // Check if this is a new numbered step
    const stepMatch = trimmed.match(/^(?:step\s*)?(\d+)[\.\):\-]?\s*(.+)/i);
    if (stepMatch) {
      // Save previous step if any
      if (currentStep) {
        instructions.push(currentStep);
      }
      stepNumber = parseInt(stepMatch[1], 10);
      currentStep = trimmed;
    } else if (currentStep) {
      // Continue current step (multi-line instruction)
      currentStep += " " + trimmed;
    } else {
      // First line of an unnumbered instruction
      currentStep = trimmed;
    }
  }

  // Don't forget the last step
  if (currentStep) {
    instructions.push(currentStep);
  }

  // Format instructions with numbers if they don't have them
  return instructions.map((step, index) => {
    if (/^\d+[\.\)]?\s/.test(step) || /^step\s+\d+/i.test(step)) {
      return step;
    }
    return `${index + 1}. ${step}`;
  });
}

/**
 * Parse unstructured text (from PDF or OCR) into recipe structure
 * Uses a two-pass section-based approach for better accuracy
 * @param {string} text - Raw text to parse
 * @param {number} baseConfidence - Base confidence score
 * @returns {Object} Parsed recipe data
 */
function parseUnstructuredText(text, baseConfidence) {
  const warnings = [];

  // Step 1: Clean and normalize the text
  const cleanedText = cleanOcrText(text);

  // Step 2: Extract metadata FIRST (prep time, cook time, servings)
  const metadata = extractRecipeMetadata(cleanedText);

  // Step 3: Split into lines and clean each line
  const lines = cleanedText
    .split(/\n/)
    .map((line) => sanitizeText(line))
    .filter((line) => line.trim());

  // Step 4: Find section boundaries
  const sections = findSectionBoundaries(lines);

  // Step 5: Extract title from the beginning
  const { title, description } = extractTitle(lines, metadata);

  // Step 6: Parse ingredients section
  let ingredientLines = [];
  if (sections.ingredients.start !== -1) {
    const ingredientSectionLines = lines.slice(
      sections.ingredients.start,
      sections.ingredients.end !== -1 ? sections.ingredients.end : undefined
    );
    ingredientLines = parseIngredientSection(ingredientSectionLines);
  }

  // Step 7: Parse instructions section
  let instructionLines = [];
  if (sections.instructions.start !== -1) {
    const instructionSectionLines = lines.slice(
      sections.instructions.start,
      sections.instructions.end !== -1 ? sections.instructions.end : undefined
    );
    instructionLines = parseInstructionSection(instructionSectionLines);
  }

  // Step 8: Fallback - if no sections found, try to identify them by content
  if (ingredientLines.length === 0 && instructionLines.length === 0) {
    // Fallback: classify each line individually
    for (const line of lines) {
      // Skip title and metadata
      if (line === title || line === description) continue;
      if (isMetadataLine(line)) continue;
      if (SECTION_PATTERNS.ingredients.test(line) || SECTION_PATTERNS.instructions.test(line)) continue;

      // Classify line
      if (looksLikeInstruction(line) && !looksLikeIngredient(line)) {
        instructionLines.push(line);
      } else if (looksLikeIngredient(line)) {
        ingredientLines.push(cleanIngredientLine(line));
      }
    }

    // Format instructions with numbers
    instructionLines = instructionLines.map((step, index) => {
      if (/^\d+[\.\)]?\s/.test(step)) {
        return step;
      }
      return `${index + 1}. ${step}`;
    });

    if (ingredientLines.length === 0 && instructionLines.length === 0) {
      warnings.push("Could not identify recipe structure. Please organize the content manually.");
    }
  }

  // Add warnings for missing content
  if (ingredientLines.length === 0) {
    warnings.push("Could not identify ingredients. Please add them manually.");
  }
  if (instructionLines.length === 0) {
    warnings.push("Could not identify instructions. Please add them manually.");
  }

  // Calculate confidence based on what we found
  let confidence = baseConfidence;
  if (ingredientLines.length > 0) confidence += 0.1;
  if (instructionLines.length > 0) confidence += 0.1;
  if (title !== "Untitled Recipe") confidence += 0.1;
  if (sections.ingredients.explicit || sections.instructions.explicit) confidence += 0.1;
  if (metadata.prepTime || metadata.cookTime) confidence += 0.05;
  if (metadata.servings) confidence += 0.05;
  confidence = Math.min(confidence, 0.9);

  return {
    title,
    description,
    ingredients: ingredientLines.join("\n"),
    instructions: instructionLines.join("\n"),
    prepTime: metadata.prepTime,
    cookTime: metadata.cookTime,
    servings: metadata.servings,
    sourceUrl: "",
    confidence,
    warnings,
  };
}

/**
 * Clean up an ingredient line by removing bullet points, asterisks, etc.
 * @param {string} line
 * @returns {string}
 */
function cleanIngredientLine(line) {
  return line
    .replace(/^[\*\-\•\+]\s*/, "") // Remove leading bullets
    .replace(/^\d+[\.\)]\s*(?!\d)/, "") // Remove leading numbers if not part of quantity
    .trim();
}

/**
 * Common cooking verbs that indicate an instruction step
 */
const COOKING_VERBS = /\b(preheat|mix|combine|stir|add|pour|bake|cook|heat|simmer|boil|fry|saute|sauté|whisk|blend|chop|dice|slice|fold|knead|let|place|remove|serve|set|transfer|cover|brown|beat|cream|melt|cool|chill|refrigerate|freeze|drain|rinse|wash|peel|grate|mince|julienne|marinate|season|brush|grease|line|spread|layer|arrange|scoop|shape|roll|flatten|press|cut|trim|score|stuff|fill|top|garnish|sprinkle|drizzle|toss|coat|dip|dredge|bread|sift|measure|weigh|dissolve|proof|rise|rest|stand|steep|strain|puree|mash|crush|grind|process|pulse|zest|juice|squeeze|crack|separate|reserve|bring|reduce|form|divide|repeat|continue|flip|turn|rotate|insert|check|test|ensure|make|prepare|create|assemble|stack|wrap|seal|pat|scrape|shake|swirl|lower|raise|adjust|note|enjoy|taste|allow)\b/i;

/**
 * Common measurement units for ingredients
 */
const MEASUREMENT_UNITS = /\b(cups?|tbsps?|tsps?|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g|kg|kilograms?|ml|milliliters?|liters?|l|pinch|dash|handful|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|pieces?|whole|halves?|quarters?|bunch|bunches|head|heads|sprigs?|stalks?|leaves|ears?|bags?|boxes?|bottles?|containers?|drops?|scoops?|sheets?|rounds?|squares?|cubes?|strips?|wedges?|segments?|links?|patties?|filets?|breasts?|thighs?|legs?|wings?|loaves?|loaf|dozen|doz)\b/i;

/**
 * Numeric patterns including fractions
 */
const NUMBER_PATTERN = /^[\d½¼¾⅓⅔⅛⅜⅝⅞][\d\/\s½¼¾⅓⅔⅛⅜⅝⅞\-to]*/;

/**
 * Check if a line looks like an ingredient
 * @param {string} line
 * @returns {boolean}
 */
function looksLikeIngredient(line) {
  const trimmed = line.trim();

  // Empty or very short lines are not ingredients
  if (trimmed.length < 3) return false;

  // Exclude metadata lines
  if (isMetadataLine(trimmed)) return false;

  // Exclude section headers
  if (SECTION_PATTERNS.ingredients.test(trimmed) || SECTION_PATTERNS.instructions.test(trimmed)) return false;

  // Exclude lines that are clearly time-related
  if (/\b(prep|cook|total)\s*time\b/i.test(trimmed)) return false;
  if (/^(yield|serves|servings|makes)\b/i.test(trimmed)) return false;

  // Exclude lines with multiple time values (metadata row)
  const timeMatches = trimmed.match(/\d+\s*(?:hr|hour|min|minute)/gi);
  if (timeMatches && timeMatches.length >= 2) return false;

  // STRONG INDICATOR: Starts with quantity + measurement unit
  // Examples: "2 cups flour", "1/2 tsp salt", "½ cup sugar"
  const quantityAndMeasure = new RegExp(
    `^[\\d½¼¾⅓⅔⅛⅜⅝⅞][\\d\\/\\s½¼¾⅓⅔⅛⅜⅝⅞\\-to]*\\s*${MEASUREMENT_UNITS.source}`,
    'i'
  );
  if (quantityAndMeasure.test(trimmed)) {
    return true;
  }

  // STRONG EXCLUSION: Numbered step with cooking verb
  // Examples: "1. Brown the butter", "2. Mix until smooth"
  if (/^(?:step\s*)?\d+[\.\):\-]?\s+/i.test(trimmed)) {
    // This is a numbered line - check if it's an instruction
    if (COOKING_VERBS.test(trimmed)) {
      return false; // It's an instruction
    }
    // Check if it has a measurement immediately after the number
    // "1. 2 cups flour" is weird but could be an ingredient
    if (!new RegExp(`^\\d+[\\.\\)]\\s+[\\d½¼¾⅓⅔⅛⅜⅝⅞].*${MEASUREMENT_UNITS.source}`, 'i').test(trimmed)) {
      // Numbered line without measurement - likely instruction
      if (trimmed.length > 25) {
        return false;
      }
    }
  }

  // MEDIUM INDICATOR: Contains measurement unit anywhere
  if (MEASUREMENT_UNITS.test(trimmed)) {
    // But not if it's clearly an instruction
    const verbCount = (trimmed.match(COOKING_VERBS) || []).length;
    if (verbCount >= 2) {
      return false; // Multiple cooking verbs = instruction
    }
    return true;
  }

  // WEAK INDICATOR: Starts with a number (but not a step number)
  if (/^[\d½¼¾⅓⅔⅛⅜⅝⅞]/.test(trimmed)) {
    // Skip if it's just a time/serving count
    if (/^\d+\s*(hr|hour|min|minute|cookie|serving|portion|people|guest)/i.test(trimmed)) {
      return false;
    }
    // Skip if it's a step number pattern
    if (/^\d+[\.\):\-]\s+[A-Za-z]/i.test(trimmed) && trimmed.length > 20) {
      return false;
    }
    // Short lines starting with numbers could be ingredients
    if (trimmed.length < 50 && !COOKING_VERBS.test(trimmed)) {
      return true;
    }
  }

  // WEAK INDICATOR: Common ingredient names without measurements
  // (for "salt and pepper to taste" style)
  const commonIngredients = /^(salt|pepper|oil|butter|sugar|flour|eggs?|milk|water|cream|vanilla|cinnamon|nutmeg|garlic|onion|olive oil|vegetable oil|cooking spray)\b/i;
  if (commonIngredients.test(trimmed) && trimmed.length < 60) {
    return true;
  }

  return false;
}

/**
 * Check if a line looks like an instruction step
 * @param {string} line
 * @returns {boolean}
 */
function looksLikeInstruction(line) {
  const trimmed = line.trim();

  // Empty or very short lines are not instructions
  if (trimmed.length < 10) return false;

  // Exclude metadata lines
  if (isMetadataLine(trimmed)) return false;

  // Exclude section headers
  if (SECTION_PATTERNS.ingredients.test(trimmed) || SECTION_PATTERNS.instructions.test(trimmed)) return false;

  // STRONG INDICATOR: Numbered step with cooking verb
  // Examples: "1. Brown the butter", "Step 2: Mix until smooth"
  if (/^(?:step\s*)?\d+[\.\):\-]?\s+/i.test(trimmed) && COOKING_VERBS.test(trimmed)) {
    return true;
  }

  // STRONG INDICATOR: Starts with a cooking verb
  // Examples: "Preheat oven to 350°F", "Mix dry ingredients together"
  if (/^(preheat|mix|combine|stir|add|pour|bake|cook|heat|simmer|boil|fry|saute|sauté|whisk|blend|chop|dice|slice|fold|knead|let|place|remove|serve|set|transfer|cover|brown|beat|cream|melt|cool|chill|refrigerate|freeze|drain|rinse|wash|peel|grate|mince|julienne|marinate|season|brush|grease|line|spread|layer|arrange|scoop|shape|roll|flatten|press|cut|trim|score|stuff|fill|top|garnish|sprinkle|drizzle|toss|coat|dip|dredge|bread|sift|measure|weigh|dissolve|proof|rise|rest|stand|steep|strain|puree|mash|crush|grind|process|pulse|zest|juice|squeeze|crack|separate|reserve|bring|reduce|form|divide|repeat|continue|flip|turn|rotate|insert|check|test|ensure|make|prepare|create|assemble|stack|wrap|seal|pat|scrape|shake|swirl|lower|raise|adjust|note|enjoy|taste|allow|using|once|when|after|before|while|until|carefully|gently|slowly|quickly|immediately|meanwhile|gradually|finally|first|next|then)/i.test(trimmed)) {
    // Make sure it's not too short (could be "Add salt" which might be ambiguous)
    if (trimmed.length > 15) {
      return true;
    }
  }

  // STRONG INDICATOR: Numbered step that's long and doesn't start with measurement
  if (/^\d+[\.\)]\s+[A-Za-z]/i.test(trimmed) && trimmed.length > 25) {
    // Make sure it's not an ingredient line
    if (!new RegExp(`^\\d+[\\.\\)]\\s+[\\d½¼¾⅓⅔⅛⅜⅝⅞].*${MEASUREMENT_UNITS.source}`, 'i').test(trimmed)) {
      return true;
    }
  }

  // MEDIUM INDICATOR: Multiple cooking verbs in the line
  const verbMatches = trimmed.match(COOKING_VERBS);
  if (verbMatches && verbMatches.length >= 2) {
    return true;
  }

  // MEDIUM INDICATOR: Contains timing phrases typical of instructions
  if (/\b(until|for\s+\d+\s*(min|minute|hour|second)|degrees?|°[FC]|minutes?|hours?)\b/i.test(trimmed) && COOKING_VERBS.test(trimmed)) {
    return true;
  }

  // WEAK INDICATOR: Long line with at least one cooking verb and no measurements
  if (trimmed.length > 40 && COOKING_VERBS.test(trimmed) && !MEASUREMENT_UNITS.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Detect file type and route to appropriate parser
 * @param {Buffer} fileBuffer - File contents
 * @param {string} originalName - Original filename
 * @param {string} mimeType - Declared MIME type
 * @returns {Promise<Object>} Parsed recipe data
 */
export async function importRecipe(fileBuffer, originalName, mimeType) {
  // Validate file using magic numbers
  const validation = await validateImportFile(fileBuffer);

  if (!validation.valid) {
    throw new Error("Unsupported file type. Please upload a JSON, PDF, or image file.");
  }

  const actualMime = validation.mime;

  // Route to appropriate parser
  if (actualMime === "application/json") {
    return await parseJsonLd(fileBuffer);
  }

  if (actualMime === "application/pdf") {
    return await parsePdf(fileBuffer);
  }

  if (actualMime.startsWith("image/")) {
    return await parseImage(fileBuffer, actualMime);
  }

  throw new Error("Unsupported file type. Please upload a JSON, PDF, or image file.");
}
