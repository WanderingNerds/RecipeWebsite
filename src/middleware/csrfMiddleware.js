import { doubleCsrf } from "csrf-csrf";

const csrf = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET || "dev-secret-key-change-in-production",
  cookieName: "csrf-token",
  cookieOptions: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
  getTokenFromRequest: (req) => req.body?._csrf || req.headers["x-csrf-token"],
  size: 64,
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
});
export const generateCsrfToken = csrf.generateToken;
export const csrfProtection = csrf.doubleCsrfProtection;
export function csrfProtectionExceptMultipart(req, res, next) {
  if (req.is("multipart/form-data")) return next();
  return csrfProtection(req, res, next);
}
