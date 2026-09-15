import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonLd,
  parseImage,
  validateImportFile,
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
// parseImage OCR budget tests (REW-93)
//
// Every case injects a fake worker, so no test in this file ever spawns a real
// Tesseract worker or performs real OCR.
// =============================================================================

const IMAGE_BUFFER = Buffer.from("fake-image-bytes", "utf8");
const OCR_TEXT = [
  "Chocolate Chip Cookies",
  "Ingredients",
  "2 cups flour",
  "1 cup butter",
  "Instructions",
  "Mix the flour and butter, then bake for 12 minutes.",
].join("\n");

/**
 * Build a fake Tesseract worker factory plus a call log, so tests can assert on
 * worker lifecycle without touching tesseract.js.
 */
function fakeWorkerFactory({ recognize, terminate }) {
  const calls = { created: 0, recognized: 0, terminated: 0 };
  const createWorkerImpl = async () => {
    calls.created += 1;
    return {
      recognize: (buffer) => {
        calls.recognized += 1;
        return recognize(buffer);
      },
      terminate: async () => {
        calls.terminated += 1;
        if (terminate) return terminate();
        return undefined;
      },
    };
  };
  return { createWorkerImpl, calls };
}

function countPendingTimers() {
  return process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
}

test("importer re-exports the OCR budget from the shared function-limits config", () => {
  assert.equal(OCR_TIMEOUT_MS, CONFIG_OCR_TIMEOUT_MS);
  assert.equal(OCR_TIMEOUT_MS, 8000);
});

test("parseImage rejects with the timeout message when OCR outlasts its budget", async () => {
  const { createWorkerImpl } = fakeWorkerFactory({
    recognize: () => new Promise(() => {}), // never settles
  });

  const startedAt = Date.now();
  await assert.rejects(
    parseImage(IMAGE_BUFFER, "image/png", { timeoutMs: 5, createWorkerImpl }),
    (error) => {
      assert.equal(error.message, "Image processing timed out. Try a clearer image.");
      return true;
    }
  );

  // The point of the timeout is that it bounds the request: an OCR that never
  // settles must not leave parseImage hanging.
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 500, `parseImage should settle near its 5ms budget, took ${elapsed}ms`);
});

test("parseImage terminates the worker exactly once on the timeout path", async () => {
  const { createWorkerImpl, calls } = fakeWorkerFactory({
    recognize: () => new Promise(() => {}),
  });

  await assert.rejects(
    parseImage(IMAGE_BUFFER, "image/png", { timeoutMs: 5, createWorkerImpl })
  );

  assert.equal(calls.created, 1);
  assert.equal(calls.terminated, 1, "the abandoned worker must be reclaimed exactly once");
});

test("a failing terminate does not replace the user-facing timeout error", async (t) => {
  const { createWorkerImpl, calls } = fakeWorkerFactory({
    recognize: () => new Promise(() => {}),
    terminate: () => Promise.reject(new Error("worker ipc channel closed")),
  });
  // The termination failure is expected to be logged, not surfaced; stub the
  // logger so the deliberate failure does not pollute test output.
  t.mock.method(console, "error", () => {});

  await assert.rejects(
    parseImage(IMAGE_BUFFER, "image/png", { timeoutMs: 5, createWorkerImpl }),
    (error) => {
      assert.equal(error.message, "Image processing timed out. Try a clearer image.");
      assert.doesNotMatch(error.message, /ipc|worker/i);
      return true;
    }
  );

  assert.equal(calls.terminated, 1);
  assert.equal(console.error.mock.callCount(), 1, "termination failures must be logged");
});

test("parseImage returns parsed data with the OCR warning and leaves no pending timer", async () => {
  const { createWorkerImpl, calls } = fakeWorkerFactory({
    recognize: async () => ({ data: { text: OCR_TEXT } }),
  });

  const timersBefore = countPendingTimers();
  // Deliberately uses the real OCR_TIMEOUT_MS default: if the timer were not
  // cleared, an 8-second handle would still be pending after this resolves.
  const result = await parseImage(IMAGE_BUFFER, "image/png", { createWorkerImpl });

  assert.equal(
    countPendingTimers(),
    timersBefore,
    "a successful OCR must clear its pending timeout handle"
  );
  assert.equal(calls.terminated, 1);
  assert.ok(result.ingredients.includes("2 cups flour"));
  assert.ok(
    result.warnings.includes(
      "Text was extracted from an image using OCR. Please verify accuracy."
    )
  );
});

test("a non-timeout OCR failure surfaces the generic image error with no internals", async () => {
  const { createWorkerImpl, calls } = fakeWorkerFactory({
    recognize: () =>
      Promise.reject(new Error("tesseract: failed to load C:/tmp/eng.traineddata")),
  });

  await assert.rejects(
    parseImage(IMAGE_BUFFER, "image/png", { createWorkerImpl }),
    (error) => {
      assert.equal(error.message, "Could not process image. Please try a different image.");
      // parseImage branches on the "timed out" substring, so a decode failure
      // must never contain it, and no internals may leak to the client.
      assert.doesNotMatch(error.message, /timed out/i);
      assert.doesNotMatch(error.message, /tesseract|traineddata/i);
      assert.doesNotMatch(error.message, /\//);
      return true;
    }
  );

  assert.equal(calls.terminated, 1);
});

test("a worker that finishes starting after the timeout is still terminated", async () => {
  // The cold-start case: Tesseract is still downloading/initializing when the
  // budget expires, so parseImage bails out before it ever holds the worker.
  const calls = { terminated: 0 };
  let resolveWorker;
  const workerReady = new Promise((resolve) => { resolveWorker = resolve; });

  const startedAt = Date.now();
  await assert.rejects(
    parseImage(IMAGE_BUFFER, "image/png", { timeoutMs: 5, createWorkerImpl: () => workerReady }),
    (error) => {
      assert.equal(error.message, "Image processing timed out. Try a clearer image.");
      return true;
    }
  );
  assert.ok(
    Date.now() - startedAt < 500,
    "a slow worker startup must not delay the timeout response"
  );
  assert.equal(calls.terminated, 0, "startup had not finished, so there was nothing to terminate");

  // The late-arriving worker must still be reclaimed, or it keeps running OCR
  // in the warm container after the request has already been answered.
  resolveWorker({
    recognize: () => new Promise(() => {}),
    terminate: async () => { calls.terminated += 1; },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.terminated, 1, "the deferred cleanup must terminate the worker exactly once");
});

test("a worker that fails to start surfaces the generic image error and logs it as startup", async (t) => {
  t.mock.method(console, "error", () => {});

  await assert.rejects(
    parseImage(IMAGE_BUFFER, "image/png", {
      createWorkerImpl: () => Promise.reject(new Error("failed to fetch eng.traineddata")),
    }),
    (error) => {
      assert.equal(error.message, "Could not process image. Please try a different image.");
      assert.doesNotMatch(error.message, /timed out/i);
      assert.doesNotMatch(error.message, /traineddata/i);
      return true;
    }
  );
  await new Promise((resolve) => setImmediate(resolve));

  // A startup failure must not be logged as a termination failure - there was
  // never a worker to terminate, and the wrong label misleads log readers.
  assert.equal(console.error.mock.callCount(), 1);
  assert.equal(console.error.mock.calls[0].arguments[0], "OCR worker startup failed:");
});

test("OCR text under 20 characters still reports the not-enough-text error", async () => {
  const { createWorkerImpl } = fakeWorkerFactory({
    recognize: async () => ({ data: { text: "Cookies" } }),
  });

  await assert.rejects(
    parseImage(IMAGE_BUFFER, "image/png", { createWorkerImpl }),
    (error) => {
      assert.equal(
        error.message,
        "Could not extract enough text from image. Try a clearer image."
      );
      return true;
    }
  );
});
