/**
 * Flogination V5 — Cookie Encryption
 *
 * AES-256-GCM encryption for sensitive session data stored in SQLite.
 * Facebook cookies are encrypted at rest — never stored as plain text.
 *
 * Key source: ENCRYPTION_KEY env var (32-byte hex string).
 * Falls back to a dev key if not set — CHANGE IN PRODUCTION.
 *
 * Format: iv:authTag:ciphertext (all hex-encoded, colon-separated)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Returns the 32-byte encryption key from env or a dev fallback.
 * Logs a warning if using the dev fallback.
 */
function getKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    return Buffer.from(envKey, 'hex');
  }
  // Dev fallback — warn but don't crash
  if (process.env.NODE_ENV === 'production') {
    console.error('[encryption] ENCRYPTION_KEY not set in production — using insecure fallback');
  }
  return Buffer.from('flogination-dev-key-32bytes-paddd', 'utf-8');
}

/**
 * Encrypts a plain-text string using AES-256-GCM.
 * Returns a colon-separated string: iv:authTag:ciphertext (all hex).
 *
 * @param plain - The plain-text string to encrypt.
 * @returns The encrypted string, or the original if encryption fails.
 *
 * @example
 * const encrypted = encrypt('c_user=123;xs=abc...')
 * // → 'a1b2c3...:d4e5f6...:7890ab...'
 */
export function encrypt(plain: string): string {
  if (!plain || plain.trim().length === 0) return plain;

  // Already encrypted (has our format)
  if (plain.split(':').length === 3 && plain.split(':')[0].length === 32) {
    return plain;
  }

  try {
    const key = getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plain, 'utf-8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[encryption] Encrypt failed: ${message}`);
    return plain; // Return plain on failure — don't lose data
  }
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * Returns the original string if decryption fails (e.g. unencrypted legacy data).
 *
 * @param encrypted - The encrypted string (iv:authTag:ciphertext format).
 * @returns The decrypted plain-text string.
 *
 * @example
 * const plain = decrypt('a1b2c3...:d4e5f6...:7890ab...')
 * // → 'c_user=123;xs=abc...'
 */
export function decrypt(encrypted: string): string {
  if (!encrypted || encrypted.trim().length === 0) return encrypted;

  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    // Not in our format — return as-is (legacy unencrypted data)
    return encrypted;
  }

  try {
    const key = getKey();
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf-8');
  } catch {
    // Decryption failed — return as-is (may be unencrypted legacy data)
    return encrypted;
  }
}
