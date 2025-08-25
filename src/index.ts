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

// CORS Configuration - Fix the origins
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://your-frontend-domain.vercel.app", // Replace with your actual frontend domain
];

// Apply CORS middleware BEFORE other middleware
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    optionsSuccessStatus: 200, // For legacy browser support
  })
);

// Handle preflight requests
app.options('*', cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

const io = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  },
});

// Other Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ message: "Google Drive Backend API is running!" });
});

// Routes
app.use("/auth", authRoutes);
app.use("/files", fileRoutes);
app.use("/folders", folderRoutes);
app.use("/search", searchRoutes);

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
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
});