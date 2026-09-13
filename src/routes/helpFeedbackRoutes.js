import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createSupabaseClient } from "../config/supabase.js";
import {
  HELP_FEEDBACK_CATEGORIES,
  HELP_FEEDBACK_LIMITS,
  validateHelpFeedback,
} from "../utils/helpFeedbackUtils.js";

const getContactDefaults = (user) => ({
  category: "",
  subject: "",
  message: "",
  contactName: user?.user_metadata?.name || user?.user_metadata?.full_name || "",
  contactEmail: user?.email || "",
});

const renderForm = (res, { values, errors = {}, status = 200, submissionError = "" }) => res.status(status).render("help-feedback", {
  title: "Help & Feedback",
  categories: HELP_FEEDBACK_CATEGORIES,
  limits: HELP_FEEDBACK_LIMITS,
  values,
  validationErrors: errors,
  submissionError,
});

export function createHelpFeedbackRouter({ createClient = createSupabaseClient, auth = requireAuth } = {}) {
  const router = Router();

  router.get("/", auth, (req, res) => renderForm(res, { values: getContactDefaults(req.user) }));

  router.post("/", auth, async (req, res) => {
    const validation = validateHelpFeedback(req.body);
    if (!validation.isValid) {
      return renderForm(res, { values: validation.values, errors: validation.errors, status: 400 });
    }

    const { values } = validation;
    try {
      const client = createClient(req.accessToken);
      const { error } = await client.from("help_feedback_submissions").insert({
        user_id: req.user.id,
        contact_name: values.contactName,
        contact_email: values.contactEmail,
        category: values.category,
        subject: values.subject,
        message: values.message,
        status: "new",
      });

      if (error) {
        console.error("Help feedback submission insert failed", { code: error.code });
        return renderForm(res, { values, status: 500, submissionError: "We couldn't submit your request. Please try again." });
      }

      req.flash("success", "Thanks—your request was submitted for administrator review.");
      return res.redirect(303, "/help-feedback");
    } catch (error) {
      console.error("Help feedback submission failed", { name: error?.name });
      return renderForm(res, { values, status: 500, submissionError: "We couldn't submit your request. Please try again." });
    }
  });

  return router;
}

export default createHelpFeedbackRouter();
