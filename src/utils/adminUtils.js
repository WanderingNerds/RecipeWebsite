export const FEEDBACK_STATUSES = Object.freeze(["new", "in_progress", "done"]);
export const FEEDBACK_FILTERS = Object.freeze(["all", "unresolved", "done"]);
export const FEEDBACK_ASSIGNEES = Object.freeze([
  Object.freeze({ displayName: "Andrew", profileNames: Object.freeze(["Andrew", "Andrew Carroll"]), email: "carroll.andrew@gmail.com" }),
  Object.freeze({ displayName: "Victoria", profileNames: Object.freeze(["Victoria", "Victoria Johnson"]), email: "vhobbs1895@gmail.com" }),
]);
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
export function filterAssignableAdmins(profiles = []) {
  return FEEDBACK_ASSIGNEES.flatMap(({ displayName, profileNames }) => {
    const matches = profiles.filter((profile) => profile?.active !== false && profileNames.includes(profile?.display_name));
    return matches.length === 1 ? [{ ...matches[0], display_name: displayName }] : [];
  });
}
export function resolveAssignmentRecipient(profile) {
  if (!profile || profile.active === false) return null;
  const matches = FEEDBACK_ASSIGNEES.filter(({ displayName, profileNames }) => displayName === profile.display_name || profileNames.includes(profile.display_name));
  return matches.length === 1 ? matches[0] : null;
}
