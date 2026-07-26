import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import session from "express-session";
import flash from "connect-flash";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { doubleCsrf } from "csrf-csrf";
import { optionalAuth } from "./middleware/authMiddleware.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import routes from "./routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use project root for Vercel compatibility
const projectRoot = process.cwd();

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? process.env.APP_URL
    : "http://localhost:3000",
  credentials: true,
}));

// Trust proxy for Vercel
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// Cookie parser for auth tokens
app.use(cookieParser());

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session for flash messages
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60, // 1 hour for flash messages
  },
}));
app.use(flash());

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiting to all requests
app.use(generalLimiter);

// CSRF Protection
const {
  invalidCsrfTokenError,
  generateToken,
  doubleCsrfProtection,
} = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET || "dev-secret",
  cookieName: process.env.NODE_ENV === "production"
    ? "__Host-psifi.x-csrf-token"
    : "psifi.x-csrf-token",
  cookieOptions: {
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  },
  size: 64,
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
});

// Apply CSRF protection
app.use(doubleCsrfProtection);

// Make CSRF token available to all views using a getter
// This delays token generation until it's actually accessed
app.use((req, res, next) => {
  Object.defineProperty(res.locals, 'csrfToken', {
    get: function() {
      return generateToken(req, res);
    },
    configurable: true,
  });
  next();
});

// Static files
app.use(express.static(path.join(projectRoot, "public")));

// View engine setup
app.set("view engine", "ejs");
app.set("views", path.join(projectRoot, "views"));
app.use(expressLayouts);
app.set("layout", "layouts/main");

// Global locals (flash messages, current path)
app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.currentPath = req.path;
  next();
});

// Apply optional auth to all routes (attaches user if logged in)
app.use(optionalAuth);

// Routes
app.use("/", routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
