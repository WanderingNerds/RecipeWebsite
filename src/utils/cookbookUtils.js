/**
 * Cookbook utility functions
 *
 * Pure, unit-testable helpers extracted out of cookbookRoutes.js, following
 * the same extraction pattern as userUtils.js / authUtils.js so this logic
 * is covered by `npm test` even though the route handlers themselves are
 * not unit tested anywhere in this codebase.
 */

const MAX_TITLE_LENGTH = 200;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate and normalize a cookbook title submitted from a form.
 *
 * Enforces the same "non-empty after trimming" rule as the DB CHECK
 * constraint in `009_create_cookbooks_table.sql` (defense in depth), plus
 * a reasonable max length so a single cookbook title can't grow unbounded.
 *
 * @param {*} title - raw value from req.body.title
 * @returns {{valid: boolean, title: string, error: string|null}}
 *   `title` is always the trimmed string (possibly empty when invalid);
 *   `error` is a user-facing message when `valid` is false, otherwise null.
 */
export function validateCookbookTitle(title) {
  if (typeof title !== "string") {
    return { valid: false, title: "", error: "Title is required" };
  }

  const trimmed = title.trim();

  if (!trimmed) {
    return { valid: false, title: "", error: "Title is required" };
  }

  if (trimmed.length > MAX_TITLE_LENGTH) {
    return {
      valid: false,
      title: trimmed,
      error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer`,
    };
  }

  return { valid: true, title: trimmed, error: null };
}

/**
 * Normalize a recipe-id selection submitted from a form body into a
 * deduplicated array of well-formed UUID strings.
 *
 * Form bodies (via express.urlencoded) send a single string when exactly
 * one checkbox/value is submitted, and an array when more than one is
 * submitted -- mirrors the same array-vs-single-value normalization already
 * done for `categories` in recipeRoutes.js's `saveRecipeCategories`.
 * Non-string, blank, malformed (non-UUID), or duplicate values are dropped
 * rather than passed through to the database layer.
 *
 * @param {*} input - raw value from req.body (e.g. req.body.recipeIds)
 * @returns {string[]} deduplicated array of valid UUID strings, in the
 *   order they first appeared
 */
export function normalizeRecipeIdSelection(input) {
  if (input === undefined || input === null) {
    return [];
  }

  const values = Array.isArray(input) ? input : [input];
  const seen = new Set();
  const normalized = [];

  for (const value of values) {
    if (typeof value !== "string") continue;

    const trimmed = value.trim();
    if (!trimmed || !UUID_PATTERN.test(trimmed) || seen.has(trimmed)) continue;

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}
