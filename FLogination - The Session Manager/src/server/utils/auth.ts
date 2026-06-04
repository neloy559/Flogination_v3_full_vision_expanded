/**
 * Flogination V5 — Auth Scaffold
 *
 * Authentication utilities for future SaaS multi-user support.
 * Currently DISABLED — single-operator mode.
 *
 * Enable by setting AUTH_ENABLED=true in .env
 * When enabled, all API routes require a valid JWT Bearer token.
 *
 * Usage (future):
 *  POST /api/auth/register  { email, password }
 *  POST /api/auth/login     { email, password } → { token }
 *  All other routes: Authorization: Bearer <token>
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const SALT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET ?? 'flogination-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

/** Returns true if authentication is enabled via AUTH_ENABLED env var. */
export function isAuthEnabled(): boolean {
  return process.env.AUTH_ENABLED === 'true';
}

/**
 * Hashes a plain-text password using bcrypt.
 * @param plain - The plain-text password to hash.
 * @returns The bcrypt hash string.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Verifies a plain-text password against a bcrypt hash.
 * @param plain - The plain-text password to verify.
 * @param hash  - The stored bcrypt hash.
 * @returns True if the password matches.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Generates a signed JWT for a user.
 * @param userId - The user's UUID.
 * @returns A signed JWT string.
 */
export function generateJWT(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verifies and decodes a JWT.
 * @param token - The JWT string to verify.
 * @returns The decoded payload, or null if invalid.
 */
export function verifyJWT(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string };
  } catch {
    return null;
  }
}
