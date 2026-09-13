export const FEEDBACK_STATUSES = Object.freeze(["new", "in_progress", "done"]);
export const FEEDBACK_FILTERS = Object.freeze(["all", "unresolved", "done"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isAdminUser = (user) => user?.app_metadata?.role === "admin";
export const isUuid = (value) => typeof value === "string" && UUID.test(value);
export const normalizeFilter = (value) => FEEDBACK_FILTERS.includes(value) ? value : "unresolved";
export const filterStatuses = (filter) => filter === "all" ? FEEDBACK_STATUSES : filter === "done" ? ["done"] : ["new", "in_progress"];
export const statusLabel = (status) => ({ new: "New / To Do", in_progress: "In Progress", done: "Done" })[status] || "Unknown";
export function normalizeUpdate(body = {}) {
  const status = typeof body.status === "string" ? body.status.trim() : "";
  const assigneeId = typeof body.assigneeId === "string" ? body.assigneeId.trim() : "";
  return { valid: FEEDBACK_STATUSES.includes(status) && (!assigneeId || isUuid(assigneeId)), status, assigneeId: assigneeId || null };
}
export function mergeAssignableAdmins(active = [], submission) {
  if (!submission?.assignee_id || active.some((a) => a.id === submission.assignee_id)) return active;
  return [...active, { id: submission.assignee_id, display_name: `${submission.assignee?.display_name || "Current assignee"} (inactive)`, inactive: true }];
}
