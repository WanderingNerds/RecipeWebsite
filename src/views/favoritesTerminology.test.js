import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("Favorites collection renders current collection terminology", async () => {
  const html = await ejs.renderFile(`${root}views/recipes/liked.ejs`, { recipes: [] });

  assert.match(html, /<h1>Favorites<\/h1>/);
  assert.match(html, /<h3>No favorites yet<\/h3>/);
  assert.doesNotMatch(html, /\blik(?:e|ed|es|ing)\b/i);
});

test("favorite UI and API copy avoids legacy user-facing terminology", async () => {
  const files = [
    "public/js/likes.js",
    "src/routes/likeRoutes.js",
    "views/recipes/view.ejs",
    "views/recipes/public-view.ejs",
  ];
  const source = (await Promise.all(files.map((file) => readFile(`${root}${file}`, "utf8")))).join("\n");
  const legacyUserCopy = [
    "Too many like actions",
    "Failed to get like status",
    "Failed to update like",
    "Failed to like recipe",
    "Failed to unlike recipe",
    "Like this recipe",
    "Unlike this recipe",
    "log in to like recipes",
    "Recipe unliked",
  ];

  for (const copy of legacyUserCopy) {
    assert.equal(source.toLowerCase().includes(copy.toLowerCase()), false, copy);
  }
  for (const copy of [
    "Favorite this recipe",
    "Remove this recipe from favorites",
    "log in to favorite recipes",
    "Recipe removed from favorites",
    "Too many favorite actions",
  ]) {
    assert.ok(source.includes(copy), copy);
  }
});
