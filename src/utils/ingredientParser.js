/**
 * Ingredient parsing engine.
 *
 * Converts the free-text ingredients a user types into the recipe form
 * (one ingredient per line) into structured rows of
 * { quantity, unit, ingredient } so they can be scaled and displayed.
 *
 * The parser is deliberately forgiving: anything it cannot confidently
 * interpret is kept in `ingredient` and the original text is always
 * preserved in `raw`, so nothing the user typed is ever lost.
 */

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/**
 * Unit definitions. `aliases` are full words (pluralised automatically on
 * lookup), `abbreviations` are short forms that are never pluralised when
 * a quantity is re-rendered (e.g. "2 tsp", not "2 tsps").
 */
const UNIT_DEFINITIONS = [
  // Volume
  { canonical: "teaspoon", type: "volume", aliases: ["teaspoon"], abbreviations: ["tsp", "tsps", "tspn", "ts", "t"] },
  { canonical: "tablespoon", type: "volume", aliases: ["tablespoon"], abbreviations: ["tbsp", "tbsps", "tbs", "tbl", "tblsp", "T"] },
  { canonical: "cup", type: "volume", aliases: ["cup"], abbreviations: ["c"] },
  { canonical: "fluid ounce", type: "volume", aliases: ["fluid ounce"], abbreviations: ["fl oz", "floz", "fl. oz", "fl"] },
  { canonical: "pint", type: "volume", aliases: ["pint"], abbreviations: ["pt", "pts"] },
  { canonical: "quart", type: "volume", aliases: ["quart"], abbreviations: ["qt", "qts"] },
  { canonical: "gallon", type: "volume", aliases: ["gallon"], abbreviations: ["gal", "gals"] },
  { canonical: "milliliter", type: "volume", aliases: ["milliliter", "millilitre"], abbreviations: ["ml", "mL"] },
  { canonical: "centiliter", type: "volume", aliases: ["centiliter", "centilitre"], abbreviations: ["cl"] },
  { canonical: "deciliter", type: "volume", aliases: ["deciliter", "decilitre"], abbreviations: ["dl"] },
  { canonical: "liter", type: "volume", aliases: ["liter", "litre"], abbreviations: ["l", "L"] },

  // Weight
  { canonical: "gram", type: "weight", aliases: ["gram", "gramme"], abbreviations: ["g", "gr", "gm", "gms"] },
  { canonical: "kilogram", type: "weight", aliases: ["kilogram", "kilogramme", "kilo"], abbreviations: ["kg", "kgs"] },
  { canonical: "milligram", type: "weight", aliases: ["milligram"], abbreviations: ["mg"] },
  { canonical: "ounce", type: "weight", aliases: ["ounce"], abbreviations: ["oz", "ozs"] },
  { canonical: "pound", type: "weight", aliases: ["pound"], abbreviations: ["lb", "lbs", "#"] },

  // Length
  { canonical: "inch", type: "length", plural: "inches", aliases: ["inch", "inches"], abbreviations: ["in"] },
  { canonical: "centimeter", type: "length", aliases: ["centimeter", "centimetre"], abbreviations: ["cm"] },

  // Approximate / non-scaling-friendly amounts
  { canonical: "pinch", type: "approximate", plural: "pinches", aliases: ["pinch", "pinches"], abbreviations: [] },
  { canonical: "dash", type: "approximate", plural: "dashes", aliases: ["dash", "dashes"], abbreviations: [] },
  { canonical: "splash", type: "approximate", plural: "splashes", aliases: ["splash", "splashes"], abbreviations: [] },
  { canonical: "drop", type: "approximate", aliases: ["drop"], abbreviations: [] },
  { canonical: "handful", type: "approximate", aliases: ["handful"], abbreviations: [] },

  // Counts / containers / natural units
  { canonical: "can", type: "count", aliases: ["can"], abbreviations: [] },
  { canonical: "jar", type: "count", aliases: ["jar"], abbreviations: [] },
  { canonical: "bottle", type: "count", aliases: ["bottle"], abbreviations: [] },
  { canonical: "package", type: "count", aliases: ["package", "packet"], abbreviations: ["pkg", "pkgs"] },
  { canonical: "container", type: "count", aliases: ["container"], abbreviations: [] },
  { canonical: "envelope", type: "count", aliases: ["envelope"], abbreviations: [] },
  { canonical: "bag", type: "count", aliases: ["bag"], abbreviations: [] },
  { canonical: "box", type: "count", plural: "boxes", aliases: ["box", "boxes"], abbreviations: [] },
  { canonical: "bunch", type: "count", plural: "bunches", aliases: ["bunch", "bunches"], abbreviations: [] },
  { canonical: "clove", type: "count", aliases: ["clove"], abbreviations: [] },
  { canonical: "head", type: "count", aliases: ["head"], abbreviations: [] },
  { canonical: "stalk", type: "count", aliases: ["stalk"], abbreviations: [] },
  { canonical: "sprig", type: "count", aliases: ["sprig"], abbreviations: [] },
  { canonical: "stick", type: "count", aliases: ["stick"], abbreviations: [] },
  { canonical: "slice", type: "count", aliases: ["slice"], abbreviations: [] },
  { canonical: "piece", type: "count", aliases: ["piece"], abbreviations: [] },
  { canonical: "strip", type: "count", aliases: ["strip"], abbreviations: [] },
  { canonical: "cube", type: "count", aliases: ["cube"], abbreviations: [] },
  { canonical: "scoop", type: "count", aliases: ["scoop"], abbreviations: [] },
  { canonical: "block", type: "count", aliases: ["block"], abbreviations: [] },
  { canonical: "sheet", type: "count", aliases: ["sheet"], abbreviations: [] },
  { canonical: "leaf", type: "count", plural: "leaves", aliases: ["leaf", "leaves"], abbreviations: [] },
  { canonical: "loaf", type: "count", plural: "loaves", aliases: ["loaf", "loaves"], abbreviations: [] },
  { canonical: "ear", type: "count", aliases: ["ear"], abbreviations: [] },
  { canonical: "fillet", type: "count", aliases: ["fillet", "filet"], abbreviations: [] },
  { canonical: "rib", type: "count", aliases: ["rib"], abbreviations: [] },
  { canonical: "dozen", type: "count", aliases: ["dozen"], abbreviations: [] },
];

/**
 * alias (lowercased) -> { canonical, type, isAbbreviation }
 * Single-letter abbreviations are ambiguous between cases ("t" vs "T"), so
 * they are resolved separately in `lookupUnit`.
 */
const UNIT_LOOKUP = new Map();
const CASE_SENSITIVE_UNITS = new Map();

for (const def of UNIT_DEFINITIONS) {
  for (const alias of def.aliases) {
    const entry = { def, isAbbreviation: false };
    UNIT_LOOKUP.set(alias.toLowerCase(), entry);
    UNIT_LOOKUP.set(pluralizeWord(alias, def.plural), entry);
  }
  for (const abbr of def.abbreviations) {
    const entry = { def, isAbbreviation: true };
    // "T" (tablespoon) vs "t" (teaspoon) and friends must stay case sensitive.
    if (abbr.length === 1 && abbr !== abbr.toLowerCase()) {
      CASE_SENSITIVE_UNITS.set(abbr, entry);
    } else if (abbr.length === 1) {
      CASE_SENSITIVE_UNITS.set(abbr, entry);
      UNIT_LOOKUP.set(abbr, entry);
    } else {
      UNIT_LOOKUP.set(abbr.toLowerCase(), entry);
    }
  }
}

function pluralizeWord(word, explicitPlural) {
  if (explicitPlural) return explicitPlural.toLowerCase();
  const lower = word.toLowerCase();
  if (/(s|x|ch|sh)$/.test(lower)) return `${lower}es`;
  return `${lower}s`;
}

/**
 * Looks up a unit token, tolerating a trailing period and plural forms.
 * @param {string} token - The token as the user wrote it.
 * @returns {{def: object, isAbbreviation: boolean}|null}
 */
function lookupUnit(token) {
  const cleaned = token.replace(/\.$/, "");
  if (!cleaned) return null;

  if (CASE_SENSITIVE_UNITS.has(cleaned)) return CASE_SENSITIVE_UNITS.get(cleaned);
  if (cleaned.length === 1) return null; // unknown single letter, don't guess

  const lower = cleaned.toLowerCase();
  return UNIT_LOOKUP.get(lower) || null;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const UNICODE_FRACTIONS = {
  "¼": "1/4", "½": "1/2", "¾": "3/4",
  "⅐": "1/7", "⅑": "1/9", "⅒": "1/10",
  "⅓": "1/3", "⅔": "2/3",
  "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5",
  "⅙": "1/6", "⅚": "5/6",
  "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};

const WORD_NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  half: 0.5, quarter: 0.25, third: 1 / 3, couple: 2, dozen: 12,
};

// Mixed number, fraction, decimal or integer - longest form first.
const NUMBER_PATTERN = String.raw`\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*\.\d+|\d+`;
const RANGE_SEPARATOR = String.raw`\s*(?:-|–|—|~|\bto\b|\bor\b)\s*`;

/**
 * Converts a numeric string ("1 1/2", "3/4", ".5", "2") to a number.
 * @param {string} text
 * @returns {number|null}
 */
export function numberFromString(text) {
  const trimmed = text.trim().replace(/\s*\/\s*/g, "/");

  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const denominator = Number(mixed[3]);
    if (denominator === 0) return null;
    return Number(mixed[1]) + Number(mixed[2]) / denominator;
  }

  const fraction = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return Number(fraction[1]) / denominator;
  }

  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Line normalisation
// ---------------------------------------------------------------------------

const BULLET_PATTERN = /^[\s>*•‣·◦▪+]+/;

/**
 * Normalises whitespace and expands unicode fractions so the rest of the
 * parser only has to deal with plain ASCII numbers.
 * @param {string} line
 * @returns {string}
 */
function normalizeLine(line) {
  let text = line
    .replace(/[   ]/g, " ") // non-breaking spaces
    .replace(/⁄/g, "/"); // fraction slash

  // "1½" -> "1 1/2", "½" -> "1/2"
  text = text.replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (match) => ` ${UNICODE_FRACTIONS[match]} `);

  // Leading bullets, but never a leading "-" that could start a negative
  // range; ingredient lines don't have negative amounts so "- 2 cups" is safe.
  text = text.replace(/^\s*[-–—]\s+/, "");
  text = text.replace(BULLET_PATTERN, "");

  return text.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Trailing phrases that describe how an ingredient is used rather than what it
 * is ("to taste", "for dusting"). Matched at the end of a line and moved into
 * the notes so the ingredient name stays clean.
 */
const TRAILING_MODIFIER_PATTERNS = [
  String.raw`(?:or\s+)?to taste`,
  String.raw`as needed`,
  String.raw`as desired`,
  String.raw`if needed`,
  String.raw`optional`,
  String.raw`divided`,
  String.raw`plus (?:more|extra)(?:\s+\w+){0,4}`,
  String.raw`for (?:the\s+)?\w+(?:\s+\w+)?`,
].map((source) => new RegExp(`[,;]?\\s*\\b${source}\\b\\.?$`, "i"));

/**
 * Pulls parenthetical asides out of a line so they don't confuse quantity and
 * unit detection, e.g. "1 (14 oz) can tomatoes".
 * @param {string} text
 * @returns {{text: string, notes: string[]}}
 */
function extractParentheticals(text) {
  const notes = [];
  const stripped = text.replace(/\(([^)]*)\)/g, (_match, inner) => {
    const note = inner.trim();
    if (note) notes.push(note);
    return " ";
  });
  return { text: stripped.replace(/\s+/g, " ").trim(), notes };
}

/**
 * Reads a quantity (including ranges, mixed numbers, word numbers and
 * "2 x 400 g" multipliers) from the start of the text.
 * @param {string} text
 * @returns {{value: number, valueMax: number|null, text: string, rest: string}|null}
 */
function parseQuantity(text) {
  const rangeMatch = text.match(new RegExp(`^(${NUMBER_PATTERN})${RANGE_SEPARATOR}(${NUMBER_PATTERN})`));
  if (rangeMatch) {
    const min = numberFromString(rangeMatch[1]);
    const max = numberFromString(rangeMatch[2]);
    if (min !== null && max !== null && max >= min) {
      return {
        value: min,
        valueMax: max,
        text: rangeMatch[0].trim(),
        rest: text.slice(rangeMatch[0].length),
      };
    }
  }

  const numberMatch = text.match(new RegExp(`^(${NUMBER_PATTERN})`));
  if (numberMatch) {
    const value = numberFromString(numberMatch[1]);
    if (value !== null) {
      return { value, valueMax: null, text: numberMatch[1].trim(), rest: text.slice(numberMatch[0].length) };
    }
  }

  // Word quantities: "a pinch of salt", "two eggs", "half a lemon".
  const wordMatch = text.match(/^([A-Za-z]+)\b/);
  if (wordMatch) {
    const value = WORD_NUMBERS[wordMatch[1].toLowerCase()];
    if (value !== undefined) {
      return { value, valueMax: null, text: wordMatch[1], rest: text.slice(wordMatch[0].length) };
    }
  }

  return null;
}

/**
 * Handles "2 x 400 g flour" by folding the multiplier into a single total.
 * @param {{value: number, valueMax: number|null, text: string, rest: string}} quantity
 * @returns {{value: number, valueMax: number|null, text: string, rest: string}}
 */
function applyMultiplier(quantity) {
  const multiplierMatch = quantity.rest.match(new RegExp(`^\\s*(?:x|×|\\*)\\s*(${NUMBER_PATTERN})`));
  if (!multiplierMatch) return quantity;

  const factor = numberFromString(multiplierMatch[1]);
  if (factor === null) return quantity;

  return {
    value: quantity.value * factor,
    valueMax: quantity.valueMax === null ? null : quantity.valueMax * factor,
    text: `${quantity.text}${multiplierMatch[0]}`.trim(),
    rest: quantity.rest.slice(multiplierMatch[0].length),
  };
}

/**
 * Reads a unit from the start of the text. Tries two-word units ("fl oz",
 * "fluid ounces") before single-word ones.
 * @param {string} text
 * @returns {{unit: string, unitType: string, unitText: string, isAbbreviation: boolean, rest: string}|null}
 */
function parseUnit(text) {
  const tokens = text.split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  for (const size of [2, 1]) {
    if (tokens.length < size) continue;
    // A unit must leave something behind to name the ingredient.
    if (tokens.length === size) continue;

    const candidate = tokens.slice(0, size).join(" ");
    const match = lookupUnit(candidate);
    if (match) {
      const consumed = text.indexOf(candidate) + candidate.length;
      return {
        unit: match.def.canonical,
        unitType: match.def.type,
        unitText: candidate.replace(/\.$/, ""),
        isAbbreviation: match.isAbbreviation,
        rest: text.slice(consumed),
      };
    }
  }

  return null;
}

/**
 * Moves trailing usage phrases ("to taste", "divided") into the notes.
 * @param {string} text
 * @param {string[]} notes
 * @returns {string}
 */
function extractTrailingModifiers(text, notes) {
  let result = text;
  let changed = true;

  while (changed) {
    changed = false;
    for (const pattern of TRAILING_MODIFIER_PATTERNS) {
      const match = result.match(pattern);
      if (!match) continue;

      const note = match[0].replace(/^[,;\s]+/, "").replace(/\.$/, "").trim();
      if (note) notes.push(note);
      result = result.slice(0, match.index).trim();
      changed = true;
    }
  }

  return result;
}

/**
 * Splits "flour, sifted" into the ingredient and its preparation note.
 * @param {string} text
 * @returns {{ingredient: string, note: string|null}}
 */
function splitPreparationNote(text) {
  const commaIndex = text.indexOf(",");
  if (commaIndex === -1) return { ingredient: text.trim(), note: null };

  const ingredient = text.slice(0, commaIndex).trim();
  const note = text.slice(commaIndex + 1).trim();

  // "salt, pepper" style lines have no real ingredient before the comma to
  // speak of - only treat the tail as a note when the head is substantial.
  if (!ingredient) return { ingredient: text.trim(), note: null };

  return { ingredient, note: note || null };
}

/**
 * @typedef {Object} ParsedIngredient
 * @property {string} raw               Original line, unmodified.
 * @property {'ingredient'|'section'} type
 * @property {number|null} quantity     Numeric amount (lower bound of a range).
 * @property {number|null} quantityMax  Upper bound when the line is a range.
 * @property {string|null} quantityText Quantity exactly as written.
 * @property {string|null} unit         Canonical singular unit name.
 * @property {string|null} unitText     Unit exactly as written.
 * @property {string|null} unitType     volume | weight | count | length | approximate
 * @property {boolean} unitIsAbbreviation
 * @property {string} ingredient        The ingredient name.
 * @property {string|null} note         Prep instructions / asides.
 * @property {boolean} scalable         Whether a quantity was found to scale.
 */

/**
 * Parses a single free-text ingredient line into structured fields.
 * @param {string} rawLine
 * @returns {ParsedIngredient|null} Null for blank lines.
 */
export function parseIngredientLine(rawLine) {
  const raw = typeof rawLine === "string" ? rawLine : "";
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const base = {
    raw,
    type: "ingredient",
    quantity: null,
    quantityMax: null,
    quantityText: null,
    unit: null,
    unitText: null,
    unitType: null,
    unitIsAbbreviation: false,
    ingredient: trimmed,
    note: null,
    scalable: false,
  };

  const normalized = normalizeLine(trimmed);

  // Section headings, e.g. "For the sauce:"
  if (/:$/.test(normalized) && !/^\d/.test(normalized)) {
    return { ...base, type: "section", ingredient: normalized.replace(/:$/, "").trim() };
  }

  const { text: withoutParens, notes } = extractParentheticals(normalized);

  let rest = withoutParens;
  let quantity = parseQuantity(rest);
  if (quantity) {
    quantity = applyMultiplier(quantity);
    rest = quantity.rest;
  }

  // Drop separators left behind by list markers ("2) eggs") or stray dashes.
  rest = rest.replace(/^[\s.,;:)\]-]+/, "").trim();

  const unit = parseUnit(rest);
  if (unit) rest = unit.rest.trim();

  rest = rest.replace(/^of\s+/i, "").trim();

  // Notes are assembled in the order they appeared on the line:
  // parentheticals, then the preparation note, then usage phrases.
  const trailingNotes = [];
  rest = extractTrailingModifiers(rest, trailingNotes);

  const { ingredient, note } = splitPreparationNote(rest);
  if (note) notes.push(note);
  notes.push(...trailingNotes);

  // Nothing but a quantity and unit, e.g. a stray "2 cups" line - keep the
  // original text rather than emitting an ingredient with no name.
  if (!ingredient) {
    return { ...base, note: notes.length ? notes.join("; ") : null };
  }

  return {
    ...base,
    quantity: quantity ? quantity.value : null,
    quantityMax: quantity ? quantity.valueMax : null,
    quantityText: quantity ? quantity.text : null,
    unit: unit ? unit.unit : null,
    unitText: unit ? unit.unitText : null,
    unitType: unit ? unit.unitType : null,
    unitIsAbbreviation: unit ? unit.isAbbreviation : false,
    ingredient,
    note: notes.length ? notes.join("; ") : null,
    scalable: Boolean(quantity),
  };
}

/**
 * Parses a whole free-text ingredients block into structured rows.
 * @param {string} text - The raw textarea contents.
 * @returns {ParsedIngredient[]}
 */
export function parseIngredients(text) {
  if (!text || typeof text !== "string") return [];

  return text
    .split(/\r?\n/)
    .map((line) => parseIngredientLine(line))
    .filter((row) => row !== null);
}

// ---------------------------------------------------------------------------
// Formatting (used for display and, later, for scaled output)
// ---------------------------------------------------------------------------

const FRACTION_DENOMINATORS = [2, 3, 4, 6, 8, 16];
const FRACTION_TOLERANCE = 0.005;

/**
 * Renders a number the way a recipe would: whole numbers stay whole, and
 * values close to a common fraction are shown as fractions.
 * @param {number|null} value
 * @returns {string} Empty string when there is no value.
 */
export function formatQuantity(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  if (value === 0) return "0";

  const whole = Math.floor(value);
  const remainder = value - whole;

  if (remainder < FRACTION_TOLERANCE) return String(whole);

  for (const denominator of FRACTION_DENOMINATORS) {
    const numerator = Math.round(remainder * denominator);
    if (numerator === 0 || numerator === denominator) continue;
    if (Math.abs(numerator / denominator - remainder) < FRACTION_TOLERANCE) {
      const fraction = `${numerator}/${denominator}`;
      return whole > 0 ? `${whole} ${fraction}` : fraction;
    }
  }

  // No clean fraction - fall back to at most two decimal places.
  return String(Math.round(value * 100) / 100);
}

/**
 * Formats a quantity or quantity range for display.
 * @param {ParsedIngredient} row
 * @returns {string}
 */
export function formatQuantityRange(row) {
  if (row.quantity === null) return "";
  const min = formatQuantity(row.quantity);
  if (row.quantityMax === null) return min;

  const max = formatQuantity(row.quantityMax);
  // "1-1 1/2" reads as a single amount; mixed numbers need a wordier joiner.
  const separator = min.includes(" ") || max.includes(" ") ? " to " : "-";
  return `${min}${separator}${max}`;
}

/**
 * Renders a unit, pluralising full words when the amount is more than one.
 * Amounts of one or less keep the singular ("1/2 cup", not "1/2 cups"), and
 * abbreviations ("tsp", "g") are never pluralised.
 * @param {ParsedIngredient} row
 * @returns {string}
 */
export function formatUnit(row) {
  if (!row.unit) return "";
  if (row.unitIsAbbreviation) return row.unitText;

  const amount = row.quantityMax ?? row.quantity;
  if (amount === null || amount <= 1) return row.unit;

  const definition = UNIT_DEFINITIONS.find((def) => def.canonical === row.unit);
  return pluralizeWord(row.unit, definition?.plural);
}

/**
 * Combines quantity and unit into the single "amount" column shown next to an
 * ingredient, e.g. "1 1/2 cups" or "2-3 cloves".
 * @param {ParsedIngredient} row
 * @returns {string}
 */
export function formatAmount(row) {
  return [formatQuantityRange(row), formatUnit(row)].filter(Boolean).join(" ");
}

/**
 * Renders a parsed row back to a single line of text.
 * @param {ParsedIngredient} row
 * @returns {string}
 */
export function formatIngredient(row) {
  if (row.type === "section") return `${row.ingredient}:`;

  const parts = [formatQuantityRange(row), formatUnit(row), row.ingredient].filter(Boolean);
  const line = parts.join(" ");
  return row.note ? `${line}, ${row.note}` : line;
}
