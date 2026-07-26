import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import session from "express-session";
import flash from "connect-flash";
import cookieParser from "cookie-parser";
import { optionalAuth } from "./middleware/authMiddleware.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import routes from "./routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  origin: process.env.APP_URL || "http://localhost:3000",
  credentials: true,
}));

// Cookie parser for auth tokens
app.use(cookieParser());

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session for flash messages
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 1000 * 60 * 60, // 1 hour for flash messages
  },
}));
app.use(flash());

// Static files
app.use(express.static(path.join(__dirname, "../public")));

// View engine setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));
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
