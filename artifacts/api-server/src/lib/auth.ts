import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";

export const SESSION_COOKIE = "luma_session";

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required. Add it to the server environment before using authentication.");
  }
  return secret;
}

export function safeUser(user: User) {
  return { id: user.id, name: user.name, email: user.email };
}

export function setSession(response: Response, user: User): void {
  const token = jwt.sign({ sub: user.id }, jwtSecret(), { expiresIn: "7d" });
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSession(response: Response): void {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function authenticatedUser(request: Request): Promise<User | null> {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) return null;

  try {
    const payload = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
    if (typeof payload.sub !== "string") return null;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub)).limit(1);
    return user ?? null;
  } catch {
    return null;
  }
}

export async function requireUser(request: Request, response: Response): Promise<User | null> {
  try {
    const user = await authenticatedUser(request);
    if (!user) {
      response.status(401).json({ error: "Authentication required" });
      return null;
    }
    return user;
  } catch (error) {
    response.status(503).json({ error: error instanceof Error ? error.message : "Authentication is not configured" });
    return null;
  }
}