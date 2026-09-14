export const MAX_FEEDBACK_COMMENT_LENGTH = 5000;

export function isMissingFeedbackCommentsTableError(error) {
  return error?.code === "PGRST205";
}

export function normalizeFeedbackComment(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { valid: false, value: text, error: "Enter a progress comment" };
  // PostgreSQL char_length counts Unicode code points, unlike JavaScript's
  // UTF-16 string length. Keep application and database boundaries identical.
  if (Array.from(text).length > MAX_FEEDBACK_COMMENT_LENGTH) {
    return { valid: false, value: text, error: `Progress comments must be ${MAX_FEEDBACK_COMMENT_LENGTH.toLocaleString("en-US")} characters or fewer` };
  }
  return { valid: true, value: text };
}

const centralFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function formatCentralTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return centralFormatter.format(date);
}
