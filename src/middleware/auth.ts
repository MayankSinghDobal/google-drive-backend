// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

/**
 * Local interface describing the user properties we expect from the JWT.
 * This is intentionally local and not merged into Express types (to avoid
 * conflicts with @types/passport or other declarations).
 */
interface JWTUser {
  id: number;
  email?: string;
  name?: string;
  [key: string]: any;
}

/**
 * Middleware to authenticate JWT from Authorization header
 * Expects header: Authorization: Bearer <token>
 */
export function authenticateJWT(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("JWT_SECRET is not set");
    return res.status(500).json({ error: "Server configuration error" });
  }

  try {
    const decoded = jwt.verify(token, secret);

    // jwt.verify returns string | JwtPayload. Reject plain strings.
    if (typeof decoded === "string") {
      console.warn("JWT payload is a string — rejecting");
      return res.status(401).json({ error: "Invalid token payload" });
    }

    // Treat decoded as JwtPayload + our optional fields
    const payload = decoded as JwtPayload & Partial<JWTUser>;

    // Ensure we have an id (numeric)
    if (!payload || typeof payload.id !== "number") {
      return res.status(401).json({ error: "Invalid token payload: missing id" });
    }

    // Build a cleaned user object. Ensure name exists so other code that expects it won't error.
    const user: JWTUser = {
      id: payload.id,
      email: typeof payload.email === "string" ? payload.email : "",
      name: typeof payload.name === "string" ? payload.name : "",
      // include any other useful fields present in payload if you want:
      // ... (payload as any)
    };

    // Assign to req.user. Cast to any to avoid colliding with existing Express/passport Request.user typings.
    (req as any).user = user;

    next();
  } catch (err) {
    console.warn("JWT verification failed:", err);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export default authenticateJWT;
