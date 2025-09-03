import express from "express";
import passport from "passport";
import cors from "cors";
import dotenv from "dotenv";
import { Router } from 'express';

// Load .env file for local development
console.log("Attempting to load .env file...");
const result = dotenv.config();
if (result.error) {
  console.error("Error loading .env file:", result.error);
} else {
  console.log("Successfully loaded .env file:", result.parsed);
}

// Check for missing environment variables
const requiredEnvVars = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "JWT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];

const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);
if (missingVars.length > 0) {
  console.warn(`Missing required environment variables: ${missingVars.join(", ")}`);
  console.warn("Continuing server startup with missing variables");
} else {
  console.log("All required environment variables are present");
}

// Import routes and configs with error handling
// Import routes and configs with error handling
let authRoutes: Router | undefined;
let fileRoutes: Router | undefined;
let folderRoutes: Router | undefined;
let searchRoutes: Router | undefined;
let clipboardRoutes: Router | undefined;
let shareRoutes: Router | undefined;
let supabase;

try {
  authRoutes = require("./routes/auth").default;
  console.log("Successfully imported auth routes");
} catch (err) {
  console.error("Error importing auth routes:", err);
}

try {
  fileRoutes = require("./routes/files").default;
  console.log("Successfully imported file routes");
} catch (err) {
  console.error("Error importing file routes:", err);
}

try {
  folderRoutes = require("./routes/folders").default;
  console.log("Successfully imported folder routes");
} catch (err) {
  console.error("Error importing folder routes:", err);
}

try {
  searchRoutes = require("./routes/search").default;
  console.log("Successfully imported search routes");
} catch (err) {
  console.error("Error importing search routes:", err);
}

try {
  clipboardRoutes = require("./routes/clipboard").default;
  console.log("Successfully imported clipboard routes");
} catch (err) {
  console.error("Error importing clipboard routes:", err);
}

try {
  shareRoutes = require("./routes/share").default;
  console.log("Successfully imported share routes");
} catch (err) {
  console.error("Error importing share routes:", err);
}
try {
  require("./config/passport");
  console.log("Successfully imported passport config");
} catch (err) {
  console.error("Error importing passport config:", err);
}

try {
  supabase = require("./config/supabase").supabase;
  console.log("Successfully imported supabase config");
} catch (err) {
  console.error("Error importing supabase config:", err);
}

const app = express();

// Enhanced CORS configuration
const corsOptions: cors.CorsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:3000", 
    "https://google-drive-frontend-2cxh.vercel.app",
    "https://google-drive-backend-ten.vercel.app",
    "https://accounts.google.com", // Add this for Google OAuth
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "X-Requested-With",
    "Access-Control-Allow-Headers",
  ],
  optionsSuccessStatus: 200,
};

console.log("Setting up CORS middleware...");
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

console.log("Setting up JSON parsing...");
app.use(express.json({ limit: '50mb' })); // Increased limit for large uploads
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

console.log("Initializing Passport...");
try {
  app.use(passport.initialize());
} catch (err) {
  console.error("Error initializing Passport:", err);
}

// Security headers
app.use((req, res, next) => {
  res.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  next();
});

// Debug middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`, {
    origin: req.headers.origin,
    authorization: req.headers.authorization ? "Bearer ***" : "None",
    contentType: req.headers['content-type'],
  });
  next();
});
// ADD THIS NEW DEBUG MIDDLEWARE
app.use('/share', (req, res, next) => {
  console.log(`[SHARE DEBUG] ${req.method} ${req.path}`, {
    shareRoutes: !!shareRoutes,
    params: req.params,
  });
  next();
});
// Health check endpoints
app.get("/", (req, res) => {
  res.json({
    message: "Google Drive Clone API",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    status: "healthy"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

app.get("/test", (req, res) => {
  res.json({
    message: "Test successful",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

app.get("/ping", (req, res) => {
  res.json({
    message: "pong",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Routes
console.log("Registering routes...");
try {
  if (authRoutes) app.use("/auth", authRoutes);
  if (fileRoutes) app.use("/files", fileRoutes);
  if (folderRoutes) app.use("/folders", folderRoutes);
  if (searchRoutes) app.use("/search", searchRoutes);
  if (clipboardRoutes) app.use("/clipboard", clipboardRoutes);
  if (shareRoutes) app.use("/share", shareRoutes);
  
  console.log("Routes registered successfully");
} catch (err) {
  console.error("Error registering routes:", err);
}

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
    method: req.method,
    availableRoutes: [
      "GET /",
      "GET /health",
      "GET /test",
      "GET /ping",
      "POST /auth/*",
      "GET /files/*",
      "POST /files/*",
      "GET /folders/*",
      "POST /folders/*",
      "GET /search",
      "POST /clipboard/*",
      "GET /share/*"
    ]
  });
});

// Global error handler
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Global error:", {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString()
    });
    
    const response: { error: string; details?: string; timestamp: string } = {
      error: "Internal server error",
      timestamp: new Date().toISOString()
    };
    
    if (!process.env.NODE_ENV || process.env.NODE_ENV !== "production") {
      response.details = err.message;
    }
    
    res.status(500).json(response);
  }
);

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Wrap entire startup in try/catch
try {
  // For Vercel, export the app directly
  module.exports = app;

  // For local development, start the server
  if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    console.log(`Starting server on port ${PORT}...`);
    const server = app.listen(PORT, () => {
      console.log("=".repeat(60));
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📅 Started at: ${new Date().toISOString()}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`💚 Health check: http://localhost:${PORT}/health`);
      console.log(`🧪 Test CORS: http://localhost:${PORT}/test`);
      console.log(`📁 API Docs: http://localhost:${PORT}/`);
      console.log("=".repeat(60));
    });

    server.on("error", (err) => {
      console.error("Server startup error:", err);
      process.exit(1);
    });

    server.timeout = 300000; // 5 minutes for large file uploads
  }
} catch (err) {
  console.error("Startup error:", err);
  process.exit(1);
}