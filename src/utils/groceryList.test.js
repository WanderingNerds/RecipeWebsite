import test from "node:test";
import assert from "node:assert/strict";
import {
  GROCERY_CATEGORIES,
  OTHER_CATEGORY,
  buildGroceryList,
  categorizeIngredient,
  groceryItemKey,
} from "./groceryList.js";

/** Builds a list from `[title, ingredientsText]` pairs. */
const listOf = (...recipes) =>
  buildGroceryList(
    recipes.map(([title, ingredients], index) => ({ id: `recipe-${index}`, title, ingredients }))
  );

/** Finds an item by display name, whichever category it landed in. */
function findItem(list, name) {
  for (const category of list.categories) {
    const item = category.items.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (item) return { ...item, category: category.key };
  }
  return null;
}

const allItems = (list) => list.categories.flatMap((category) => category.items);

// ---------------------------------------------------------------------------
// Categorisation
// ---------------------------------------------------------------------------

test("categorizeIngredient: places representative ingredients in their aisle", () => {
  const expectations = {
    produce: ["onion", "Roma tomatoes", "fresh spinach", "bell pepper", "garlic"],
    "meat-seafood": ["boneless chicken breast", "ground beef", "salmon fillet", "bacon"],
    "dairy-eggs": ["whole milk", "unsalted butter", "eggs", "sharp cheddar cheese"],
    bakery: ["sourdough bread", "flour tortillas", "hamburger buns"],
    frozen: ["frozen peas", "vanilla ice cream", "puff pastry"],
    "canned-jarred": ["diced tomatoes", "chicken broth", "black beans", "tomato paste"],
    "dry-goods": ["spaghetti", "brown rice", "rolled oats", "lentils"],
    baking: ["all-purpose flour", "brown sugar", "baking powder", "vanilla extract"],
    spices: ["kosher salt", "black pepper", "smoked paprika", "ground cumin"],
    condiments: ["olive oil", "soy sauce", "dijon mustard", "red wine vinegar"],
    beverages: ["orange juice", "coffee", "sparkling water"],
  };

  for (const [expected, names] of Object.entries(expectations)) {
    for (const name of names) {
      assert.equal(categorizeIngredient(name), expected, `${name} should be ${expected}`);
    }
  }
});

test("categorizeIngredient: the most specific keyword wins", () => {
  assert.equal(categorizeIngredient("bell pepper"), "produce");
  assert.equal(categorizeIngredient("black pepper"), "spices");
  assert.equal(categorizeIngredient("pepper"), "spices");
  assert.equal(categorizeIngredient("chicken broth"), "canned-jarred");
  assert.equal(categorizeIngredient("chicken thighs"), "meat-seafood");
  assert.equal(categorizeIngredient("coconut milk"), "canned-jarred");
  assert.equal(categorizeIngredient("whole milk"), "dairy-eggs");
});

test("categorizeIngredient: anything unrecognised falls back to Other", () => {
  for (const name of ["unobtainium", "za'atar blend", "", null, undefined, 42]) {
    assert.equal(categorizeIngredient(name), OTHER_CATEGORY);
  }
});

test("categorizeIngredient: ingredient text is never used to build a pattern", () => {
  // Regex metacharacters from user text must be inert, not compiled.
  assert.equal(categorizeIngredient("(.*)+$^"), OTHER_CATEGORY);
  assert.equal(categorizeIngredient("onion (.*)"), "produce");
});

// ---------------------------------------------------------------------------
// Grouping keys
// ---------------------------------------------------------------------------

test("groceryItemKey: folds plurals and strips preparation words", () => {
  assert.equal(groceryItemKey("chopped onion"), groceryItemKey("onions"));
  assert.equal(groceryItemKey("Finely Diced Tomatoes"), "tomato");
  assert.equal(groceryItemKey("fresh strawberries"), "strawberry");
  assert.equal(groceryItemKey("  "), "");
  assert.equal(groceryItemKey(null), "");
});

test("groceryItemKey: a name made only of prep words still groups on itself", () => {
  assert.equal(groceryItemKey("chopped"), "chopped");
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

test("buildGroceryList: merges the same ingredient across recipes", () => {
  const list = listOf(["Pancakes", "2 cups flour"], ["Bread", "1 cup flour"]);
  const flour = findItem(list, "flour");

  assert.ok(flour);
  assert.equal(flour.category, "baking");
  assert.deepEqual(flour.amounts, ["3 cups"]);
  assert.equal(list.totalItems, 1);
});

test("buildGroceryList: sums compatible volumes, weights and counts", () => {
  const list = listOf(
    ["A", "2 cups milk\n250 g butter\n2 eggs\n8 oz beef"],
    ["B", "1 cup milk\n250 g butter\n3 eggs\n8 oz beef"]
  );

  assert.deepEqual(findItem(list, "milk").amounts, ["3 cups"]);
  assert.deepEqual(findItem(list, "butter").amounts, ["500 g"]);
  assert.deepEqual(findItem(list, "eggs").amounts, ["5"]);
  assert.deepEqual(findItem(list, "beef").amounts, ["1 lb"]);
});

test("buildGroceryList: sums volumes written in different volume units", () => {
  const list = listOf(["A", "1 cup water"], ["B", "8 tbsp water"]);
  assert.deepEqual(findItem(list, "water").amounts, ["1 1/2 cups"]);
});

test("buildGroceryList: refuses to combine incompatible amounts", () => {
  const list = listOf(["Soup", "1 cup chopped onion"], ["Stew", "2 onions"]);
  const onion = findItem(list, "onions");

  assert.ok(onion, "the two lines must land on one item");
  assert.equal(onion.category, "produce");
  assert.deepEqual(onion.amounts, ["1 cup", "2"]);
});

test("buildGroceryList: keeps count units apart when they differ", () => {
  const list = listOf(["A", "2 cloves garlic"], ["B", "1 head garlic"]);
  assert.deepEqual(findItem(list, "garlic").amounts, ["2 cloves", "1 head"]);
});

test("buildGroceryList: never sums a range into an invented number", () => {
  const list = listOf(["A", "2-3 cloves garlic, minced"], ["B", "2 cloves garlic"]);
  assert.deepEqual(findItem(list, "garlic").amounts, ["2 cloves", "2-3 cloves"]);
});

test("buildGroceryList: approximate amounts are kept as written", () => {
  const list = listOf(["A", "1 pinch saffron"], ["B", "1 pinch saffron"]);
  assert.deepEqual(findItem(list, "saffron").amounts, ["1 pinch", "1 pinch"]);
});

test("buildGroceryList: 'to taste' keeps its text, fabricates no amount, and flags a check", () => {
  const list = listOf(["A", "Salt and pepper to taste"], ["B", "Salt and pepper to taste"]);
  const item = findItem(list, "Salt and pepper");

  assert.ok(item);
  assert.equal(item.needsCheck, true);
  assert.deepEqual(item.amounts, ["to taste"], "the note is recorded once, with no number");
});

test("buildGroceryList: an unparseable line survives as an item with no amount", () => {
  const list = listOf(["A", "Whatever you have in the fridge"]);
  const item = findItem(list, "Whatever you have in the fridge");

  assert.ok(item);
  assert.equal(item.category, OTHER_CATEGORY);
  assert.deepEqual(item.amounts, []);
  assert.equal(item.needsCheck, true);
});

test("buildGroceryList: section headings never become shopping items", () => {
  const list = listOf(["Cake", "For the sauce:\n1 cup cream\nFor the topping:\n2 eggs"]);

  assert.equal(list.totalItems, 2);
  assert.equal(findItem(list, "For the sauce"), null);
  assert.equal(findItem(list, "For the topping"), null);
  assert.ok(findItem(list, "cream"));
  assert.ok(findItem(list, "eggs"));
});

test("buildGroceryList: blank, missing and non-string ingredient text contribute nothing", () => {
  const list = buildGroceryList([
    { id: "a", title: "Empty", ingredients: "" },
    { id: "b", title: "Whitespace", ingredients: "   \n\n  \n" },
    { id: "c", title: "Null", ingredients: null },
    { id: "d", title: "Wrong type", ingredients: 42 },
  ]);

  assert.deepEqual(list.categories, []);
  assert.equal(list.totalItems, 0);
  assert.equal(list.recipeCount, 4);
});

test("buildGroceryList: no recipes at all is an empty list, not an error", () => {
  for (const input of [[], null, undefined, "nonsense"]) {
    const list = buildGroceryList(input);
    assert.deepEqual(list.categories, []);
    assert.equal(list.totalItems, 0);
    assert.equal(list.recipeCount, 0);
    assert.equal(list.skippedCount, 0);
  }
});

test("buildGroceryList: skipped count is reported, sanitised and never negative", () => {
  assert.equal(buildGroceryList([], { skippedCount: 2 }).skippedCount, 2);
  assert.equal(buildGroceryList([], { skippedCount: -5 }).skippedCount, 0);
  assert.equal(buildGroceryList([], { skippedCount: "two" }).skippedCount, 0);
  assert.equal(buildGroceryList([]).skippedCount, 0);
});

// ---------------------------------------------------------------------------
// Ordering and provenance
// ---------------------------------------------------------------------------

test("buildGroceryList: categories come back in fixed store order", () => {
  const list = listOf(["A", "1 cup coffee\n2 cups flour\n1 onion\n1 gizmo\n8 oz beef"]);
  const order = GROCERY_CATEGORIES.map((category) => category.key);
  const returned = list.categories.map((category) => category.key);

  assert.deepEqual(
    returned,
    order.filter((key) => returned.includes(key)),
    "returned categories must follow the taxonomy order"
  );
  assert.ok(returned.length > 1);
  assert.ok(!returned.includes("bakery"), "empty categories are not returned");
});

test("buildGroceryList: items are alphabetical within a category", () => {
  const list = listOf(["A", "1 zucchini\n1 apple\n1 onion\n1 carrot"]);
  const produce = list.categories.find((category) => category.key === "produce");
  const names = produce.items.map((item) => item.name.toLowerCase());

  assert.deepEqual(names, [...names].sort());
});

test("buildGroceryList: output is deterministic regardless of recipe order", () => {
  const a = { id: "a", title: "A", ingredients: "2 cups flour\n1 cup milk" };
  const b = { id: "b", title: "B", ingredients: "1 cup flour\n2 cups milk" };

  const forwards = buildGroceryList([a, b]);
  const backwards = buildGroceryList([b, a]);

  assert.deepEqual(
    forwards.categories.map((c) => c.items.map((i) => [i.name, i.amounts])),
    backwards.categories.map((c) => c.items.map((i) => [i.name, i.amounts]))
  );
});

test("buildGroceryList: every item names the recipes it came from", () => {
  const list = listOf(["Pancakes", "2 cups flour"], ["Bread", "1 cup flour\n1 tsp salt"]);

  assert.deepEqual(findItem(list, "flour").recipes, [
    { id: "recipe-0", title: "Pancakes" },
    { id: "recipe-1", title: "Bread" },
  ]);
  assert.deepEqual(findItem(list, "salt").recipes, [{ id: "recipe-1", title: "Bread" }]);

  for (const item of allItems(list)) {
    assert.ok(item.recipes.length > 0, `${item.name} must name a source recipe`);
  }
});

test("buildGroceryList: a recipe contributing the same ingredient twice is listed once", () => {
  const list = buildGroceryList([
    { id: "a", title: "Layered", ingredients: "1 cup flour\n1 cup flour" },
  ]);
  const flour = findItem(list, "flour");

  assert.deepEqual(flour.recipes, [{ id: "a", title: "Layered" }]);
  assert.deepEqual(flour.amounts, ["2 cups"]);
});
