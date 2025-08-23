import express, { Express, Request, Response } from 'express';
import { supabase } from './config/supabase';
import authRouter from './routes/auth';
import fileRouter from './routes/files';
import folderRouter from './routes/folders';
import passport from './config/passport';
import session from 'express-session';

const app: Express = express();
const port: number = 3000;

// Enable JSON parsing for POST requests
app.use(express.json());

// Enable sessions for Passport
app.use(
  session({
    secret: process.env.JWT_SECRET as string,
    resave: false,
    saveUninitialized: false,
  })
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Mount authentication, file, and folder routes
app.use('/auth', authRouter);
app.use('/files', fileRouter);
app.use('/folders', folderRouter);

// Test Supabase connection
app.get('/', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from('users').select('*').limit(1);
    if (error) throw error;
    res.send(`Supabase connected! Users table data: ${JSON.stringify(data)}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).send(`Supabase connection error: ${errorMessage}`);
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});