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
import path from "path";

const app = express();
const server = http.createServer(app);

// Enhanced CORS configuration
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Allow requests with no origin (mobile apps, curl requests, Postman)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://google-drive-frontend-2cxh.vercel.app',
      'https://google-drive-backend-ten.vercel.app'
    ];

    if (allowedOrigins.includes(origin)) {
      console.log('CORS allowed origin:', origin);
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(null, false); // Don't throw error, just deny
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin', 
    'X-Requested-With', 
    'Content-Type', 
    'Accept', 
    'Authorization',
    'Access-Control-Allow-Credentials'
  ],
  optionsSuccessStatus: 200 // For legacy browser support
};

// Apply CORS middleware first
app.use(cors(corsOptions));

// Handle preflight requests explicitly - FIXED: Added parameter name to wildcard
app.options('/*path', cors(corsOptions));

// Add explicit CORS headers for all responses
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

// Use express.json() for parsing JSON request bodies
app.use(express.json());

// Initialize passport middleware
app.use(passport.initialize());

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`, {
    origin: req.headers.origin,
    userAgent: req.headers['user-agent']?.substring(0, 50) + '...',
  });
  next();
});

// Test endpoint to verify CORS is working
app.get("/test", (req, res) => {
  res.status(200).json({
    message: "Backend is working!",
    timestamp: new Date().toISOString(),
    origin: req.headers.origin,
    cors: "enabled"
  });
});

// Simple health check endpoint
app.get("/ping", (req, res) => {
  res.status(200).json({ 
    status: "ok", 
    timestamp: new Date().toISOString() 
  });
});

// Mount API routes with explicit paths
app.use("/auth", authRoutes);
app.use("/files", fileRoutes);
app.use("/folders", folderRoutes);
app.use("/search", searchRoutes);

// Serve static files from the 'public' directory (if it exists)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
  
  // Fixed fallback for SPA routing in production - Express 5 compatible
  app.get('/*path', (req, res) => {
    // Only serve index.html for non-API routes
    if (!req.path.startsWith('/api') && !req.path.startsWith('/auth') && 
        !req.path.startsWith('/files') && !req.path.startsWith('/folders') && 
        !req.path.startsWith('/search')) {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
      res.status(404).json({ 
        error: 'Route not found',
        path: req.path,
        method: req.method
      });
    }
  });
}

// 404 handler for development
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res) => {
    res.status(404).json({ 
      error: 'Route not found',
      path: req.path,
      method: req.method
    });
  });
}

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Socket.io setup for real-time communication
const io = new SocketIOServer(server, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://google-drive-frontend-2cxh.vercel.app',
      'https://google-drive-backend-ten.vercel.app'
    ],
    methods: ['GET', 'POST'],
    credentials: true
  },
});

io.on("connection", (socket) => {
  console.log("WebSocket client connected:", socket.id);
  
  // Handle client joining a file's channel
  socket.on('join_file', async (fileId: string) => {
    try {
      // Validate fileId
      if (!fileId || isNaN(parseInt(fileId))) {
        socket.emit('error', { message: 'Invalid file ID' });
        return;
      }

      // Verify file exists and is not deleted
      const { data: file, error } = await supabase
        .from('files')
        .select('id')
        .eq('id', fileId)
        .is('deleted_at', null)
        .single();

      if (error || !file) {
        socket.emit('error', { message: 'File not found or deleted' });
        return;
      }

      // Join the file's room
      socket.join(`file:${fileId}`);
      console.log(`Client ${socket.id} joined file:${fileId}`);
      socket.emit('joined_file', { fileId });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      socket.emit('error', { message: `Failed to join file channel: ${errorMessage}` });
    }
  });

  socket.on("disconnect", () => {
    console.log("WebSocket client disconnected:", socket.id);
  });
});

// Export io for use in routes
export { io };

const PORT = process.env.PORT || 3000;

// Enhanced server startup
server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`Server running on port ${PORT}`);
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/ping`);
  console.log(`Test CORS: http://localhost:${PORT}/test`);
  console.log('='.repeat(60));
  
  // Test database connection on startup (only in development)
  if (process.env.NODE_ENV !== 'production') {
    setTimeout(async () => {
      try {
        const { testSupabaseConnection } = await import('./config/supabase');
        const connected = await testSupabaseConnection();
        console.log(`Database connection: ${connected ? 'Connected' : 'Failed'}`);
      } catch (err) {
        console.error('Database connection test failed:', err);
      }
    }, 1000);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server shut down.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server shut down.');
    process.exit(0);
  });
});