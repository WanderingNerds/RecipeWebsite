import { Router } from "express";
import { createSupabaseClient } from "../config/supabase.js";
import { requireAdmin } from "../middleware/authMiddleware.js";
import { sendAssignmentEmail } from "../services/assignmentEmail.js";
import { FEEDBACK_FILTERS, FEEDBACK_STATUSES, filterAssignableAdmins, filterStatuses, isUuid, normalizeFilter, normalizeUpdate, resolveAssignmentRecipient, statusLabel } from "../utils/adminUtils.js";
import { formatCentralTimestamp, isMissingFeedbackCommentsTableError, normalizeFeedbackComment } from "../utils/adminFeedbackComments.js";

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
      const [ticketResult, adminsResult, commentsResult] = await Promise.all([
        client.from("help_feedback_submissions").select(fields).eq("id", req.params.id).maybeSingle(),
        client.from("admin_profiles").select("id, display_name, active").eq("active", true),
        client.from("feedback_progress_comments").select("id, author_display_name, comment_text, created_at").eq("feedback_submission_id", req.params.id).order("created_at", { ascending: true }).order("id", { ascending: true }),
      ]);
      if (ticketResult.error || adminsResult.error || (commentsResult.error && !isMissingFeedbackCommentsTableError(commentsResult.error))) throw ticketResult.error || adminsResult.error || commentsResult.error;
      if (!ticketResult.data) return res.status(404).render("error", { title: "Not Found", message: "Submission not found" });
      const drafts = req.flash("feedbackCommentDraft") || [];
      return res.render("admin/feedback-detail", { title: ticketResult.data.subject, submission: ticketResult.data, admins: filterAssignableAdmins(adminsResult.data || []), comments: commentsResult.data || [], commentsUnavailable: isMissingFeedbackCommentsTableError(commentsResult.error), commentDraft: drafts[0] || "", statuses: FEEDBACK_STATUSES, statusLabel, formatCentralTimestamp });
    } catch (error) { console.error("Admin feedback detail failed", { code: error?.code }); req.flash("error", "The submission could not be loaded"); return res.redirect("/admin/feedback"); }
  });
  router.post("/:id/comments", async (req, res) => {
    const input = normalizeFeedbackComment(req.body?.commentText);
    const redirectPath = `/admin/feedback/${encodeURIComponent(req.params.id)}`;
    if (!isUuid(req.params.id) || !input.valid) {
      if (typeof req.body?.commentText === "string") req.flash("feedbackCommentDraft", req.body.commentText);
      req.flash("error", !isUuid(req.params.id) ? "Submission not found" : input.error);
      return res.redirect(303, redirectPath);
    }
    try {
      const client = createClient(req.accessToken);
      const [ticketResult, profileResult] = await Promise.all([
        client.from("help_feedback_submissions").select("id").eq("id", req.params.id).maybeSingle(),
        client.from("admin_profiles").select("id, display_name, active").eq("id", req.user.id).eq("active", true).maybeSingle(),
      ]);
      if (ticketResult.error || profileResult.error) throw ticketResult.error || profileResult.error;
      if (!ticketResult.data) return res.status(404).render("error", { title: "Not Found", message: "Submission not found" });
      if (!profileResult.data) {
        req.flash("feedbackCommentDraft", req.body.commentText);
        req.flash("error", "An active administrator profile is required to add a comment");
        return res.redirect(303, redirectPath);
      }
      const result = await client.from("feedback_progress_comments").insert([{
        feedback_submission_id: ticketResult.data.id,
        author_id: req.user.id,
        author_display_name: profileResult.data.display_name,
        comment_text: input.value,
      }]).select("id").maybeSingle();
      if (isMissingFeedbackCommentsTableError(result.error)) {
        req.flash("feedbackCommentDraft", req.body.commentText);
        req.flash("error", "Progress comments are unavailable until database migration 017 is applied");
        return res.redirect(303, redirectPath);
      }
      if (result.error) throw result.error;
      if (!result.data) throw new Error("Comment insert returned no row");
      req.flash("success", "Progress comment added");
      return res.redirect(303, redirectPath);
    } catch (error) {
      console.error("Admin feedback comment failed", { code: error?.code });
      req.flash("feedbackCommentDraft", req.body.commentText);
      req.flash("error", "The progress comment could not be added");
      return res.redirect(303, redirectPath);
    }
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
