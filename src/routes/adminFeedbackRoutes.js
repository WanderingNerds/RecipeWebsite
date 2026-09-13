import { Router } from "express";
import { createSupabaseClient } from "../config/supabase.js";
import { requireAdmin } from "../middleware/authMiddleware.js";
import { FEEDBACK_FILTERS, FEEDBACK_STATUSES, filterStatuses, isUuid, mergeAssignableAdmins, normalizeFilter, normalizeUpdate, statusLabel } from "../utils/adminUtils.js";

const fields = "id, contact_name, contact_email, category, subject, message, status, assignee_id, created_at, updated_at, assignee:admin_profiles!assignee_id(display_name)";
export function createAdminFeedbackRouter({ createClient = createSupabaseClient, auth = requireAdmin } = {}) {
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
        client.from("admin_profiles").select("id, display_name").eq("active", true).order("display_name"),
      ]);
      if (ticketResult.error || adminsResult.error) throw ticketResult.error || adminsResult.error;
      if (!ticketResult.data) return res.status(404).render("error", { title: "Not Found", message: "Submission not found" });
      return res.render("admin/feedback-detail", { title: ticketResult.data.subject, submission: ticketResult.data, admins: mergeAssignableAdmins(adminsResult.data || [], ticketResult.data), statuses: FEEDBACK_STATUSES, statusLabel });
    } catch (error) { console.error("Admin feedback detail failed", { code: error?.code }); req.flash("error", "The submission could not be loaded"); return res.redirect("/admin/feedback"); }
  });
  router.post("/:id", async (req, res) => {
    const input = normalizeUpdate(req.body);
    if (!isUuid(req.params.id) || !input.valid) { req.flash("error", "Choose a valid status and assignee"); return res.redirect(303, `/admin/feedback/${encodeURIComponent(req.params.id)}`); }
    try {
      const client = createClient(req.accessToken);
      const currentResult = await client.from("help_feedback_submissions").select("id, assignee_id").eq("id", req.params.id).maybeSingle();
      if (currentResult.error) throw currentResult.error;
      if (!currentResult.data) return res.status(404).render("error", { title: "Not Found", message: "Submission not found" });
      if (input.assigneeId && input.assigneeId !== currentResult.data.assignee_id) {
        const assignee = await client.from("admin_profiles").select("id").eq("id", input.assigneeId).eq("active", true).maybeSingle();
        if (assignee.error) throw assignee.error;
        if (!assignee.data) { req.flash("error", "Choose a valid status and assignee"); return res.redirect(303, `/admin/feedback/${req.params.id}`); }
      }
      const result = await client.from("help_feedback_submissions").update({ status: input.status, assignee_id: input.assigneeId }).eq("id", req.params.id).select("id").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return res.status(404).render("error", { title: "Not Found", message: "Submission not found" });
      req.flash("success", "Submission updated"); return res.redirect(303, `/admin/feedback/${req.params.id}`);
    } catch (error) { console.error("Admin feedback update failed", { code: error?.code }); req.flash("error", "The submission could not be updated"); return res.redirect(303, `/admin/feedback/${req.params.id}`); }
  });
  return router;
}
export default createAdminFeedbackRouter();
