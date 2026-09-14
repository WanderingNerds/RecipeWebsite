/**
 * Grocery list generation (REW-26).
 *
 * Turns the recipes in a meal plan into a printable shopping list grouped by
 * where you would find each item in the store.
 *
 * The module is deliberately pure -- no Supabase, no Express, no `req` --
 * matching mealPlanUtils.js, so every rule below is unit-testable.
 *
 * Two normalisations are used, and they are not the same thing:
 *   - the *grouping key* (prep words stripped, plurals folded) decides which
 *     rows are the same shopping item;
 *   - the *display name* is what the shopper reads, and is what gets
 *     categorised, because "diced tomatoes" belongs in a different aisle than
 *     "tomatoes" even though they group together.
 *
 * Note the consequence: the display name is the shortest spelling the plan
 * contains, so the aisle an item lands in can change as recipes are added.
 * A plan with only "diced tomatoes" files it under Canned & Jarred; add a
 * recipe calling for "tomatoes" and the merged item moves to Produce. That is
 * a deliberate trade (one line per shopping item beats a strictly stable
 * aisle), not an accident.
 */

import { parseIngredients, formatAmount } from "./ingredientParser.js";
import {
  measureRow,
  formatVolume,
  formatGrams,
  formatImperialWeight,
  roundCount,
  METRIC_WEIGHT_UNITS,
} from "./measurements.js";

// ---------------------------------------------------------------------------
// Aisle taxonomy
// ---------------------------------------------------------------------------

/**
 * Store categories in walk-the-store order. Fixed and server-side: this is a
 * presentation grouping, not the `categories` table (which classifies recipes
 * as Breakfast/Dinner/etc. -- a different concept entirely).
 */
export const GROCERY_CATEGORIES = [
  { key: "produce", label: "Produce" },
  { key: "meat-seafood", label: "Meat & Seafood" },
  { key: "dairy-eggs", label: "Dairy & Eggs" },
  { key: "bakery", label: "Bakery" },
  { key: "frozen", label: "Frozen" },
  { key: "canned-jarred", label: "Canned & Jarred" },
  { key: "dry-goods", label: "Dry Goods & Pasta" },
  { key: "baking", label: "Baking" },
  { key: "spices", label: "Spices & Seasonings" },
  { key: "condiments", label: "Condiments & Sauces" },
  { key: "beverages", label: "Beverages" },
  { key: "other", label: "Other" },
];

export const OTHER_CATEGORY = "other";

/**
 * keyword -> category key. Matched longest-first as a whole word, so the more
 * specific entry always wins ("chicken broth" beats "chicken", "black pepper"
 * beats "pepper", "bell pepper" beats both).
 */
const CATEGORY_KEYWORDS = {
  // --- Produce -------------------------------------------------------------
  "apple": "produce",
  "apricot": "produce",
  "artichoke": "produce",
  "arugula": "produce",
  "asparagus": "produce",
  "avocado": "produce",
  "banana": "produce",
  "basil": "produce",
  "beet": "produce",
  "bell pepper": "produce",
  "blackberry": "produce",
  "blackberries": "produce",
  "blueberry": "produce",
  "blueberries": "produce",
  "bok choy": "produce",
  "broccoli": "produce",
  "brussels sprout": "produce",
  "cabbage": "produce",
  "cantaloupe": "produce",
  "carrot": "produce",
  "cauliflower": "produce",
  "celery": "produce",
  "chard": "produce",
  "cherry": "produce",
  "cherries": "produce",
  "chive": "produce",
  "cilantro": "produce",
  "cranberry": "produce",
  "cranberries": "produce",
  "cucumber": "produce",
  "dill": "produce",
  "eggplant": "produce",
  "fennel": "produce",
  "garlic": "produce",
  "ginger": "produce",
  "grape": "produce",
  "grapefruit": "produce",
  "green bean": "produce",
  "green onion": "produce",
  "green pepper": "produce",
  "habanero": "produce",
  "jalapeno": "produce",
  "kale": "produce",
  "kiwi": "produce",
  "leek": "produce",
  "lemon": "produce",
  "lemon juice": "produce",
  "lettuce": "produce",
  "lime": "produce",
  "lime juice": "produce",
  "mango": "produce",
  "mint": "produce",
  "mushroom": "produce",
  "nectarine": "produce",
  "okra": "produce",
  "onion": "produce",
  "orange": "produce",
  "oregano": "produce",
  "parsley": "produce",
  "parsnip": "produce",
  "pea": "produce",
  "peach": "produce",
  "pear": "produce",
  "pineapple": "produce",
  "plum": "produce",
  "pomegranate": "produce",
  "potato": "produce",
  "pumpkin": "produce",
  "radish": "produce",
  "raspberry": "produce",
  "raspberries": "produce",
  "red onion": "produce",
  "red pepper": "produce",
  "romaine": "produce",
  "rosemary": "produce",
  "sage": "produce",
  "scallion": "produce",
  "serrano": "produce",
  "shallot": "produce",
  "spinach": "produce",
  "squash": "produce",
  "strawberry": "produce",
  "strawberries": "produce",
  "sweet potato": "produce",
  "thyme": "produce",
  "tomato": "produce",
  "turnip": "produce",
  "watercress": "produce",
  "watermelon": "produce",
  "yellow onion": "produce",
  "zucchini": "produce",

  // --- Meat & Seafood ------------------------------------------------------
  "anchovy": "meat-seafood",
  "anchovies": "meat-seafood",
  "bacon": "meat-seafood",
  "beef": "meat-seafood",
  "brisket": "meat-seafood",
  "chicken": "meat-seafood",
  "chicken breast": "meat-seafood",
  "chicken thigh": "meat-seafood",
  "chorizo": "meat-seafood",
  "clam": "meat-seafood",
  "cod": "meat-seafood",
  "crab": "meat-seafood",
  "duck": "meat-seafood",
  "fish": "meat-seafood",
  "ground beef": "meat-seafood",
  "ground pork": "meat-seafood",
  "ground turkey": "meat-seafood",
  "halibut": "meat-seafood",
  "ham": "meat-seafood",
  "lamb": "meat-seafood",
  "lobster": "meat-seafood",
  "mussel": "meat-seafood",
  "oyster": "meat-seafood",
  "pancetta": "meat-seafood",
  "pepperoni": "meat-seafood",
  "pork": "meat-seafood",
  "prosciutto": "meat-seafood",
  "salami": "meat-seafood",
  "salmon": "meat-seafood",
  "sausage": "meat-seafood",
  "scallop": "meat-seafood",
  "shrimp": "meat-seafood",
  "sirloin": "meat-seafood",
  "steak": "meat-seafood",
  "tilapia": "meat-seafood",
  "tofu": "meat-seafood",
  "tuna": "meat-seafood",
  "turkey": "meat-seafood",
  "veal": "meat-seafood",

  // --- Dairy & Eggs --------------------------------------------------------
  "almond milk": "dairy-eggs",
  "brie": "dairy-eggs",
  "butter": "dairy-eggs",
  "buttermilk": "dairy-eggs",
  "cheddar": "dairy-eggs",
  "cheese": "dairy-eggs",
  "cottage cheese": "dairy-eggs",
  "cream": "dairy-eggs",
  "cream cheese": "dairy-eggs",
  "creme fraiche": "dairy-eggs",
  "egg": "dairy-eggs",
  "egg white": "dairy-eggs",
  "egg yolk": "dairy-eggs",
  "feta": "dairy-eggs",
  "ghee": "dairy-eggs",
  "goat cheese": "dairy-eggs",
  "gouda": "dairy-eggs",
  "gruyere": "dairy-eggs",
  "half and half": "dairy-eggs",
  "heavy cream": "dairy-eggs",
  "milk": "dairy-eggs",
  "mozzarella": "dairy-eggs",
  "oat milk": "dairy-eggs",
  "parmesan": "dairy-eggs",
  "provolone": "dairy-eggs",
  "ricotta": "dairy-eggs",
  "sour cream": "dairy-eggs",
  "soy milk": "dairy-eggs",
  "swiss": "dairy-eggs",
  "unsalted butter": "dairy-eggs",
  "whipping cream": "dairy-eggs",
  "whole milk": "dairy-eggs",
  "yogurt": "dairy-eggs",

  // --- Bakery --------------------------------------------------------------
  "bagel": "bakery",
  "baguette": "bakery",
  "bread": "bakery",
  "brioche": "bakery",
  "bun": "bakery",
  "ciabatta": "bakery",
  "croissant": "bakery",
  "english muffin": "bakery",
  "focaccia": "bakery",
  "hamburger bun": "bakery",
  "hot dog bun": "bakery",
  "naan": "bakery",
  "pie crust": "bakery",
  "pita": "bakery",
  "pizza dough": "bakery",
  "sourdough": "bakery",
  "tortilla": "bakery",

  // --- Frozen --------------------------------------------------------------
  "frozen": "frozen",
  "ice cream": "frozen",
  "phyllo dough": "frozen",
  "puff pastry": "frozen",

  // --- Canned & Jarred -----------------------------------------------------
  "artichoke heart": "canned-jarred",
  "beef broth": "canned-jarred",
  "black bean": "canned-jarred",
  "broth": "canned-jarred",
  "canned tomato": "canned-jarred",
  "cannellini bean": "canned-jarred",
  "caper": "canned-jarred",
  "chicken broth": "canned-jarred",
  "chicken stock": "canned-jarred",
  "chickpea": "canned-jarred",
  "coconut milk": "canned-jarred",
  "condensed milk": "canned-jarred",
  "crushed tomato": "canned-jarred",
  "diced tomato": "canned-jarred",
  "evaporated milk": "canned-jarred",
  "garbanzo": "canned-jarred",
  "kidney bean": "canned-jarred",
  "marinara": "canned-jarred",
  "olive": "canned-jarred",
  "pasta sauce": "canned-jarred",
  "pickle": "canned-jarred",
  "pinto bean": "canned-jarred",
  "pumpkin puree": "canned-jarred",
  "refried bean": "canned-jarred",
  "roasted red pepper": "canned-jarred",
  "stock": "canned-jarred",
  "sun dried tomato": "canned-jarred",
  "tomato paste": "canned-jarred",
  "tomato puree": "canned-jarred",
  "tomato sauce": "canned-jarred",
  "vegetable broth": "canned-jarred",
  "vegetable stock": "canned-jarred",
  "water chestnut": "canned-jarred",

  // --- Dry Goods & Pasta ---------------------------------------------------
  "almond": "dry-goods",
  "barley": "dry-goods",
  "breadcrumb": "dry-goods",
  "brown rice": "dry-goods",
  "bulgur": "dry-goods",
  "cashew": "dry-goods",
  "cereal": "dry-goods",
  "couscous": "dry-goods",
  "cracker": "dry-goods",
  "dried bean": "dry-goods",
  "egg noodle": "dry-goods",
  "farro": "dry-goods",
  "fettuccine": "dry-goods",
  "lasagna noodle": "dry-goods",
  "lentil": "dry-goods",
  "linguine": "dry-goods",
  "macaroni": "dry-goods",
  "noodle": "dry-goods",
  "oat": "dry-goods",
  "orzo": "dry-goods",
  "panko": "dry-goods",
  "pasta": "dry-goods",
  "peanut": "dry-goods",
  "pecan": "dry-goods",
  "penne": "dry-goods",
  "pistachio": "dry-goods",
  "pumpkin seed": "dry-goods",
  "quinoa": "dry-goods",
  "raisin": "dry-goods",
  "rice": "dry-goods",
  "rice noodle": "dry-goods",
  "rigatoni": "dry-goods",
  "rolled oat": "dry-goods",
  "spaghetti": "dry-goods",
  "sunflower seed": "dry-goods",
  "tortilla chip": "dry-goods",
  "walnut": "dry-goods",
  "wild rice": "dry-goods",

  // --- Baking --------------------------------------------------------------
  "active dry yeast": "baking",
  "all purpose flour": "baking",
  "all-purpose flour": "baking",
  "almond extract": "baking",
  "almond flour": "baking",
  "baking powder": "baking",
  "baking soda": "baking",
  "bicarbonate of soda": "baking",
  "bread flour": "baking",
  "brown sugar": "baking",
  "cake flour": "baking",
  "caster sugar": "baking",
  "chocolate": "baking",
  "chocolate chip": "baking",
  "cocoa powder": "baking",
  "confectioners sugar": "baking",
  "corn syrup": "baking",
  "cornmeal": "baking",
  "cornstarch": "baking",
  "cream of tartar": "baking",
  "flour": "baking",
  "food coloring": "baking",
  "gelatin": "baking",
  "honey": "baking",
  "icing sugar": "baking",
  "maple syrup": "baking",
  "marshmallow": "baking",
  "molasses": "baking",
  "powdered sugar": "baking",
  "shortening": "baking",
  "shredded coconut": "baking",
  "sprinkles": "baking",
  "sugar": "baking",
  "vanilla extract": "baking",
  "whole wheat flour": "baking",
  "yeast": "baking",

  // --- Spices & Seasonings -------------------------------------------------
  "allspice": "spices",
  "bay leaf": "spices",
  "black pepper": "spices",
  "cardamom": "spices",
  "cayenne": "spices",
  "chili powder": "spices",
  "cinnamon": "spices",
  "coriander seed": "spices",
  "cumin": "spices",
  "curry powder": "spices",
  "dried basil": "spices",
  "dried oregano": "spices",
  "dried parsley": "spices",
  "dried rosemary": "spices",
  "dried thyme": "spices",
  "fennel seed": "spices",
  "garlic powder": "spices",
  "ground cinnamon": "spices",
  "ground clove": "spices",
  "ground cumin": "spices",
  "ground ginger": "spices",
  "ground nutmeg": "spices",
  "italian seasoning": "spices",
  "kosher salt": "spices",
  "mustard seed": "spices",
  "nutmeg": "spices",
  "onion powder": "spices",
  "paprika": "spices",
  "pepper": "spices",
  "poppy seed": "spices",
  "red pepper flake": "spices",
  "saffron": "spices",
  "salt": "spices",
  "sea salt": "spices",
  "sesame seed": "spices",
  "smoked paprika": "spices",
  "star anise": "spices",
  "table salt": "spices",
  "taco seasoning": "spices",
  "turmeric": "spices",
  "vanilla bean": "spices",
  "white pepper": "spices",

  // --- Condiments & Sauces -------------------------------------------------
  "apple cider vinegar": "condiments",
  "balsamic vinegar": "condiments",
  "barbecue sauce": "condiments",
  "bbq sauce": "condiments",
  "canola oil": "condiments",
  "coconut oil": "condiments",
  "fish sauce": "condiments",
  "hoisin sauce": "condiments",
  "horseradish": "condiments",
  "hot sauce": "condiments",
  "hummus": "condiments",
  "jam": "condiments",
  "jelly": "condiments",
  "ketchup": "condiments",
  "mayo": "condiments",
  "mayonnaise": "condiments",
  "mustard": "condiments",
  "oil": "condiments",
  "olive oil": "condiments",
  "oyster sauce": "condiments",
  "peanut butter": "condiments",
  "red wine vinegar": "condiments",
  "rice vinegar": "condiments",
  "pesto": "condiments",
  "salad dressing": "condiments",
  "salsa": "condiments",
  "sesame oil": "condiments",
  "soy sauce": "condiments",
  "sriracha": "condiments",
  "tahini": "condiments",
  "vegetable oil": "condiments",
  "vinegar": "condiments",
  "white wine vinegar": "condiments",
  "worcestershire sauce": "condiments",

  // --- Beverages -----------------------------------------------------------
  "apple juice": "beverages",
  "beer": "beverages",
  "coffee": "beverages",
  "cola": "beverages",
  "juice": "beverages",
  "orange juice": "beverages",
  "red wine": "beverages",
  "soda": "beverages",
  "sparkling water": "beverages",
  "tea": "beverages",
  "water": "beverages",
  "white wine": "beverages",
  "wine": "beverages",
};

const VALID_CATEGORY_KEYS = new Set(GROCERY_CATEGORIES.map((category) => category.key));

// ---------------------------------------------------------------------------
// Name normalisation
// ---------------------------------------------------------------------------

/**
 * Escapes regex metacharacters. Category patterns are only ever built from
 * these escaped *literal taxonomy keys* -- never from user-supplied ingredient
 * text -- so no user input can ever reach the regex compiler.
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every taxonomy pattern, compiled once at module load rather than per item
 * per request -- the keys are static, so there is nothing to rebuild. Sorted
 * longest-first so the most specific keyword wins, exactly like the density
 * lookup in measurements.js.
 */
const CATEGORY_MATCHERS = Object.keys(CATEGORY_KEYWORDS)
  .sort((a, b) => b.length - a.length)
  .map((key) => ({
    pattern: new RegExp(`\\b${escapeRegExp(key)}(?:e?s)?\\b`),
    category: CATEGORY_KEYWORDS[key],
  }));

/**
 * Lowercases, drops punctuation and collapses whitespace.
 *
 * Only Latin letters and digits survive, because that is what the taxonomy is
 * written in. Callers must therefore cope with an empty result: an ingredient
 * written in another script is not a nameless ingredient.
 *
 * @param {*} name
 * @returns {string}
 */
function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Words that describe how an ingredient was cut or how it looked, not what you
 * buy. Stripped for grouping only, so "1 cup chopped onion" and "2 onions"
 * land on the same shopping line.
 *
 * Words that change *what you buy* are deliberately absent, however
 * preparation-like they read. "cooked" is the clearest example: a cup of
 * cooked rice and a cup of dry rice are different goods, so merging them would
 * put a wrong number on the list -- exactly what this module exists to avoid.
 * "drained" is left out for the same reason (drained weight is not purchase
 * weight). Two honest lines beat one tidy wrong one.
 */
const PREP_WORDS = new Set([
  "beaten", "chopped", "coarsely", "crushed", "cubed", "diced",
  "divided", "finely", "fresh", "freshly", "grated", "halved",
  "julienned", "large", "lightly", "medium", "melted", "minced", "optional",
  "packed", "peeled", "quartered", "rinsed", "ripe", "roughly", "shredded",
  "sliced", "small", "softened", "thinly", "trimmed",
]);

/** Plurals the general rules below would mangle ("leaves" -> "leave"). */
const IRREGULAR_PLURALS = {
  halves: "half",
  leaves: "leaf",
  loaves: "loaf",
};

/**
 * Folds the simple English plurals that show up in ingredient lists.
 * Deliberately conservative: it would rather leave a word alone than mangle it.
 * @param {string} word
 * @returns {string}
 */
function foldPlural(word) {
  if (IRREGULAR_PLURALS[word]) return IRREGULAR_PLURALS[word];
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/(ses|xes|zes|ches|shes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/**
 * The key that decides whether two ingredient lines are the same shopping
 * item: lowercase, punctuation-free, prep words removed, plurals folded.
 *
 * Implemented here rather than reusing measurements.js's private normalizer
 * because grocery grouping needs plural folding and prep stripping that a
 * density lookup must not do.
 *
 * A name with no Latin letters or digits at all -- "小麦粉", "醬油", an
 * emoji -- normalises to nothing, but it is still a real ingredient somebody
 * has to buy. It falls back to grouping on its own collapsed text so it
 * reaches the list (under "Other") instead of vanishing from it. Recipe import
 * ingests ingredient text from arbitrary URLs, so this is not a hypothetical.
 *
 * @param {*} name
 * @returns {string} Empty string only when there is genuinely no text at all.
 */
export function groceryItemKey(name) {
  const normalized = normalizeName(name);
  if (!normalized) {
    return String(name || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  const words = normalized.split(" ").filter(Boolean);
  const kept = words.filter((word) => !PREP_WORDS.has(word));
  const source = kept.length ? kept : words;

  return source.map(foldPlural).join(" ").trim();
}

// ---------------------------------------------------------------------------
// Categorisation
// ---------------------------------------------------------------------------

/**
 * Resolves an ingredient name to a store category key.
 *
 * Keys are tried longest-first and matched as whole words with simple plural
 * tolerance, the same technique `findKey` uses in measurements.js. Anything
 * unrecognised lands in "other" rather than being guessed at.
 *
 * @param {*} name
 * @returns {string} One of GROCERY_CATEGORIES' keys.
 */
export function categorizeIngredient(name) {
  const normalized = normalizeName(name);
  if (!normalized) return OTHER_CATEGORY;

  for (const matcher of CATEGORY_MATCHERS) {
    if (matcher.pattern.test(normalized)) return matcher.category;
  }

  return OTHER_CATEGORY;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function createItem(key, name) {
  return {
    key,
    name,
    recipes: [],
    recipeIds: new Set(),
    volume: null, // { ml, metric }
    weight: null, // { grams, metric }
    counts: new Map(), // unit ("" for a bare count) -> bucket
    extraAmounts: [], // measured amounts that could not be combined
    notes: [], // "to taste", "for drizzling" -- text, never a number
    seenNotes: new Set(),
  };
}

/**
 * Keeps the most representative display name: the shortest one wins, ties
 * broken alphabetically, so the result is the same whatever order the recipes
 * were loaded in.
 */
function recordName(item, name) {
  const current = item.name;
  if (name.length < current.length || (name.length === current.length && name < current)) {
    item.name = name;
  }
}

function recordRecipe(item, source) {
  const id = source.id === null || source.id === undefined ? source.title : source.id;
  if (item.recipeIds.has(id)) return;
  item.recipeIds.add(id);
  item.recipes.push({ id: source.id, title: source.title });
}

/**
 * Records an amount that cannot honestly be added to anything else, exactly as
 * the recipe wrote it. Note-only entries ("to taste") are de-duplicated; real
 * amounts never are, because two recipes each needing a pinch need two.
 */
function pushAmount(item, text) {
  const trimmed = String(text || "").trim();
  if (trimmed) item.extraAmounts.push(trimmed);
}

/**
 * Records text that describes an amount without being one ("to taste", "for
 * drizzling", "chopped"). Kept apart from real amounts so the view can show it
 * as a muted aside rather than in the amount column, where it would read as a
 * quantity and -- worse -- suppress the "check recipe" hint. De-duplicated,
 * because three recipes saying "to taste" is still just "to taste".
 */
function pushNote(item, text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;

  const seen = trimmed.toLowerCase();
  if (item.seenNotes.has(seen)) return;
  item.seenNotes.add(seen);
  item.notes.push(trimmed);
}

/**
 * Folds one parsed row into an item, but only where the measurements are
 * genuinely compatible. Two honest amounts beat one invented number.
 */
function accumulate(item, row) {
  const hasQuantity = row.quantity !== null && Number.isFinite(row.quantity);

  if (!hasQuantity) {
    // "Salt and pepper to taste" -- no number to add, so keep what was written.
    item.needsCheck = true;
    pushVerbatim(item, row.note, true);
    return;
  }

  // A range ("2-3 cloves") cannot be summed without inventing a number.
  if (row.quantityMax !== null) {
    pushVerbatim(item, formatAmount(row), false);
    return;
  }

  if (row.unitType === "volume") {
    const measured = measureRow(row);
    if (measured.ml !== null) {
      item.volumeMl = (item.volumeMl || 0) + measured.ml;
      return;
    }
  }

  if (row.unitType === "weight") {
    const measured = measureRow(row);
    if (measured.grams !== null) {
      const isMetric = METRIC_WEIGHT_UNITS.has(row.unit);
      item.weight = item.weight
        ? { grams: item.weight.grams + measured.grams, metric: item.weight.metric && isMetric }
        : { grams: measured.grams, metric: isMetric };
      return;
    }
  }

  // Counted things (and bare counts like "2 onions") combine when the unit is
  // identical. Lengths behave the same way.
  if (row.unit === null || row.unitType === "count" || row.unitType === "length") {
    const bucketKey = row.unit || "";
    const bucket = item.counts.get(bucketKey);

    if (bucket) {
      bucket.total += row.quantity;
    } else {
      item.counts.set(bucketKey, {
        total: row.quantity,
        unit: row.unit,
        unitText: row.unitText,
        unitType: row.unitType,
        unitIsAbbreviation: row.unitIsAbbreviation,
      });
    }
    return;
  }

  // Approximate amounts ("a pinch") and anything else stay as written.
  pushVerbatim(item, formatAmount(row), false);
}

/**
 * Renders an item's accumulated buckets into display strings, in a fixed
 * order so the output is deterministic.
 * @returns {string[]}
 */
function renderAmounts(item) {
  const amounts = [];

  if (item.volumeMl !== null) {
    const volume = formatVolume(item.volumeMl);
    if (volume) amounts.push(volume);
  }

  if (item.weight !== null) {
    const weight = item.weight.metric
      ? formatGrams(item.weight.grams)
      : formatImperialWeight(item.weight.grams);
    if (weight) amounts.push(weight);
  }

  for (const countKey of [...item.counts.keys()].sort()) {
    const bucket = item.counts.get(countKey);
    const rounded = roundCount(bucket.total, bucket.unit, bucket.unitType);
    const amount = formatAmount({
      quantity: rounded,
      quantityMax: null,
      unit: bucket.unit,
      unitText: bucket.unitText,
      unitIsAbbreviation: bucket.unitIsAbbreviation,
    });
    if (amount) amounts.push(amount);
  }

  amounts.push(...item.verbatim);

  return amounts;
}

/**
 * @typedef {Object} GroceryItem
 * @property {string} key         Normalised grouping key.
 * @property {string} name        Display name.
 * @property {string[]} amounts   One entry per compatible measurement group.
 * @property {boolean} needsCheck At least one source line had no usable amount.
 * @property {{id: *, title: string}[]} recipes Where the item came from.
 */

/**
 * @typedef {Object} GroceryList
 * @property {{key: string, label: string, items: GroceryItem[]}[]} categories
 *   Non-empty categories only, in fixed store order.
 * @property {number} totalItems
 * @property {number} recipeCount   Recipes that went into the list.
 * @property {number} skippedCount  Plan entries that could not be read.
 */

/**
 * Builds a grouped, printable grocery list from a meal plan's recipes.
 *
 * @param {{id: *, title: string, ingredients: string}[]} recipes
 * @param {{skippedCount?: number}} [options]
 * @returns {GroceryList}
 */
export function buildGroceryList(recipes, options = {}) {
  const skippedRaw = Number(options?.skippedCount);
  const skippedCount = Number.isFinite(skippedRaw) && skippedRaw > 0 ? Math.trunc(skippedRaw) : 0;

  const sourceRecipes = Array.isArray(recipes) ? recipes : [];
  const items = new Map();
  let recipeCount = 0;

  for (const recipe of sourceRecipes) {
    if (!recipe || typeof recipe !== "object") continue;
    recipeCount += 1;

    const source = {
      id: recipe.id === undefined ? null : recipe.id,
      title: typeof recipe.title === "string" ? recipe.title : "",
    };

    for (const row of parseIngredients(recipe.ingredients)) {
      // Section headings ("For the sauce:") are not shopping items.
      if (row.type === "section") continue;

      const name = String(row.ingredient || "").trim();
      if (!name) continue;

      const key = groceryItemKey(name);
      if (!key) continue;

      let item = items.get(key);
      if (!item) {
        item = createItem(key, name);
        items.set(key, item);
      }

      recordName(item, name);
      recordRecipe(item, source);
      accumulate(item, row);
    }
  }

  const grouped = new Map(GROCERY_CATEGORIES.map((category) => [category.key, []]));

  for (const item of items.values()) {
    const categoryKey = categorizeIngredient(item.name);
    const bucket = grouped.get(VALID_CATEGORY_KEYS.has(categoryKey) ? categoryKey : OTHER_CATEGORY);

    bucket.push({
      key: item.key,
      name: item.name,
      amounts: renderAmounts(item),
      needsCheck: item.needsCheck,
      recipes: item.recipes,
    });
  }

  const categories = [];
  let totalItems = 0;

  for (const category of GROCERY_CATEGORIES) {
    const bucket = grouped.get(category.key);
    if (!bucket.length) continue;

    bucket.sort((a, b) => {
      const left = a.name.toLowerCase();
      const right = b.name.toLowerCase();
      if (left !== right) return left < right ? -1 : 1;
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      return 0;
    });

    totalItems += bucket.length;
    categories.push({ key: category.key, label: category.label, items: bucket });
  }

  return { categories, totalItems, recipeCount, skippedCount };
}
