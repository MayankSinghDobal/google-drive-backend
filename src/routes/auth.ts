import express, { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { supabase } from '../config/supabase';

const router: Router = express.Router();

// POST route for signup
router.post('/signup', async (req: Request, res: Response) => {
  const { email, password, name } = req.body;

  // Basic input validation
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Check if email already exists
    const { data: existingUser, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
    
    if (userError && userError.code !== 'PGRST116') {
      throw userError; // Handle errors except "no rows found"
    }
    if (existingUser) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    // Hash password with bcrypt
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert new user into Supabase
    const { data, error } = await supabase
      .from('users')
      .insert([{ email, password: hashedPassword, name }])
      .select('id, email, name')
      .single();

    if (error) throw error;

    res.status(201).json({ message: 'User created successfully', user: data });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Signup failed: ${errorMessage}` });
  }
});

// POST routes for login, logout (unchanged)
router.post('/login', (req: Request, res: Response) => {
  res.status(501).send('Login not implemented yet');
});

router.post('/logout', (req: Request, res: Response) => {
  res.status(501).send('Logout not implemented yet');
});

// Temporary GET routes for browser testing
router.get('/signup', (req: Request, res: Response) => {
  res.status(200).send('GET /auth/signup works! Use POST for actual signup.');
});

router.get('/login', (req: Request, res: Response) => {
  res.status(200).send('GET /auth/login works! Use POST for actual login.');
});

router.get('/logout', (req: Request, res: Response) => {
  res.status(200).send('GET /auth/logout works! Use POST for actual logout.');
});

export default router;