
     import express from 'express';
     import http from 'http';
     import { Server as SocketIOServer } from 'socket.io';
     import passport from 'passport';
     import authRoutes from './routes/auth';
     import fileRoutes from './routes/files';
     import folderRoutes from './routes/folders';
     import searchRoutes from './routes/search';
     import './config/passport'; // Initialize Passport
     import { supabase } from './config/supabase';

     const app = express();
     const server = http.createServer(app);
     const io = new SocketIOServer(server, {
       cors: {
         origin: '*', // Allow all origins for testing (restrict in production)
         methods: ['GET', 'POST'],
       },
     });

     // Middleware
     app.use(express.json());
     app.use(passport.initialize());

     // Routes
     app.use('/auth', authRoutes);
     app.use('/files', fileRoutes);
     app.use('/folders', folderRoutes);
     app.use('/search', searchRoutes);

     // WebSocket connection
     io.on('connection', (socket) => {
       console.log('Client connected:', socket.id);

       // Handle client joining a file's channel
       socket.on('join_file', async (fileId: string) => {
         try {
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
         } catch (err) {
           const errorMessage = err instanceof Error ? err.message : 'Unknown error';
           socket.emit('error', { message: `Failed to join file channel: ${errorMessage}` });
         }
       });

       socket.on('disconnect', () => {
         console.log('Client disconnected:', socket.id);
       });
     });

     // Export io for use in routes
     export { io };

     const PORT = process.env.PORT || 3000;
     server.listen(PORT, () => {
       console.log(`Server running on port ${PORT}`);
     });
     