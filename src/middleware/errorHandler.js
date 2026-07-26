/**
 * 404 Not Found handler
 */
export function notFoundHandler(req, res, next) {
  res.status(404).render("error", {
    title: "Page Not Found",
    message: "The page you're looking for doesn't exist.",
    error: { status: 404 },
  });
}

/**
 * Global error handler
 */
export function errorHandler(err, req, res, next) {
  console.error("Error:", err);

  const statusCode = err.status || 500;
  const message = process.env.NODE_ENV === "production"
    ? "Something went wrong"
    : err.message;

  res.status(statusCode).render("error", {
    title: "Error",
    message,
    error: process.env.NODE_ENV === "production" ? {} : err,
  });
}
