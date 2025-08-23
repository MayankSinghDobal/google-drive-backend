import express, { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';
import passport from '../config/passport';
import { authenticateJWT } from '../middleware/auth';

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
      throw userError;
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

// POST route for login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // Basic input validation
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Fetch user from Supabase
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, password, name')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password with bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: '1h' }
    );

    res.status(200).json({ message: 'Login successful', token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Login failed: ${errorMessage}` });
  }
});

// POST route for logout
router.post('/logout', (req: Request, res: Response) => {
  res.status(200).json({ message: 'Logout successful. Please discard your token.' });
});

// Google OAuth routes
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', passport.authenticate('google', { session: true }), (req: Request, res: Response) => {
  const user = req.user as { id: number; email: string; name: string };
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
  res.status(200).json({ message: 'Google login successful', token, user });
});

// Test protected route
router.get('/protected', authenticateJWT, (req: Request, res: Response) => {
  res.status(200).json({ message: 'Access granted to protected route', user: req.user });
});

export default router;