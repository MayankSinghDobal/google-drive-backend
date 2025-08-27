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

const app = express();
const server = http.createServer(app);

// Enhanced CORS configuration
const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://google-drive-frontend-2cxh.vercel.app',
    'https://google-drive-backend-ten.vercel.app'
  ],
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
  optionsSuccessStatus: 200
};

// Apply CORS middleware first
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// Add explicit CORS headers for all responses
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && corsOptions.origin.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Use express.json() for parsing JSON request bodies
app.use(express.json());

// Initialize passport middleware
app.use(passport.initialize());

// Debug middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`, {
    origin: req.headers.origin,
    authorization: req.headers.authorization ? 'Bearer ***' : 'None',
  });
  next();
});

// Test endpoints
app.get("/test", (req, res) => {
  res.status(200).json({
    message: "Backend is working!",
    timestamp: new Date().toISOString(),
    origin: req.headers.origin,
    cors: "enabled"
  });
});

app.get("/ping", (req, res) => {
  res.status(200).json({ 
    status: "ok", 
    timestamp: new Date().toISOString() 
  });
});

// Mount API routes
app.use("/auth", authRoutes);
app.use("/files", fileRoutes);
app.use("/folders", folderRoutes);
app.use("/search", searchRoutes);

// Production static file serving
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
  
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/auth') || req.path.startsWith('/files') || 
        req.path.startsWith('/folders') || req.path.startsWith('/search') ||
        req.path.startsWith('/ping') || req.path.startsWith('/test')) {
      next();
    } else {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method,
    availableRoutes: ['/auth', '/files', '/folders', '/search', '/ping', '/test']
  });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Socket.io setup
const io = new SocketIOServer(server, {
  cors: corsOptions
});

io.on("connection", (socket) => {
  console.log("WebSocket client connected:", socket.id);
  
  socket.on('join_file', async (fileId: string) => {
    try {
      if (!fileId || isNaN(parseInt(fileId))) {
        socket.emit('error', { message: 'Invalid file ID' });
        return;
      }

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

export { io };

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`Server running on port ${PORT}`);
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/ping`);
  console.log(`Test CORS: http://localhost:${PORT}/test`);
  console.log('='.repeat(60));
});

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