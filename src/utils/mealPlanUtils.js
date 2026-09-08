/**
 * Meal plan utility functions
 *
 * Pure, unit-testable helpers extracted out of mealPlanRoutes.js /
 * mealPlanApiRoutes.js, following the same extraction pattern as
 * cookbookUtils.js so this logic is covered by `npm test` even though the
 * route handlers themselves are not unit tested anywhere in this codebase.
 *
 * Recipe-id-selection normalization (used by the bulk "Add Recipes" picker)
 * is deliberately NOT duplicated here -- `normalizeRecipeIdSelection` in
 * cookbookUtils.js is generic UUID-array normalization, not cookbook-
 * specific, so mealPlanRoutes.js imports it directly from there. See the
 * REW-63 plan, Task 3.
 */

const MAX_TITLE_LENGTH = 200;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate and normalize a meal plan title submitted from a form.
 *
 * Enforces the same "non-empty after trimming" rule as the DB CHECK
 * constraint in `011_create_meal_plans_table.sql` (defense in depth), plus
 * a reasonable max length so a single meal plan title can't grow unbounded.
 * Mirrors `validateCookbookTitle` in cookbookUtils.js exactly.
 *
 * @param {*} title - raw value from req.body.title
 * @returns {{valid: boolean, title: string, error: string|null}}
 *   `title` is always the trimmed string (possibly empty when invalid);
 *   `error` is a user-facing message when `valid` is false, otherwise null.
 */
export function validateMealPlanTitle(title) {
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
 * Check whether a string is a real calendar date in YYYY-MM-DD form (not
 * just something `Date.parse` happens to accept -- e.g. rejects
 * "2024-02-30", which some parsers silently roll over to March 1st).
 *
 * @param {string} dateStr
 * @returns {boolean}
 */
function isValidCalendarDate(dateStr) {
  if (!DATE_PATTERN.test(dateStr)) return false;

  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Validate and normalize a meal plan's start/end date range submitted from
 * a form (`<input type="date">` values, i.e. "YYYY-MM-DD" strings).
 *
 * Enforces the same rules as the DB CHECK constraints in
 * `011_create_meal_plans_table.sql` (defense in depth): both dates
 * required, both must be real calendar dates, and `end >= start`. No
 * restriction on overlapping date ranges across a user's meal plans -- see
 * Open Questions #5 in the REW-63 plan.
 *
 * @param {*} startDate - raw value from req.body.startDate
 * @param {*} endDate - raw value from req.body.endDate
 * @returns {{valid: boolean, startDate: string, endDate: string, error: string|null}}
 */
export function validateDateRange(startDate, endDate) {
  const trimmedStart = typeof startDate === "string" ? startDate.trim() : "";
  const trimmedEnd = typeof endDate === "string" ? endDate.trim() : "";

  if (!trimmedStart) {
    return { valid: false, startDate: trimmedStart, endDate: trimmedEnd, error: "Start date is required" };
  }

  if (!trimmedEnd) {
    return { valid: false, startDate: trimmedStart, endDate: trimmedEnd, error: "End date is required" };
  }

  if (!isValidCalendarDate(trimmedStart) || !isValidCalendarDate(trimmedEnd)) {
    return {
      valid: false,
      startDate: trimmedStart,
      endDate: trimmedEnd,
      error: "Dates must be valid calendar dates (YYYY-MM-DD)",
    };
  }

  if (trimmedEnd < trimmedStart) {
    return {
      valid: false,
      startDate: trimmedStart,
      endDate: trimmedEnd,
      error: "End date must be on or after the start date",
    };
  }

  return { valid: true, startDate: trimmedStart, endDate: trimmedEnd, error: null };
}
