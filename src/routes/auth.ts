import express, { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase";
import passport from "../config/passport";
import { authenticateJWT } from "../middleware/auth";
import { OAuth2Client } from "google-auth-library";

const router: Router = express.Router();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Add the missing /me endpoint
router.get("/me", authenticateJWT, async (req: Request, res: Response) => {
  try {
    const user = req.user as { userId: number; email: string };
    
    const { data, error } = await supabase
      .from("users")
      .select("id, email, name")
      .eq("id", user.userId)
      .single();

    if (error) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({ user: data });
  } catch (error: unknown) {
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
    if (error) throw error;
    const token = jwt.sign(
      { userId: data.id, email: data.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "24h" } // Extended expiration
    );
    res
      .status(201)
      .json({ message: "User created successfully", token, user: data });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
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
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "24h" } // Extended expiration
    );
    res.status(200).json({
      message: "Login successful",
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: `Login failed: ${errorMessage}` });
  }
});

// Google login (client-side JWT)
router.post("/google", async (req: Request, res: Response) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: "Google credential is required" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(400).json({ error: "Invalid Google credential" });
    }

    const { email, name } = payload;

    // Check for existing user
    const { data: existingUser, error: userError } = await supabase
      .from("users")
      .select("id, email, name")
      .eq("email", email)
      .single();

    if (userError && userError.code !== "PGRST116") {
      throw userError;
    }

    let user;
    if (existingUser) {
      user = existingUser;
    } else {
      // Create new user
      const { data: newUser, error } = await supabase
        .from("users")
        .insert([{ email, name }])
        .select("id, email, name")
        .single();
      if (error) throw error;
      user = newUser;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "24h" } // Extended expiration
    );

    res.status(200).json({
      message: "Google login successful",
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: `Google login failed: ${errorMessage}` });
  }
});

// Logout
router.post("/logout", (req: Request, res: Response) => {
  res
    .status(200)
    .json({ message: "Logout successful. Please discard your token." });
});

// Server-side Google OAuth routes (optional, kept for reference)
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
    // Update the redirect URL to match your frontend
    res.redirect(
      `http://localhost:5173/auth/callback?token=${token}&user=${encodeURIComponent(
        JSON.stringify(user)
      )}`
    );
  }
);

// Protected route
router.get("/protected", authenticateJWT, (req: Request, res: Response) => {
  res
    .status(200)
    .json({ message: "Access granted to protected route", user: req.user });
});

export default router;