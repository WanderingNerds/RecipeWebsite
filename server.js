import "dotenv/config";
import app from "./src/app.js";

const PORT = process.env.PORT || 3000;

// Only start server if not in serverless environment
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  });
}

// Export for Vercel serverless
export default app;
