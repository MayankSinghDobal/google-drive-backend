import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import passport from "passport";
import authRoutes from "./routes/auth";
import fileRoutes from "./routes/files";
import folderRoutes from "./routes/folders";
import searchRoutes from "./routes/search";
import "./config/passport";
import { supabase } from "./config/supabase";
import cors from "cors";
import path from "path";

// Check for missing environment variables
const requiredEnvVars = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "JWT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "FRONTEND_URL",
  "BASE_URL",
];

const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);
if (missingVars.length > 0) {
  console.error(
    `Missing required environment variables: ${missingVars.join(", ")}`
  );
  process.exit(1); // Exit if variables are missing
}

const app = express();
const server = http.createServer(app);

// CORS configuration
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://google-drive-frontend-2cxh.vercel.app",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    console.log(`CORS check for origin: ${origin}`); // Debug CORS
    if (!origin || allowedOrigins.includes(origin)) {
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

// Apply CORS middleware first
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Parse JSON bodies
app.use(express.json());

// Initialize Passport
app.use(passport.initialize());

// Debug middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`, {
    origin: req.headers.origin,
    authorization: req.headers.authorization ? "Bearer ***" : "None",
  });
  next();
});

// Test endpoints
app.get("/test", (req, res) => {
  console.log("Handling /test request");
  res.json({ message: "Test successful" });
});

app.get("/ping", (req, res) => {
  console.log("Handling /ping request");
  res.json({ message: "pong" });
});

// Routes
app.use("/auth", authRoutes);
app.use("/files", fileRoutes);
app.use("/folders", folderRoutes);
app.use("/search", searchRoutes);

// Global error handler
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Global error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
);

// Socket.IO setup
const io = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("WebSocket client connected:", socket.id);

  socket.on("join_file", async (fileId: string) => {
    try {
      if (!fileId || isNaN(parseInt(fileId))) {
        socket.emit("error", { message: "Invalid file ID" });
        return;
      }

      const { data: file, error } = await supabase
        .from("files")
        .select("id")
        .eq("id", fileId)
        .is("deleted_at", null)
        .single();

      if (error || !file) {
        socket.emit("error", { message: "File not found or deleted" });
        return;
      }

      socket.join(`file:${fileId}`);
      console.log(`Client ${socket.id} joined file:${fileId}`);
      socket.emit("joined_file", { fileId });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      socket.emit("error", {
        message: `Failed to join file channel: ${errorMessage}`,
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("WebSocket client disconnected:", socket.id);
  });
});

export { io };

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log(`Server running on port ${PORT}`);
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
  console.log(`Health check: http://localhost:${PORT}/ping`);
  console.log(`Test CORS: http://localhost:${PORT}/test`);
  console.log("=".repeat(60));
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("Server shut down.");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully...");
  server.close(() => {
    console.log("Server shut down.");
    process.exit(0);
  });
});
