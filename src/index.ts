import express from 'express';
import passport from 'passport';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import filesRoutes from './routes/files';
import foldersRoutes from './routes/folders';
import searchRoutes from './routes/search';
import './config/passport'; // Initialize Passport config

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(passport.initialize());

// Routes
app.use('/auth', authRoutes);
app.use('/files', filesRoutes);
app.use('/folders', foldersRoutes);
app.use('/search', searchRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});