import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const view = fileURLToPath(new URL("../../views/recipes/import.ejs", import.meta.url));
const clientScript = new URL("../../public/js/import.js", import.meta.url);

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

test("both native-invalid submit paths show/focus Cook Time and valid input clears it", async () => {
  const source = await readFile(clientScript, "utf8");
  const elements = new Map();
  let focused = null;

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
      focus() { focused = this; },
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
    "confidenceFill", "saveDraftButton", "publishButton",
  ];
  ids.forEach((id) => { if (!elements.has(id)) element(id); });
  const domReady = [];
  const document = {
    addEventListener(type, listener) { if (type === "DOMContentLoaded") domReady.push(listener); },
    getElementById(id) { return elements.get(id); },
    querySelector() { return { value: "csrf-test" }; },
  };
  vm.runInNewContext(source, { document, console, setTimeout, clearTimeout, FormData, fetch: () => { throw new Error("unexpected fetch"); } });
  domReady.forEach((listener) => listener());

  const form = elements.get("importForm");
  const cookTime = elements.get("importCookTime");
  const group = elements.get("cookTimeGroup");
  for (const submitter of [elements.get("saveDraftButton"), elements.get("publishButton")]) {
    cookTime.value = "";
    let prevented = false;
    form.listeners.get("invalid")({ target: cookTime, submitter, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(group.classList.contains("has-error"), true);
    assert.equal(cookTime["aria-invalid"], "true");
    assert.equal(focused, cookTime);
  }

  cookTime.value = "15 min";
  cookTime.listeners.get("input")();
  assert.equal(group.classList.contains("has-error"), false);
  assert.equal(cookTime["aria-invalid"], "false");
});
