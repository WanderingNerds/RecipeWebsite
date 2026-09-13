import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createServerAuthClient } from "../config/supabase.js";
import { clearAuthCookies, setAuthCookies } from "../utils/authUtils.js";
import { isAdminUser } from "../utils/adminUtils.js";

export function createAdminAuthRouter({ createAuthClient = createServerAuthClient } = {}) {
  const router = Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
  router.get("/login", (_req, res) => res.render("admin/login", { title: "Administrator Login" }));
  router.post("/login", limiter, async (req, res) => {
    const client = createAuthClient();
    const deny = async () => { clearAuthCookies(res); try { await client.auth.signOut(); } catch {} req.flash("error", "Unable to sign in with those administrator credentials"); return res.redirect(303, "/admin/login"); };
    try {
      if (!req.body.email || !req.body.password) return deny();
      const { data, error } = await client.auth.signInWithPassword({ email: req.body.email, password: req.body.password });
      if (error || !data?.session || !isAdminUser(data.user)) return deny();
      setAuthCookies(res, data.session); req.flash("success", "Administrator sign-in successful"); return res.redirect(303, "/admin/feedback");
    } catch { return deny(); }
  });
  router.post("/logout", async (req, res) => {
    const access = req.cookies["sb-access-token"], refresh = req.cookies["sb-refresh-token"];
    const client = createAuthClient(access);
    try { if (access && refresh) { await client.auth.setSession({ access_token: access, refresh_token: refresh }); await client.auth.signOut(); } } catch {}
    clearAuthCookies(res); return res.redirect(303, "/admin/login");
  });
  return router;
}
export default createAdminAuthRouter();
