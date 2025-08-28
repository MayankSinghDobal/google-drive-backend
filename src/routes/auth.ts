import express, { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase";
import passport from "../config/passport";
import { authenticateJWT } from "../middleware/auth";
import { OAuth2Client } from "google-auth-library";

const router: Router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Debug middleware
router.use((req, res, next) => {
  console.log(`[AUTH] ${req.method} ${req.path}`, {
    origin: req.headers.origin,
    contentType: req.headers['content-type'],
  });
  next();
});

// /me endpoint - FIX: Match frontend expectation
router.get("/me", authenticateJWT, async (req: Request, res: Response) => {
  try {
    const user = req.user as { userId: number; email: string };
    
    const { data, error } = await supabase
      .from("users")
      .select("id, email, name")
      .eq("id", user.userId)
      .single();

    if (error) {
      console.error("Fetch user error:", error);
      return res.status(404).json({ error: "User not found" });
    }

    // FIX: Return user directly, not wrapped in user object
    res.status(200).json({ user: data });
  } catch (error: unknown) {
    console.error("Fetch user error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: `Failed to get user: ${errorMessage}` });
  }
});

// Regular signup
router.post("/signup", async (req: Request, res: Response) => {
  const { email, password, name } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  
  try {
    const { data: existingUser, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();
      
    if (userError && userError.code !== "PGRST116") {
      console.error("Check user error:", userError);
      throw userError;
    }
    
    if (existingUser) {
      return res.status(409).json({ error: "Email already exists" });
    }
    
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    const { data, error } = await supabase
      .from("users")
      .insert([{ email, password: hashedPassword, name }])
      .select("id, email, name")
      .single();
      
    if (error) {
      console.error("Insert user error:", error);
      throw error;
    }
    
    const token = jwt.sign(
      { userId: data.id, email: data.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "24h" }
    );
    
    res.status(201).json({
      message: "Signup successful",
      token,
      user: data,
    });
  } catch (error: unknown) {
    console.error("Signup error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: `Signup failed: ${errorMessage}` });
  }
});

// Regular login
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  
  try {
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, email, name, password")
      .eq("email", email)
      .single();
      
    if (userError || !user) {
      console.error("User not found:", email);
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    // Check if user has a password (not a Google OAuth user)
    if (!user.password) {
      return res.status(401).json({ error: "This account was created with Google. Please use Google Sign-In." });
    }
    
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.error("Invalid password for:", email);
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "24h" }
    );
    
    res.status(200).json({
      message: "Login successful",
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error: unknown) {
    console.error("Login error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: `Login failed: ${errorMessage}` });
  }
});

// Google OAuth login via token - FIXED
router.post("/google", async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Google token is required" });
  }
  
  try {
    console.log("Verifying Google token...");
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      console.error("Invalid Google token payload");
      return res.status(401).json({ error: "Invalid Google token" });
    }
    
    console.log("Google token verified for:", payload.email);
    
    let user;
    const { data: existingUser, error: userError } = await supabase
      .from("users")
      .select("id, email, name")
      .eq("email", payload.email)
      .single();
      
    if (userError && userError.code !== "PGRST116") {
      console.error("Fetch user error:", userError);
      throw userError;
    }
    
    if (existingUser) {
      user = existingUser;
      console.log("Found existing user:", user.email);
    } else {
      console.log("Creating new user for:", payload.email);
      // FIX: Don't include password field for Google OAuth users
      const { data: newUser, error } = await supabase
        .from("users")
        .insert([{ 
          email: payload.email, 
          name: payload.name || payload.email,
          password: null // Explicitly set password as null for Google OAuth users
        }])
        .select("id, email, name")
        .single();
        
      if (error) {
        console.error("Insert user error:", error);
        throw error;
      }
      user = newUser;
      console.log("Created new user:", user.email);
    }
    
    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "24h" }
    );
    
    res.status(200).json({
      message: "Google login successful",
      token: jwtToken,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error: unknown) {
    console.error("Google login error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: `Google login failed: ${errorMessage}` });
  }
});

// Logout
router.post("/logout", (req: Request, res: Response) => {
  res.status(200).json({ message: "Logout successful. Please discard your token." });
});

// Server-side Google OAuth routes
router.get(
  "/google/oauth",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { session: false }),
  (req: Request, res: Response) => {
    const user = req.user as { id: number; email: string; name: string };
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "24h" }
    );
    const frontendUrl = process.env.NODE_ENV === 'production'
      ? 'https://google-drive-frontend-2cxh.vercel.app'
      : 'http://localhost:5173';
    res.redirect(
      `${frontendUrl}/auth/callback?token=${token}&user=${encodeURIComponent(
        JSON.stringify(user)
      )}`
    );
  }
);

// Protected route
router.get("/protected", authenticateJWT, (req: Request, res: Response) => {
  res.status(200).json({ message: "Access granted to protected route", user: req.user });
});

export default router;