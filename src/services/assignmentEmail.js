import { getAppUrl } from "../utils/authUtils.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function buildAssignmentMessage({ ticketId, subject, recipient, env = process.env }) {
  const ticketUrl = `${getAppUrl(env)}/admin/feedback/${encodeURIComponent(ticketId)}`;
  const safeSubject = String(subject).replace(/[\r\n]+/g, " ").trim();
  return {
    to: recipient.email,
    subject: `Feedback assigned: ${safeSubject} (${ticketId})`,
    text: `You have been assigned feedback ticket "${subject}" (${ticketId}).\n\nOpen the ticket: ${ticketUrl}`,
    ticketUrl,
  };
}

export async function sendAssignmentEmail({ ticketId, subject, recipient }, {
  fetchImpl = globalThis.fetch,
  env = process.env,
  timeoutMs = 5000,
} = {}) {
  if (!env.RESEND_API_KEY || !env.ASSIGNMENT_EMAIL_FROM || typeof fetchImpl !== "function") {
    return { sent: false, reason: "configuration" };
  }
  const message = buildAssignmentMessage({ ticketId, subject, recipient, env });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.ASSIGNMENT_EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
      signal: controller.signal,
    });
    return response.ok ? { sent: true } : { sent: false, reason: "provider", status: response.status };
  } catch (error) {
    return { sent: false, reason: error?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timeout);
  }
}
