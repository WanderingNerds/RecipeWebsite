import { Router } from "express";
import { createSupabaseClient } from "../config/supabase.js";
import { requireAdmin } from "../middleware/authMiddleware.js";
import { sendAssignmentEmail } from "../services/assignmentEmail.js";
import { FEEDBACK_FILTERS, FEEDBACK_STATUSES, filterAssignableAdmins, filterStatuses, isUuid, normalizeFilter, normalizeUpdate, resolveAssignmentRecipient, statusLabel } from "../utils/adminUtils.js";

const fields = "id, contact_name, contact_email, category, subject, message, status, assignee_id, created_at, updated_at, assignee:admin_profiles!assignee_id(display_name)";
export function createAdminFeedbackRouter({ createClient = createSupabaseClient, auth = requireAdmin, sendEmail = sendAssignmentEmail } = {}) {
  const router = Router(); router.use(auth);
  router.get("/", async (req, res) => {
    const filter = normalizeFilter(req.query.status);
    try {
      let query = createClient(req.accessToken).from("help_feedback_submissions").select(fields).order("created_at", { ascending: false });
      if (filter !== "all") query = query.in("status", filterStatuses(filter));
      const { data, error } = await query; if (error) throw error;
      return res.render("admin/feedback-index", { title: "Help & Feedback Management", submissions: data || [], filter, filters: FEEDBACK_FILTERS, statusLabel });
    } catch (error) { console.error("Admin feedback queue failed", { code: error?.code }); return res.status(500).render("admin/feedback-index", { title: "Help & Feedback Management", submissions: [], filter, filters: FEEDBACK_FILTERS, statusLabel, loadError: "The feedback queue could not be loaded." }); }
  });
  router.get("/:id", async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).render("error", { title: "Not Found", message: "Submission not found" });
    try {
      const client = createClient(req.accessToken);
      const [ticketResult, adminsResult] = await Promise.all([
        client.from("help_feedback_submissions").select(fields).eq("id", req.params.id).maybeSingle(),
        client.from("admin_profiles").select("id, display_name, active").eq("active", true),
      ]);
      if (ticketResult.error || adminsResult.error) throw ticketResult.error || adminsResult.error;
      if (!ticketResult.data) return res.status(404).render("error", { title: "Not Found", message: "Submission not found" });
      return res.render("admin/feedback-detail", { title: ticketResult.data.subject, submission: ticketResult.data, admins: filterAssignableAdmins(adminsResult.data || []), statuses: FEEDBACK_STATUSES, statusLabel });
    } catch (error) { console.error("Admin feedback detail failed", { code: error?.code }); req.flash("error", "The submission could not be loaded"); return res.redirect("/admin/feedback"); }
  });
  router.post("/:id", async (req, res) => {
    const input = normalizeUpdate(req.body);
    if (!isUuid(req.params.id) || !input.valid) { req.flash("error", "Choose a valid status and assignee"); return res.redirect(303, `/admin/feedback/${encodeURIComponent(req.params.id)}`); }
    try {
      const client = createClient(req.accessToken);
      const currentResult = await client.from("help_feedback_submissions").select("id, subject, assignee_id").eq("id", req.params.id).maybeSingle();
      if (currentResult.error) throw currentResult.error;
      if (!currentResult.data) return res.status(404).render("error", { title: "Not Found", message: "Submission not found" });
      let recipient = null;
      if (input.assigneeId) {
        const assignees = await client.from("admin_profiles").select("id, display_name, active").eq("active", true);
        if (assignees.error) throw assignees.error;
        const assignee = filterAssignableAdmins(assignees.data || []).find(({ id }) => id === input.assigneeId);
        recipient = resolveAssignmentRecipient(assignee);
        if (!recipient) { req.flash("error", "Choose a valid status and assignee"); return res.redirect(303, `/admin/feedback/${req.params.id}`); }
      }
      const result = await client.from("help_feedback_submissions").update({ status: input.status, assignee_id: input.assigneeId }).eq("id", req.params.id).select("id").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return res.status(404).render("error", { title: "Not Found", message: "Submission not found" });
      const assignmentChanged = input.assigneeId && input.assigneeId !== currentResult.data.assignee_id;
      if (assignmentChanged) {
        let delivery;
        try {
          delivery = await sendEmail({ ticketId: currentResult.data.id, subject: currentResult.data.subject, recipient });
        } catch {
          delivery = { sent: false, reason: "unexpected" };
        }
        if (!delivery.sent) {
          console.error("Assignment notification failed", { ticketId: currentResult.data.id, reason: delivery.reason, status: delivery.status });
          req.flash("error", "Submission updated, but the assignment notification could not be sent");
          return res.redirect(303, `/admin/feedback/${req.params.id}`);
        }
        req.flash("success", "Submission updated and assignee notified");
        return res.redirect(303, `/admin/feedback/${req.params.id}`);
      }
      req.flash("success", "Submission updated"); return res.redirect(303, `/admin/feedback/${req.params.id}`);
    } catch (error) { console.error("Admin feedback update failed", { code: error?.code }); req.flash("error", "The submission could not be updated"); return res.redirect(303, `/admin/feedback/${req.params.id}`); }
  });
  return router;
}
export default createAdminFeedbackRouter();
