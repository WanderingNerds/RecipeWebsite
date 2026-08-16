import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonLd,
  validateImportFile,
  SUPPORTED_MIME_TYPES,
} from "./recipeImporter.js";

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
