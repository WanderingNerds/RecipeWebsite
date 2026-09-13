export const HELP_FEEDBACK_CATEGORIES = Object.freeze([
  "Question",
  "Issue report",
  "Feedback",
  "Help request",
  "Other",
]);

export const HELP_FEEDBACK_LIMITS = Object.freeze({
  name: 120,
  email: 254,
  subject: 200,
  message: 5000,
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeField = (value) => typeof value === "string" ? value.trim() : "";

export function normalizeHelpFeedback(body = {}) {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  return {
    category: normalizeField(source.category),
    subject: normalizeField(source.subject),
    message: normalizeField(source.message),
    contactName: normalizeField(source.contactName),
    contactEmail: normalizeField(source.contactEmail),
  };
}

export function validateHelpFeedback(body = {}) {
  const values = normalizeHelpFeedback(body);
  const errors = {};

  if (!HELP_FEEDBACK_CATEGORIES.includes(values.category)) {
    errors.category = "Choose a valid category.";
  }

  for (const [field, label] of [["subject", "Subject"], ["message", "Message"], ["contactName", "Name"], ["contactEmail", "Email address"]]) {
    if (!values[field]) errors[field] = `${label} is required.`;
  }

  if (values.subject.length > HELP_FEEDBACK_LIMITS.subject) errors.subject = `Subject must be ${HELP_FEEDBACK_LIMITS.subject} characters or fewer.`;
  if (values.message.length > HELP_FEEDBACK_LIMITS.message) errors.message = `Message must be ${HELP_FEEDBACK_LIMITS.message} characters or fewer.`;
  if (values.contactName.length > HELP_FEEDBACK_LIMITS.name) errors.contactName = `Name must be ${HELP_FEEDBACK_LIMITS.name} characters or fewer.`;
  if (values.contactEmail.length > HELP_FEEDBACK_LIMITS.email) errors.contactEmail = `Email address must be ${HELP_FEEDBACK_LIMITS.email} characters or fewer.`;
  if (values.contactEmail && values.contactEmail.length <= HELP_FEEDBACK_LIMITS.email && !EMAIL_PATTERN.test(values.contactEmail)) {
    errors.contactEmail = "Enter a valid email address.";
  }

  return { values, errors, isValid: Object.keys(errors).length === 0 };
}
