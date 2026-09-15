import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const newView = fileURLToPath(new URL("../../views/recipes/new.ejs", import.meta.url));
const editView = fileURLToPath(new URL("../../views/recipes/edit.ejs", import.meta.url));
const clientScript = new URL("../../public/js/recipe-form.js", import.meta.url);

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { MAX_RECIPE_IMAGE_SIZE_BYTES, MAX_RECIPE_IMAGE_SIZE_LABEL } =
  await import("../routes/recipeRoutes.js");

// The exact locals objects the existing suites use, so this test fails the same
// way they would if the photo markup introduced a new required local.
const newLocals = {
  csrfToken: "token",
  categories: [],
  userTags: [],
  selectedCategories: [],
  selectedTags: [],
  mealPlans: [],
  accountDisplayName: "Cook",
  visibility: "private",
  recipe: null,
  isClone: false,
};

function editLocals(recipe) {
  return {
    csrfToken: "token",
    recipe,
    categories: [],
    userTags: [],
    selectedCategories: [],
    selectedTags: [],
  };
}

const baseRecipe = { id: "id", title: "Soup", status: "published", instructions: "Cook" };

async function renderBoth() {
  return {
    new: await ejs.renderFile(newView, newLocals),
    edit: await ejs.renderFile(editView, editLocals(baseRecipe)),
  };
}

test("both recipe forms state the maximum photo size derived from the server constant", async () => {
  const html = await renderBoth();

  for (const [name, markup] of Object.entries(html)) {
    assert.match(
      markup,
      new RegExp(`Maximum file size: ${MAX_RECIPE_IMAGE_SIZE_LABEL}`),
      `${name}.ejs must state the upload cap next to the photo picker`
    );
    assert.match(markup, /Maximum file size: 4MB/, `${name}.ejs copy must read 4MB`);
  }
});

// Lookbehind so legitimate references to the platform's 4.5MB cap are not
// mistaken for the old 5MB photo limit this ticket removed.
const OLD_LIMIT_COPY = /(?<![\d.])5\s?MB\b/i;

test("no recipe photo surface still advertises the old 5MB limit", async () => {
  const html = await renderBoth();

  for (const [name, markup] of Object.entries(html)) {
    assert.doesNotMatch(markup, OLD_LIMIT_COPY, `${name}.ejs must not mention 5MB (REW-94)`);
  }

  const routes = await readFile(new URL("../routes/recipeRoutes.js", import.meta.url), "utf8");
  assert.doesNotMatch(routes, /5 \* 1024 \* 1024/, "the 5MB literal must be gone from recipeRoutes.js");
  assert.doesNotMatch(routes, OLD_LIMIT_COPY, "no 5MB copy may survive in recipeRoutes.js");
});

test("both recipe forms expose a polite live region for the photo error", async () => {
  const html = await renderBoth();

  for (const [name, markup] of Object.entries(html)) {
    assert.match(
      markup,
      /id="photoError"[^>]*aria-live="polite"/,
      `${name}.ejs must provide the aria-live target the client writes into`
    );
    assert.match(
      markup,
      /id="photoError"[^>]*style="[^"]*display: none;/,
      `${name}.ejs photo error must start hidden`
    );
  }
});

test("the edit form's existing photo affordances still render", async () => {
  const withPhoto = await ejs.renderFile(
    editView,
    editLocals({ ...baseRecipe, photo_url: "https://example.test/soup.jpg" })
  );
  assert.match(withPhoto, /name="removePhoto" value="true"/);
  assert.match(withPhoto, /Remove current photo/);
  assert.match(withPhoto, /id="photoImage" src="https:\/\/example\.test\/soup\.jpg"/);

  const withoutPhoto = await ejs.renderFile(editView, editLocals(baseRecipe));
  assert.doesNotMatch(withoutPhoto, /Remove current photo/);
});

test("client MAX_PHOTO_SIZE matches the server recipe photo size limit", async () => {
  const source = await readFile(clientScript, "utf8");
  const match = source.match(/const MAX_PHOTO_SIZE = ([^;]+);/);

  assert.ok(match, "public/js/recipe-form.js must declare MAX_PHOTO_SIZE");

  const clientLimit = vm.runInNewContext(match[1]);
  assert.equal(clientLimit, MAX_RECIPE_IMAGE_SIZE_BYTES);
  assert.ok(
    clientLimit <= MAX_RECIPE_IMAGE_SIZE_BYTES,
    "the client pre-check must never allow files the server rejects"
  );
});

test("the client pre-check clears the input and writes the derived message", async () => {
  const source = await readFile(clientScript, "utf8");

  assert.match(source, /const MAX_PHOTO_SIZE_LABEL = `\$\{MAX_PHOTO_SIZE \/ \(1024 \* 1024\)\}MB`/);
  assert.match(source, /const PHOTO_TOO_LARGE_MESSAGE = `Photo must be under \$\{MAX_PHOTO_SIZE_LABEL\}`/);
  assert.match(source, /file\.size > MAX_PHOTO_SIZE/);
  assert.match(source, /photoInput\.value = '';[\s\S]*?setPhotoError\(PHOTO_TOO_LARGE_MESSAGE\);/);
  assert.doesNotMatch(source, OLD_LIMIT_COPY);
});

test("the client pre-check runs the oversize path without previewing the file", async () => {
  const source = await readFile(clientScript, "utf8");
  const { photoInput, photoError, photoImage, readCalls } = runRecipeFormClient(source);

  photoInput.files = [{ name: "huge.jpg", type: "image/jpeg", size: MAX_RECIPE_IMAGE_SIZE_BYTES + 1 }];
  photoInput.listeners.get("change")({ target: photoInput });

  assert.equal(photoError.textContent, "Photo must be under 4MB");
  assert.equal(photoError.style.display, "block");
  assert.equal(photoInput.value, "", "the oversize file must be cleared from the input");
  assert.equal(photoImage.style.display, "none", "the preview must stay empty");
  assert.equal(readCalls.length, 0, "an oversize file must never be read for preview");
});

test("a previewed file is dropped from the preview when an oversize file follows (new form)", async () => {
  const source = await readFile(clientScript, "utf8");
  const client = runRecipeFormClient(source);

  // Preview a valid file first, so there is something on screen to discard.
  client.selectFile(1024, "ok.jpg");
  assert.equal(client.photoImage.src, "data:image/jpeg;base64,AAAA");
  assert.equal(client.photoImage.style.display, "block");
  assert.equal(client.photoPreview.classList.contains("photo-placeholder"), true);

  client.selectFile(MAX_RECIPE_IMAGE_SIZE_BYTES + 1, "huge.jpg");

  assert.equal(client.photoError.textContent, "Photo must be under 4MB");
  assert.equal(client.photoInput.value, "", "the oversize file must be cleared from the input");
  assert.equal(
    client.photoImage.src,
    "",
    "the previously previewed image must not stay on screen: the form will not submit it"
  );
  assert.equal(client.photoImage.style.display, "none");
  assert.equal(client.photoPlaceholder.style.display, "", "the placeholder must come back");
  assert.equal(client.photoPreview.classList.contains("photo-placeholder-pattern"), true);
  assert.equal(client.photoPreview.classList.contains("photo-placeholder"), false);
});

test("an oversize file restores the saved photo rather than blanking it (edit form)", async () => {
  const source = await readFile(clientScript, "utf8");
  const savedPhoto = "https://example.test/soup.jpg";
  const client = runRecipeFormClient(source, { initialPhotoUrl: savedPhoto });

  client.selectFile(1024, "ok.jpg");
  assert.equal(client.photoImage.src, "data:image/jpeg;base64,AAAA");

  client.selectFile(MAX_RECIPE_IMAGE_SIZE_BYTES + 1, "huge.jpg");

  assert.equal(client.photoError.textContent, "Photo must be under 4MB");
  assert.equal(client.photoInput.value, "");
  assert.equal(
    client.photoImage.src,
    savedPhoto,
    "the recipe's existing photo is still what the server holds, so it must come back"
  );
  assert.equal(client.photoImage.style.display, "block");
  assert.equal(client.photoPlaceholder.style.display, "none");
  assert.equal(client.photoPreview.classList.contains("photo-placeholder"), true);
  assert.equal(client.photoPreview.classList.contains("photo-placeholder-pattern"), false);
});

test("the client pre-check clears a previous message when a valid file is chosen", async () => {
  const source = await readFile(clientScript, "utf8");
  const { photoInput, photoError, readCalls } = runRecipeFormClient(source);

  photoInput.files = [{ name: "ok.jpg", type: "image/jpeg", size: 1024 }];
  photoInput.listeners.get("change")({ target: photoInput });

  assert.equal(photoError.textContent, "");
  assert.equal(photoError.style.display, "none");
  assert.equal(readCalls.length, 1, "a valid file must still be previewed");
});

/**
 * Run public/js/recipe-form.js against a stub DOM so the photo pre-check can be
 * exercised rather than asserted on as source text.
 */
function runRecipeFormClient(source, { initialPhotoUrl = "" } = {}) {
  const elements = new Map();
  const readCalls = [];

  function element(id) {
    const listeners = new Map();
    const classes = new Set();
    const node = {
      id,
      value: "",
      textContent: "",
      style: {},
      listeners,
      files: [],
      attributes: new Map(),
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
      },
      addEventListener(type, listener) { listeners.set(type, listener); },
      setAttribute(name, value) { this.attributes.set(name, value); this[name] = value; },
      getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; },
      removeAttribute(name) { this.attributes.delete(name); this[name] = ""; },
      closest() { return null; },
      focus() {},
      click() {},
    };
    // Keep `src` and the attribute map in step, the way a real element does, so
    // the client's getAttribute("src") snapshot sees what assignments wrote.
    Object.defineProperty(node, "src", {
      get() { return this.attributes.get("src") || ""; },
      set(value) { this.attributes.set("src", value); },
      enumerable: true,
      configurable: true,
    });
    elements.set(id, node);
    return node;
  }

  ["photo", "photoPreview", "photoImage", "photoPlaceholder", "photoError"].forEach(element);

  // Mirror the markup each template ships: the new form starts with an empty,
  // hidden preview over the pattern background; the edit form with a saved
  // photo starts with the image visible over the solid background.
  const photoImage = elements.get("photoImage");
  const photoPlaceholder = elements.get("photoPlaceholder");
  const photoPreview = elements.get("photoPreview");
  if (initialPhotoUrl) {
    photoImage.setAttribute("src", initialPhotoUrl);
    photoImage.style.display = "block";
    photoImage.style.objectFit = "contain";
    photoPlaceholder.style.display = "none";
    photoPreview.classList.add("photo-placeholder");
  } else {
    photoImage.style.display = "none";
    photoImage.style.objectFit = "cover";
    photoPlaceholder.style.display = "";
    photoPreview.classList.add("photo-placeholder-pattern");
  }

  const domReady = [];
  const document = {
    addEventListener(type, listener) { if (type === "DOMContentLoaded") domReady.push(listener); },
    getElementById(id) { return elements.get(id) || null; },
    querySelector() { return null; },
  };

  class FileReaderStub {
    readAsDataURL(file) {
      readCalls.push(file);
      if (this.onload) this.onload({ target: { result: "data:image/jpeg;base64,AAAA" } });
    }
  }

  vm.runInNewContext(source, { document, console, FileReader: FileReaderStub });
  domReady.forEach((listener) => listener());

  const photoInput = elements.get("photo");

  return {
    photoInput,
    photoError: elements.get("photoError"),
    photoImage,
    photoPlaceholder,
    photoPreview,
    readCalls,
    selectFile(size, name = "photo.jpg") {
      photoInput.files = [{ name, type: "image/jpeg", size }];
      photoInput.listeners.get("change")({ target: photoInput });
    },
  };
}
