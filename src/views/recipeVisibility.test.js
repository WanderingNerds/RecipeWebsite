import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

function radioCount(html) {
  return (html.match(/type="radio" name="visibility"/g) || []).length;
}

test("new and clone forms expose one Private-by-default visibility choice and one save action", async () => {
  const template = `${root}views/recipes/new.ejs`;
  const base = { csrfToken: "token", categories: [], userTags: [], selectedCategories: [], selectedTags: [], mealPlans: [], accountDisplayName: "Cook", visibility: "private" };
  for (const data of [{ ...base, recipe: null, isClone: false }, { ...base, recipe: { title: "Soup (Copy)", instructions: "Cook" }, isClone: true }]) {
    const html = await ejs.renderFile(template, data);
    assert.equal(radioCount(html), 2);
    assert.match(html, /name="visibility" value="private" checked/);
    assert.match(html, /name="visibility" value="public"/);
    assert.equal((html.match(/type="submit"/g) || []).length, 1);
  }
});

test("edit visibility reflects persisted status", async () => {
  const template = `${root}views/recipes/edit.ejs`;
  const recipe = { id: "id", title: "Soup", status: "published", instructions: "Cook" };
  const html = await ejs.renderFile(template, { csrfToken: "token", recipe, categories: [], userTags: [], selectedCategories: [], selectedTags: [] });
  assert.equal(radioCount(html), 2);
  assert.match(html, /name="visibility" value="public" checked/);
  assert.equal((html.match(/type="submit"/g) || []).length, 1);
});

test("import review uses the same control and client resets it Private", async () => {
  const html = await ejs.renderFile(`${root}views/recipes/import.ejs`, { csrfToken: "token", accountDisplayName: "Cook", supportedFormats: [], mealPlans: [] });
  const client = await readFile(`${root}public/js/import.js`, "utf8");
  assert.equal(radioCount(html), 2);
  assert.match(html, /name="visibility" value="private" checked/);
  assert.match(client, /input\.checked = input\.value === "private"/);
  assert.match(client, /visibility:[\s\S]*?\.value \|\| "private"/);
});

test("detail surfaces use Private/Public terminology and gate public cloning on auth", async () => {
  const ownerSource = await readFile(`${root}views/recipes/view.ejs`, "utf8");
  const publicSource = await readFile(`${root}views/recipes/public-view.ejs`, "utf8");
  assert.match(ownerSource, />Private<\/span>/);
  assert.match(ownerSource, />Public<\/span>/);
  assert.match(ownerSource, /\/recipes\/<%= recipe\.id %>\/clone/);
  assert.match(publicSource, /<% if \(user\) \{ %>[\s\S]*?\/clone/);
  assert.match(publicSource, /Made Public on/);
  assert.match(publicSource, /make recipes Public/);
  assert.doesNotMatch(publicSource, /Published on|build and publish/);
});

test("cookbook and meal-plan recipe surfaces use Private/Public display terminology", async () => {
  for (const relativePath of [
    "views/cookbooks/view.ejs",
    "views/meal-plans/view.ejs",
    "views/cookbooks/add-recipes.ejs",
    "views/meal-plans/add-recipes.ejs",
  ]) {
    const source = await readFile(`${root}${relativePath}`, "utf8");
    assert.doesNotMatch(source, />Draft<\/span>|>Published<\/span>|another user's published recipe/);
    assert.match(source, />Private<\/span>/);
  }
});
