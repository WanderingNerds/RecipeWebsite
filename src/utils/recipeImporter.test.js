import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  parseJsonLd,
  parseImage,
  validateImportFile,
  normalizeImageForOcr,
  OCR_MAX_INPUT_PIXELS,
  OCR_MAX_DIMENSION,
  SUPPORTED_MIME_TYPES,
  OCR_TIMEOUT_MS,
} from "./recipeImporter.js";
import { OCR_TIMEOUT_MS as CONFIG_OCR_TIMEOUT_MS } from "../config/functionLimits.js";

// Helper to create a buffer from JSON
function jsonBuffer(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8");
}

// =============================================================================
// validateImportFile tests
// =============================================================================

test("validateImportFile accepts valid JSON", async () => {
  const buffer = jsonBuffer({ "@type": "Recipe", name: "Test" });
  const result = await validateImportFile(buffer);
  assert.equal(result.valid, true);
  assert.equal(result.mime, "application/json");
});

test("validateImportFile rejects invalid JSON", async () => {
  const buffer = Buffer.from("not valid json {{{", "utf8");
  const result = await validateImportFile(buffer);
  assert.equal(result.valid, false);
});

test("validateImportFile rejects empty buffer", async () => {
  const buffer = Buffer.from("", "utf8");
  const result = await validateImportFile(buffer);
  assert.equal(result.valid, false);
});

// =============================================================================
// parseJsonLd tests - Valid Schema.org Recipe formats
// =============================================================================

test("parseJsonLd parses valid Schema.org Recipe with HowToStep instructions", async () => {
  const recipe = {
    "@context": "https://schema.org/",
    "@type": "Recipe",
    name: "Chocolate Chip Cookies",
    description: "Classic homemade chocolate chip cookies",
    recipeIngredient: [
      "2 cups all-purpose flour",
      "1 cup butter, softened",
      "1 cup chocolate chips",
    ],
    recipeInstructions: [
      { "@type": "HowToStep", text: "Preheat oven to 375F" },
      { "@type": "HowToStep", text: "Mix flour and butter" },
      { "@type": "HowToStep", text: "Add chocolate chips and bake" },
    ],
    prepTime: "PT15M",
    cookTime: "PT12M",
    recipeYield: "24 cookies",
  };

  const result = await parseJsonLd(jsonBuffer(recipe));

  assert.equal(result.title, "Chocolate Chip Cookies");
  assert.equal(result.description, "Classic homemade chocolate chip cookies");
  assert.ok(result.ingredients.includes("2 cups all-purpose flour"));
  assert.ok(result.ingredients.includes("1 cup butter, softened"));
  assert.ok(result.ingredients.includes("1 cup chocolate chips"));
  assert.ok(result.instructions.includes("Preheat oven to 375F"));
  assert.ok(result.instructions.includes("Mix flour and butter"));
  assert.equal(result.prepTime, "15 min");
  assert.equal(result.cookTime, "12 min");
  assert.equal(result.servings, "24 cookies");
  assert.ok(result.confidence >= 0.9);
  assert.deepEqual(result.warnings, []);
});

test("parseJsonLd parses Recipe with string instructions (no HowToStep)", async () => {
  const recipe = {
    "@type": "Recipe",
    name: "Simple Pasta",
    recipeIngredient: ["200g pasta", "1 tbsp olive oil"],
    recipeInstructions: [
      "Boil water and cook pasta",
      "Drain and add olive oil",
    ],
  };

  const result = await parseJsonLd(jsonBuffer(recipe));

  assert.equal(result.title, "Simple Pasta");
  assert.ok(result.ingredients.includes("200g pasta"));
  assert.ok(result.instructions.includes("1. Boil water and cook pasta"));
  assert.ok(result.instructions.includes("2. Drain and add olive oil"));
});

test("parseJsonLd handles array-wrapped Recipe", async () => {
  const recipes = [
    {
      "@type": "Recipe",
      name: "Wrapped Recipe",
      recipeIngredient: ["1 cup sugar"],
      recipeInstructions: ["Mix well"],
    },
  ];

  const result = await parseJsonLd(jsonBuffer(recipes));

  assert.equal(result.title, "Wrapped Recipe");
});

test("parseJsonLd handles @graph structure", async () => {
  const graphData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: "Some Page" },
      {
        "@type": "Recipe",
        name: "Graph Recipe",
        recipeIngredient: ["1 egg"],
        recipeInstructions: ["Cook the egg"],
      },
    ],
  };

  const result = await parseJsonLd(jsonBuffer(graphData));

  assert.equal(result.title, "Graph Recipe");
});

test("parseJsonLd parses ISO 8601 durations correctly", async () => {
  const recipe = {
    "@type": "Recipe",
    name: "Duration Test",
    recipeIngredient: ["water"],
    recipeInstructions: ["wait"],
    prepTime: "PT1H30M",
    cookTime: "PT45M",
  };

  const result = await parseJsonLd(jsonBuffer(recipe));

  assert.equal(result.prepTime, "1 hour 30 min");
  assert.equal(result.cookTime, "45 min");
});

test("parseJsonLd handles hours-only duration", async () => {
  const recipe = {
    "@type": "Recipe",
    name: "Long Cook",
    recipeIngredient: ["meat"],
    recipeInstructions: ["slow cook"],
    cookTime: "PT3H",
  };

  const result = await parseJsonLd(jsonBuffer(recipe));

  assert.equal(result.cookTime, "3 hours");
});

// =============================================================================
// parseJsonLd tests - Error handling
// =============================================================================

test("parseJsonLd throws for non-Recipe JSON", async () => {
  const notRecipe = {
    "@type": "Article",
    name: "Not a recipe",
  };

  await assert.rejects(
    parseJsonLd(jsonBuffer(notRecipe)),
    /JSON does not contain a Recipe schema/
  );
});

test("parseJsonLd throws for malformed JSON", async () => {
  const buffer = Buffer.from("{ invalid json }", "utf8");

  await assert.rejects(parseJsonLd(buffer), /Invalid JSON format/);
});

test("parseJsonLd adds warning for missing title", async () => {
  const recipe = {
    "@type": "Recipe",
    recipeIngredient: ["1 cup flour"],
    recipeInstructions: ["mix"],
  };

  const result = await parseJsonLd(jsonBuffer(recipe));

  assert.equal(result.title, "Untitled Recipe");
  assert.ok(result.warnings.some((w) => w.includes("title")));
});

test("parseJsonLd adds warning for missing ingredients", async () => {
  const recipe = {
    "@type": "Recipe",
    name: "No Ingredients",
    recipeInstructions: ["do something"],
  };

  const result = await parseJsonLd(jsonBuffer(recipe));

  assert.ok(result.warnings.some((w) => w.includes("ingredients")));
});

test("parseJsonLd adds warning for missing instructions", async () => {
  const recipe = {
    "@type": "Recipe",
    name: "No Instructions",
    recipeIngredient: ["1 cup flour"],
  };

  const result = await parseJsonLd(jsonBuffer(recipe));

  assert.ok(result.warnings.some((w) => w.includes("instructions")));
});

// =============================================================================
// parseJsonLd tests - Sanitization
// =============================================================================

test("parseJsonLd sanitizes HTML tags from content", async () => {
  const recipe = {
    "@type": "Recipe",
    name: "<script>alert('xss')</script>Cookie Recipe",
    description: "<p>A <strong>great</strong> recipe</p>",
    recipeIngredient: ["<em>1 cup</em> flour"],
    recipeInstructions: [{ "@type": "HowToStep", text: "<div>Mix well</div>" }],
  };

  const result = await parseJsonLd(jsonBuffer(recipe));

  assert.ok(!result.title.includes("<script>"));
  assert.ok(!result.title.includes("</script>"));
  assert.equal(result.title, "alert('xss')Cookie Recipe");
  assert.ok(!result.description.includes("<p>"));
  assert.ok(!result.description.includes("<strong>"));
  assert.ok(!result.ingredients.includes("<em>"));
  assert.ok(!result.instructions.includes("<div>"));
});

test("parseJsonLd handles HTML entities", async () => {
  const recipe = {
    "@type": "Recipe",
    name: "Tom &amp; Jerry's Cookies",
    recipeIngredient: ["1 &quot;cup&quot; flour"],
    recipeInstructions: ["Mix &gt; Bake"],
  };

  const result = await parseJsonLd(jsonBuffer(recipe));

  assert.equal(result.title, "Tom & Jerry's Cookies");
  assert.ok(result.ingredients.includes('1 "cup" flour'));
  assert.ok(result.instructions.includes("Mix > Bake"));
});

// =============================================================================
// SUPPORTED_MIME_TYPES tests
// =============================================================================

test("SUPPORTED_MIME_TYPES includes expected types", () => {
  assert.ok(SUPPORTED_MIME_TYPES.includes("application/json"));
  assert.ok(SUPPORTED_MIME_TYPES.includes("application/pdf"));
  assert.ok(SUPPORTED_MIME_TYPES.includes("image/jpeg"));
  assert.ok(SUPPORTED_MIME_TYPES.includes("image/png"));
  assert.ok(SUPPORTED_MIME_TYPES.includes("image/webp"));
});

test("SUPPORTED_MIME_TYPES does not include unsupported types", () => {
  assert.ok(!SUPPORTED_MIME_TYPES.includes("text/plain"));
  assert.ok(!SUPPORTED_MIME_TYPES.includes("application/zip"));
  assert.ok(!SUPPORTED_MIME_TYPES.includes("image/gif"));
});

// =============================================================================
// OCR image normalization tests (REW-95)
// =============================================================================

// Generate a small image fixture in-memory rather than committing a binary.
// Uses a noise-free solid fill; content does not matter, only dimensions.
function makeImage(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 180, b: 160 },
    },
  })
    .png()
    .toBuffer();
}

// Minimal stand-in for a Tesseract result object.
function ocrResult(text) {
  return { data: { text } };
}

const OCR_SAMPLE_TEXT = [
  "Butter Cookies",
  "2 cups flour",
  "1 cup butter",
  "Mix the flour and butter together.",
  "Bake until golden brown.",
].join("\n");

test("OCR tuning constants have their documented values", () => {
  assert.equal(OCR_MAX_INPUT_PIXELS, 40000000);
  assert.equal(OCR_MAX_DIMENSION, 2000);
});

test("normalizeImageForOcr downscales images larger than the max dimension", async () => {
  const input = await makeImage(2400, 1200);
  const output = await normalizeImageForOcr(input);
  const metadata = await sharp(output).metadata();

  assert.ok(metadata.width <= OCR_MAX_DIMENSION, `width ${metadata.width} exceeds cap`);
  assert.ok(metadata.height <= OCR_MAX_DIMENSION, `height ${metadata.height} exceeds cap`);
});

test("normalizeImageForOcr does not enlarge small images", async () => {
  const input = await makeImage(50, 50);
  const output = await normalizeImageForOcr(input);
  const metadata = await sharp(output).metadata();

  assert.equal(metadata.width, 50);
  assert.equal(metadata.height, 50);
});

test("normalizeImageForOcr outputs a single-channel grayscale image", async () => {
  const input = await makeImage(120, 90);
  const output = await normalizeImageForOcr(input);
  const metadata = await sharp(output).metadata();

  assert.equal(metadata.channels, 1);
});

test("normalizeImageForOcr encodes to PNG regardless of input format", async () => {
  const jpegInput = await sharp({
    create: { width: 80, height: 60, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .jpeg()
    .toBuffer();

  const output = await normalizeImageForOcr(jpegInput);
  const metadata = await sharp(output).metadata();

  assert.equal(metadata.format, "png");
});

test("normalizeImageForOcr rejects input above the decoded-pixel cap", async () => {
  // 300x300 = 90,000 decoded pixels, against an injected cap of 1,000.
  // Proves the rejection path without materializing a real gigapixel bomb.
  const input = await makeImage(300, 300);

  await assert.rejects(
    () => normalizeImageForOcr(input, { maxInputPixels: 1000 }),
    // Assert the actual reason: a bare `instanceof Error` would also be
    // satisfied by any unrelated sharp failure.
    (error) => /exceeds pixel limit/i.test(error.message)
  );
});

test("normalizeImageForOcr accepts input below the decoded-pixel cap", async () => {
  const input = await makeImage(300, 300);
  const output = await normalizeImageForOcr(input, { maxInputPixels: 90000 });

  assert.ok(Buffer.isBuffer(output));
  assert.ok(output.length > 0);
});

test("normalizeImageForOcr rejects a corrupt buffer through the real sharp path", async () => {
  // No injected stub: this drives production sharp with undecodable bytes to
  // prove the helper surfaces a rejection (which parseImage maps to the
  // generic client message) rather than resolving or hanging.
  await assert.rejects(() => normalizeImageForOcr(Buffer.from("not an image")));
});

test("parseImage passes the normalized buffer to OCR, not the raw input", async () => {
  const input = await makeImage(2400, 1200);
  let received = null;

  await parseImage(input, "image/png", {
    recognize: (buffer) => {
      received = buffer;
      return Promise.resolve(ocrResult(OCR_SAMPLE_TEXT));
    },
  });

  assert.ok(Buffer.isBuffer(received));
  assert.notStrictEqual(received, input);

  const metadata = await sharp(received).metadata();
  assert.ok(metadata.width <= OCR_MAX_DIMENSION);
  assert.ok(metadata.height <= OCR_MAX_DIMENSION);
  assert.equal(metadata.channels, 1);
});

test("parseImage surfaces the generic message when normalization throws", async () => {
  await assert.rejects(
    () =>
      parseImage(Buffer.from("not an image"), "image/png", {
        normalize: () => {
          throw new Error("Input image exceeds pixel limit");
        },
        recognize: () => Promise.resolve(ocrResult(OCR_SAMPLE_TEXT)),
      }),
    (error) => {
      assert.equal(error.message, "Could not process image. Please try a different image.");
      return true;
    }
  );
});

test("parseImage does not leak the sharp error text on normalization failure", async () => {
  const sharpMessage = "Input image exceeds pixel limit 1000 (4000x3000)";

  await assert.rejects(
    () =>
      parseImage(Buffer.from("not an image"), "image/png", {
        normalize: () => Promise.reject(new Error(sharpMessage)),
        recognize: () => Promise.resolve(ocrResult(OCR_SAMPLE_TEXT)),
      }),
    (error) => {
      assert.ok(!error.message.includes(sharpMessage));
      assert.ok(!error.message.includes("pixel limit"));
      assert.ok(!error.message.includes("4000x3000"));
      return true;
    }
  );
});

test("parseImage does not report a normalization failure as a timeout", async () => {
  await assert.rejects(
    () =>
      parseImage(Buffer.from("not an image"), "image/png", {
        normalize: () => Promise.reject(new Error("Input image exceeds pixel limit")),
        recognize: () => Promise.resolve(ocrResult(OCR_SAMPLE_TEXT)),
      }),
    (error) => {
      assert.notEqual(error.message, "Image processing timed out. Try a clearer image.");
      assert.ok(!error.message.includes("timed out"));
      return true;
    }
  );
});

test("parseImage never attempts OCR when normalization throws", async () => {
  let recognizeCalls = 0;

  await assert.rejects(
    () =>
      parseImage(Buffer.from("not an image"), "image/png", {
        normalize: () => Promise.reject(new Error("Input image exceeds pixel limit")),
        recognize: () => {
          recognizeCalls += 1;
          return Promise.resolve(ocrResult(OCR_SAMPLE_TEXT));
        },
      })
  );

  assert.equal(recognizeCalls, 0);
});

test("parseImage rejects a real over-cap image through the real sharp normalizer", async () => {
  // Exercises the production normalizer end to end: a genuine sharp rejection
  // (not an injected throw) must still produce the generic client message.
  const input = await makeImage(300, 300);
  let recognizeCalls = 0;

  await assert.rejects(
    () =>
      parseImage(input, "image/png", {
        normalize: (buffer) => normalizeImageForOcr(buffer, { maxInputPixels: 1000 }),
        recognize: () => {
          recognizeCalls += 1;
          return Promise.resolve(ocrResult(OCR_SAMPLE_TEXT));
        },
      }),
    (error) => {
      assert.equal(error.message, "Could not process image. Please try a different image.");
      return true;
    }
  );

  assert.equal(recognizeCalls, 0);
});

test("parseImage still flags OCR output with the accuracy warning", async () => {
  const input = await makeImage(600, 400);

  const result = await parseImage(input, "image/png", {
    recognize: () => Promise.resolve(ocrResult(OCR_SAMPLE_TEXT)),
  });

  assert.ok(
    result.warnings.some((warning) => warning.includes("OCR")),
    "expected an OCR accuracy warning"
  );
});

test("PDF input routes away from the image branch, so no normalization applies", async () => {
  // validateImportFile is what importRecipe uses to pick a parser; a PDF
  // resolving to application/pdf means parsePdf runs and parseImage never does.
  const pdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n", "utf8");
  const result = await validateImportFile(pdfBuffer);

  assert.equal(result.valid, true);
  assert.equal(result.mime, "application/pdf");
});
