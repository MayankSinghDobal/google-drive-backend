import express from "express"; 
import { Server as SocketIOServer } from "socket.io";
import passport from "passport";
import authRoutes from "./routes/auth";
import fileRoutes from "./routes/files";
import folderRoutes from "./routes/folders";
import searchRoutes from "./routes/search";
import "./config/passport";
import { supabase } from "./config/supabase";
import cors from "cors";

const app = express();

// Fixed CORS configuration for Vercel
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000", 
  "https://google-drive-frontend-2cxh.vercel.app",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`CORS blocked origin: ${origin}`);
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With", 
    "Content-Type",
    "Accept",
    "Authorization",
  ],
  optionsSuccessStatus: 200,
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options("*", cors(corsOptions));

// Use express.json() for parsing JSON request bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize passport middleware
app.use(passport.initialize());

// Debug middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`, {
    origin: req.headers.origin,
    authorization: req.headers.authorization ? "Bearer ***" : "None",
  });
  next();
});

// Health check endpoints
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Google Drive Backend API",
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0"
  });
});

app.get("/test", (req, res) => {
  res.status(200).json({
    message: "Backend is working!",
    timestamp: new Date().toISOString(),
    origin: req.headers.origin,
    cors: "enabled",
    environment: process.env.NODE_ENV || "development"
  });
});

app.get("/ping", (req, res) => {
  res.status(200).json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    origin: req.headers.origin,
    server: "vercel"
  });
});

// Test Supabase connection
app.get("/health", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('count', { count: 'exact' })
      .limit(1);
    
    if (error) {
      throw error;
    }
    
    res.status(200).json({
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Health check failed:", error);
    res.status(503).json({
      status: "unhealthy",
      database: "disconnected",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Mount API routes
app.use("/auth", authRoutes);
app.use("/files", fileRoutes);
app.use("/folders", folderRoutes);
app.use("/search", searchRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.path,
    method: req.method,
    availableRoutes: ["/auth", "/files", "/folders", "/search", "/ping", "/test", "/health"],
  });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Global error handler:", err);
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : "Something went wrong",
    timestamp: new Date().toISOString(),
  });
});

// For Vercel serverless functions, we need to export the app
export default app;

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log("=".repeat(60));
    console.log(`Server running on port ${PORT}`);
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
    console.log(`Health check: http://localhost:${PORT}/ping`);
    console.log(`Test CORS: http://localhost:${PORT}/test`);
    console.log("=".repeat(60));
  });
}

// Export io for file routes (simplified for serverless)
export const io = {
  to: (room: string) => ({
    emit: (event: string, data: any) => {
      console.log(`Socket emit to ${room}:`, event, data);
      // In serverless, we can't maintain WebSocket connections
      // Consider using Supabase Realtime or another service
    }
  })
};