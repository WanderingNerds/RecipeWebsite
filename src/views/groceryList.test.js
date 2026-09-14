import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildGroceryList, GROCERY_CATEGORIES } from "../utils/groceryList.js";

const views = fileURLToPath(new URL("../../views/", import.meta.url));

const mealPlan = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Week of Sept 14",
  start_date: "2026-09-14",
  end_date: "2026-09-20",
};

const renderList = (groceryList, plan = mealPlan) =>
  ejs.renderFile(`${views}meal-plans/grocery-list.ejs`, {
    mealPlan: plan,
    groceryList,
    user: { id: "owner" },
    csrfToken: "csrf-test",
  });

const renderPlanView = (recipes) =>
  ejs.renderFile(`${views}meal-plans/view.ejs`, {
    mealPlan,
    recipes,
    user: { id: "owner" },
    csrfToken: "csrf-test",
  });

const sampleList = () =>
  buildGroceryList(
    [
      { id: "r1", title: "Pancakes", ingredients: "2 cups flour\n1 onion\n2 eggs" },
      {
        id: "r2",
        title: "Soup",
        ingredients: "1 cup flour\n8 oz chicken breast\nSalt to taste\nOlive oil",
      },
    ],
    { skippedCount: 0 }
  );

test("grocery list renders the plan title, date range and a back link", async () => {
  const html = await renderList(sampleList());

  assert.match(html, /Week of Sept 14/);
  assert.match(html, /9\/14\/2026|14\/09\/2026|2026/);
  assert.match(html, /href="\/meal-plans\/11111111-1111-1111-1111-111111111111"/);
  assert.match(html, /Grocery List/);
});

test("category headings appear in fixed store order with items underneath", async () => {
  const html = await renderList(sampleList());
  const order = GROCERY_CATEGORIES.map((category) => category.label).filter((label) =>
    html.includes(`>${label}</h2>`)
  );

  let previous = -1;
  for (const label of order) {
    const index = html.indexOf(`>${label}</h2>`);
    assert.ok(index > previous, `${label} must follow the previous category heading`);
    previous = index;
  }

  assert.ok(order.includes("Produce"));
  assert.ok(order.includes("Baking"));
  assert.doesNotMatch(html, />Frozen<\/h2>/, "empty categories are not rendered");

  // Items land under their own category heading, not a neighbouring one.
  const bakingIndex = html.indexOf(">Baking</h2>");
  const flourIndex = html.indexOf("flour");
  const produceIndex = html.indexOf(">Produce</h2>");
  const onionIndex = html.indexOf("onion");
  assert.ok(produceIndex < onionIndex && onionIndex < bakingIndex);
  assert.ok(bakingIndex < flourIndex);
});

test("every item renders a checkbox, its combined amount and its source recipes", async () => {
  const html = await renderList(sampleList());

  assert.match(html, /3 cups<\/span>\s*<span class="grocery-item-name">flour/);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 6);
  assert.match(html, /Pancakes, Soup/);
  assert.match(
    html,
    /<span class="grocery-item-name">Olive oil<\/span>\s*<span class="grocery-item-hint">\(check recipe\)/,
    "an amount-less item says so instead of inventing one"
  );
});

test("hostile ingredient and recipe names are escaped", async () => {
  const list = buildGroceryList([
    {
      id: "r1",
      title: "<script>alert('recipe')</script>",
      ingredients: "2 cups <script>alert(1)</script>",
    },
  ]);
  const html = await renderList(list, { ...mealPlan, title: "<script>alert('plan')</script>" });

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("an empty plan renders the empty state, not an error or a blank page", async () => {
  const html = await renderList(buildGroceryList([]));

  assert.match(html, /class="empty-state"/);
  assert.match(html, /Nothing to shop for yet/);
  assert.match(html, /href="\/meal-plans\/11111111-1111-1111-1111-111111111111"/);
  assert.doesNotMatch(html, /grocery-category-heading/);
});

test("the skipped-recipe notice appears only when something was skipped", async () => {
  const none = await renderList(buildGroceryList([]));
  assert.doesNotMatch(none, /could not be included/);

  const one = await renderList(buildGroceryList([], { skippedCount: 1 }));
  assert.match(one, /1 recipe\s*\n?\s*in this meal plan could not be included/);

  const many = await renderList(buildGroceryList([], { skippedCount: 3 }));
  assert.match(many, /3 recipes/);
});

test("the print button exists with a script hook and no inline handler", async () => {
  const html = await renderList(sampleList());

  assert.match(html, /data-grocery-print/);
  assert.doesNotMatch(html, /onclick|<script/);

  const client = await readFile(new URL("../../public/js/meal-plans.js", import.meta.url), "utf8");
  assert.match(client, /\[data-grocery-print\]/);
  assert.match(client, /window\.print\(\)/);
});

test("categories render inside one wrapper for the print column layout", async () => {
  const html = await renderList(sampleList());
  const start = html.indexOf('<div class="grocery-categories">');
  const end = html.lastIndexOf("</div>");

  assert.ok(start !== -1, "the print CSS needs a single element to apply column-count to");
  assert.ok(html.indexOf(">Produce</h2>", start) > start && html.indexOf(">Produce</h2>", start) < end);
});

test("checking an item off hides it via the native hidden attribute, with no inline handler", async () => {
  const html = await renderList(sampleList());
  assert.doesNotMatch(html, /onchange|onclick/);

  const client = await readFile(new URL("../../public/js/meal-plans.js", import.meta.url), "utf8");
  assert.match(client, /initializeGroceryListChecklist/);
  assert.match(client, /closest\(["']\.grocery-item-checkbox["']\)/);
  assert.match(client, /item\.hidden = true/);
});

test("the plan detail page links to the grocery list only when it has recipes", async () => {
  const withRecipes = await renderPlanView([
    { id: "r1", title: "Pancakes", status: "published" },
  ]);
  assert.match(
    withRecipes,
    /href="\/meal-plans\/11111111-1111-1111-1111-111111111111\/grocery-list"[^>]*>Grocery List</
  );

  const empty = await renderPlanView([]);
  assert.doesNotMatch(empty, /grocery-list/);
});

test("the grocery list link is a plain GET link, not a form", async () => {
  const html = await renderPlanView([{ id: "r1", title: "Pancakes", status: "published" }]);
  const link = html.match(/<a[^>]*grocery-list[^>]*>/)[0];

  assert.match(link, /^<a /);
  assert.doesNotMatch(link, /method|_csrf|onclick/);
});
