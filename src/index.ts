import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import passport from "passport";
import authRoutes from "./routes/auth";
import fileRoutes from "./routes/files";
import folderRoutes from "./routes/folders";
import searchRoutes from "./routes/search";
import "./config/passport"; // Initialize Passport
import { supabase } from "./config/supabase";
import cors from "cors";

const app = express();
const server = http.createServer(app);

// Simple CORS configuration for Vercel
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  next();
});

// Additional CORS middleware
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 200,
  })
);

const io = new SocketIOServer(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:3000"],
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  },
});

// Other Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(passport.initialize());

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ 
    message: "Google Drive Backend API is running!",
    timestamp: new Date().toISOString(),
    cors: "enabled"
  });
});

// Test endpoint to check CORS
app.get("/test", (req, res) => {
  res.json({ 
    message: "CORS test successful",
    origin: req.headers.origin,
    method: req.method
  });
});

// Routes
app.use("/auth", authRoutes);
app.use("/files", fileRoutes);
app.use("/folders", folderRoutes);
app.use("/search", searchRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// WebSocket connection
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join_file", async (fileId: string) => {
    try {
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
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      socket.emit("error", {
        message: `Failed to join file channel: ${errorMessage}`,
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Export io for use in routes
export { io };

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});