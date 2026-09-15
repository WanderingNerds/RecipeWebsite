import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const view = fileURLToPath(new URL("../../views/recipes/import.ejs", import.meta.url));
const modalView = fileURLToPath(new URL("../../views/partials/import-modal.ejs", import.meta.url));
const clientScript = new URL("../../public/js/import.js", import.meta.url);

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { MAX_IMPORT_FILE_SIZE_BYTES } = await import("../routes/importRoutes.js");

test("import Cook Time has required and accessible inline-error markup", async () => {
  const html = await ejs.renderFile(view, {
    csrfToken: "csrf-test",
    accountDisplayName: "Test Cook",
    supportedFormats: [],
    mealPlans: [],
  });

  assert.match(html, /Cook Time <span[^>]*>\*<\/span>/);
  assert.match(html, /id="importCookTime"[^>]+required[^>]+aria-required="true"[^>]+aria-describedby="importCookTimeError"/);
  assert.match(html, /class="field-error-message" id="importCookTimeError">Required<\/span>/);
});

test("import client blocks blank Cook Time and maintains its inline error state", async () => {
  const source = await readFile(clientScript, "utf8");

  assert.match(source, /const cookTimeMissing = !importCookTime\.value\.trim\(\)/);
  assert.match(source, /\(cookTimeMissing \? importCookTime : importTitle\)\.focus\(\)/);
  assert.match(source, /if \(!importCookTime\.value\.trim\(\)\) \{[\s\S]*?setCookTimeError\(true\);[\s\S]*?importCookTime\.focus\(\);[\s\S]*?return;/);
  assert.match(source, /group\.classList\.toggle\("has-error", hasError\)/);
  assert.match(source, /setAttribute\("aria-invalid", hasError \? "true" : "false"\)/);
  assert.match(source, /addEventListener\("input"[\s\S]*?if \(importCookTime\.value\.trim\(\)\) \{[\s\S]*?setCookTimeError\(false\)/);
  assert.match(source, /cookTime: importCookTime\.value\.trim\(\)/);
});

/**
 * Run public/js/import.js in a sandbox against a stub DOM and return handles to
 * the fake elements, so client behaviour can be exercised instead of asserting
 * on its source text.
 */
async function runImportClient({ fetchImpl } = {}) {
  const source = await readFile(clientScript, "utf8");
  const elements = new Map();
  const state = { focused: null };

  function element(id) {
    const listeners = new Map();
    const classes = new Set();
    const group = id === "importCookTime" ? element("cookTimeGroup") : null;
    const value = {
      id,
      value: "",
      style: {},
      listeners,
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
        contains: (name) => classes.has(name),
      },
      addEventListener(type, listener) { listeners.set(type, listener); },
      setAttribute(name, attributeValue) { this[name] = attributeValue; },
      closest() { return group; },
      focus() { state.focused = this; },
    };
    elements.set(id, value);
    return value;
  }

  const ids = [
    "dropZone", "fileInput", "browseButton", "dropZoneContent", "uploadProgress",
    "uploadFileName", "uploadError", "uploadErrorMessage", "uploadSection", "previewSection",
    "importForm", "startOverButton", "importTitle", "importAuthor", "importIngredients",
    "importInstructions", "importPrepTime", "importCookTime", "importServings", "importSourceUrl",
    "importDescription", "titleError", "importCookTimeError", "warningsSection", "warningsList",
    "confidenceFill", "saveRecipeButton",
  ];
  ids.forEach((id) => { if (!elements.has(id)) element(id); });
  const domReady = [];
  const document = {
    addEventListener(type, listener) { if (type === "DOMContentLoaded") domReady.push(listener); },
    getElementById(id) { return elements.get(id); },
    querySelector() { return { value: "csrf-test" }; },
    querySelectorAll(selector) {
      return selector === 'input[name="visibility"]'
        ? [{ value: "private", checked: true }, { value: "public", checked: false }]
        : [];
    },
  };
  vm.runInNewContext(source, {
    document,
    console,
    setTimeout,
    clearTimeout,
    FormData,
    fetch: fetchImpl || (() => { throw new Error("unexpected fetch"); }),
  });
  domReady.forEach((listener) => listener());

  return { source, elements, state };
}

/**
 * Feed a file through the client's file-input change handler and wait for the
 * async upload path to settle.
 */
async function uploadThroughClient(elements, file) {
  const fileInput = elements.get("fileInput");
  fileInput.files = [file];
  fileInput.listeners.get("change")();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return elements.get("uploadErrorMessage").textContent;
}

test("both native-invalid submit paths show/focus Cook Time and valid input clears it", async () => {
  const { elements, state } = await runImportClient();

  const form = elements.get("importForm");
  const cookTime = elements.get("importCookTime");
  const group = elements.get("cookTimeGroup");
  for (const submitter of [elements.get("saveRecipeButton")]) {
    cookTime.value = "";
    let prevented = false;
    form.listeners.get("invalid")({ target: cookTime, submitter, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(group.classList.contains("has-error"), true);
    assert.equal(cookTime["aria-invalid"], "true");
    assert.equal(state.focused, cookTime);
  }

  cookTime.value = "15 min";
  cookTime.listeners.get("input")();
  assert.equal(group.classList.contains("has-error"), false);
  assert.equal(cookTime["aria-invalid"], "false");
});

// --- REW-43: client file-size limit stays in sync with the server limit ---

test("client MAX_FILE_SIZE matches the server import file size limit", async () => {
  const source = await readFile(clientScript, "utf8");
  const match = source.match(/const MAX_FILE_SIZE = ([^;]+);/);

  assert.ok(match, "public/js/import.js must declare MAX_FILE_SIZE");

  const clientLimit = vm.runInNewContext(match[1]);
  assert.equal(clientLimit, MAX_IMPORT_FILE_SIZE_BYTES);
  assert.ok(
    clientLimit <= MAX_IMPORT_FILE_SIZE_BYTES,
    "client pre-check must not allow files the server rejects"
  );
});

test("import client rejects an oversize file with copy stating the 4MB limit", async () => {
  const { source, elements } = await runImportClient({
    fetchImpl: () => { throw new Error("oversize files must never reach the network"); },
  });

  const message = await uploadThroughClient(elements, {
    name: "huge.pdf",
    type: "application/pdf",
    size: MAX_IMPORT_FILE_SIZE_BYTES + 1,
  });

  assert.equal(message, "File must be under 4MB");
  assert.doesNotMatch(source, /\b2\s?MB\b/);
});

test("import client surfaces the real message when a 429 body is not JSON", async () => {
  const { elements } = await runImportClient({
    fetchImpl: () => Promise.resolve({
      ok: false,
      status: 429,
      json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON at position 0")),
    }),
  });

  const message = await uploadThroughClient(elements, {
    name: "recipe.json",
    type: "application/json",
    size: 1024,
  });

  assert.equal(message, "Too many import attempts. Please try again in 15 minutes.");
  assert.doesNotMatch(message, /SyntaxError|Unexpected token/);
});

test("import client surfaces the real message when a 413 body is not JSON", async () => {
  const { elements } = await runImportClient({
    fetchImpl: () => Promise.resolve({
      ok: false,
      status: 413,
      json: () => Promise.reject(new SyntaxError("Unexpected token F in JSON at position 0")),
    }),
  });

  const message = await uploadThroughClient(elements, {
    name: "recipe.pdf",
    type: "application/pdf",
    size: 1024,
  });

  assert.equal(message, "File must be under 4MB");
  assert.doesNotMatch(message, /SyntaxError|Unexpected token/);
});

test("import client reports auth/CSRF rejections as an expired session, not a parse failure", async () => {
  for (const status of [401, 403]) {
    const { elements } = await runImportClient({
      fetchImpl: () => Promise.resolve({
        ok: false,
        status,
        json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON at position 0")),
      }),
    });

    const message = await uploadThroughClient(elements, {
      name: "recipe.json",
      type: "application/json",
      size: 1024,
    });

    assert.equal(message, "Your session expired. Please refresh the page and try again.");
    assert.doesNotMatch(message, /parse/i);
  }
});

test("import client prefers a server-supplied JSON error over the status fallback", async () => {
  const { elements } = await runImportClient({
    fetchImpl: () => Promise.resolve({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Unsupported file type. Please upload a JSON, PDF, or image file." }),
    }),
  });

  const message = await uploadThroughClient(elements, {
    name: "recipe.json",
    type: "application/json",
    size: 1024,
  });

  assert.equal(message, "Unsupported file type. Please upload a JSON, PDF, or image file.");
});

// --- REW-93: gateway timeouts get readable copy, JSON errors still win ---

test("import client shows timeout copy when a gateway returns 504 with an HTML body", async () => {
  for (const status of [502, 503, 504]) {
    const { elements } = await runImportClient({
      fetchImpl: () => Promise.resolve({
        ok: false,
        status,
        json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON at position 0")),
      }),
    });

    const message = await uploadThroughClient(elements, {
      name: "recipe.jpg",
      type: "image/jpeg",
      size: 1024,
    });

    assert.equal(
      message,
      "The import took too long. Try a smaller file.",
      `status ${status} must surface the gateway-timeout copy, not the generic parse failure`
    );
    assert.doesNotMatch(message, /SyntaxError|Unexpected token/);
  }
});

test("import client prefers the server OCR timeout message from a 400 JSON body", async () => {
  const serverMessage = "Image processing timed out. Try a clearer image.";
  const { elements } = await runImportClient({
    fetchImpl: () => Promise.resolve({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: serverMessage }),
    }),
  });

  const message = await uploadThroughClient(elements, {
    name: "recipe.jpg",
    type: "image/jpeg",
    size: 1024,
  });

  assert.equal(message, serverMessage);
});

test("import page states the 4MB maximum file size", async () => {
  const html = await ejs.renderFile(view, {
    csrfToken: "csrf-test",
    accountDisplayName: "Test Cook",
    supportedFormats: [],
    mealPlans: [],
  });

  assert.match(html, /Maximum file size: 4MB/);
  assert.doesNotMatch(html, /\b2\s?MB\b/);
});

test("import modal states the 4MB maximum file size", async () => {
  const html = await ejs.renderFile(modalView, {});

  assert.match(html, /Max 4MB/);
  assert.doesNotMatch(html, /\b2\s?MB\b/);
});
