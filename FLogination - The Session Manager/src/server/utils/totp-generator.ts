/**
 * Flogination V5 — TOTP Generator
 *
 * Generates Time-based One-Time Passwords (TOTP) from stored 2FA secrets.
 * Implements RFC 6238 using Node.js built-in `crypto` — no external dependencies.
 *
 * Compatible with Google Authenticator, Facebook 2FA, and any RFC 6238 app.
 * Algorithm: HMAC-SHA1, 30-second time step, 6-digit codes.
 *
 * Used by the auto-scraper, session manager, and all automation tools
 * whenever a Facebook 2FA prompt is detected during browser navigation.
 */

import { createHmac } from 'crypto';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** TOTP time step in seconds (RFC 6238 standard). */
const TOTP_STEP_SECONDS = 30;

/** Number of digits in the generated OTP code. */
const TOTP_DIGITS = 6;

/**
 * Minimum seconds remaining in the current TOTP window before waitAndRetry
 * decides to skip ahead to the next window. If fewer than this many seconds
 * remain, the code is too close to expiry to submit safely.
 */
const MIN_REMAINING_SECONDS = 5;

// ─────────────────────────────────────────────
// BASE32 DECODER
// ─────────────────────────────────────────────

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decodes a base32-encoded string to a Buffer.
 * Facebook 2FA secrets are stored in base32 format.
 *
 * @param base32 - The base32 string to decode (case-insensitive, padding optional).
 * @returns A Buffer containing the decoded bytes.
 * @throws If the input contains invalid base32 characters.
 */
function base32Decode(base32: string): Buffer {
  const input = base32.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of input) {
    const index = BASE32_CHARS.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: "${char}"`);
    }
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

// ─────────────────────────────────────────────
// CORE TOTP ALGORITHM (RFC 6238)
// ─────────────────────────────────────────────

/**
 * Computes a TOTP code for a given secret and Unix timestamp.
 * Implements RFC 6238 with HMAC-SHA1, 30-second steps, and 6-digit output.
 *
 * @param secretBase32 - The base32-encoded TOTP secret.
 * @param timestampMs  - Unix timestamp in milliseconds (defaults to now).
 * @returns A zero-padded 6-digit OTP string, e.g. "048291".
 */
function computeTOTP(secretBase32: string, timestampMs: number = Date.now()): string {
  const key = base32Decode(secretBase32.trim().toUpperCase());

  // Time counter: number of 30-second windows since Unix epoch
  const counter = Math.floor(timestampMs / 1000 / TOTP_STEP_SECONDS);

  // Encode counter as 8-byte big-endian buffer
  const counterBuffer = Buffer.alloc(8);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  counterBuffer.writeUInt32BE(high, 0);
  counterBuffer.writeUInt32BE(low, 4);

  // HMAC-SHA1
  const hmac = createHmac('sha1', key);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  // Dynamic truncation
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  // Modulo to get N digits, zero-padded
  const otp = code % Math.pow(10, TOTP_DIGITS);
  return otp.toString().padStart(TOTP_DIGITS, '0');
}

// ─────────────────────────────────────────────
// PUBLIC FUNCTIONS
// ─────────────────────────────────────────────

/**
 * Generates the current TOTP code from a base32-encoded 2FA secret.
 *
 * @param secret - The base32-encoded TOTP secret stored in the session record.
 * @returns A 6-digit TOTP code string, e.g. "482931".
 * @throws If the secret is empty or contains invalid base32 characters.
 *
 * @example
 * const code = generate('JBSWY3DPEHPK3PXP')
 * // → "482931"  (varies by current time)
 */
function generate(secret: string): string {
  if (!secret || secret.trim().length === 0) {
    throw new Error('TOTP secret is empty — cannot generate code');
  }
  return computeTOTP(secret);
}

/**
 * Returns the number of milliseconds remaining in the current TOTP window.
 *
 * @returns Milliseconds until the current TOTP code expires (0–30000).
 */
function msUntilNextWindow(): number {
  const nowMs = Date.now();
  const windowStartMs = Math.floor(nowMs / (TOTP_STEP_SECONDS * 1000)) * (TOTP_STEP_SECONDS * 1000);
  return TOTP_STEP_SECONDS * 1000 - (nowMs - windowStartMs);
}

/**
 * Waits for the next TOTP 30-second window, then generates a fresh code.
 *
 * If the current window has fewer than MIN_REMAINING_SECONDS (5s) left,
 * waits until the next window starts before returning a code. This avoids
 * submitting a code that expires before Facebook can validate it.
 *
 * @param secret - The base32-encoded TOTP secret.
 * @returns A Promise that resolves to a fresh 6-digit TOTP code.
 *
 * @example
 * // Current window has < 5s left — waits for next window automatically
 * const freshCode = await waitAndRetry('JBSWY3DPEHPK3PXP')
 * // → "739201"  (new code from next 30s window)
 */
async function waitAndRetry(secret: string): Promise<string> {
  const remainingMs = msUntilNextWindow();
  const remainingSeconds = remainingMs / 1000;

  // If fewer than MIN_REMAINING_SECONDS remain, the current code is too close
  // to expiry — wait until the next window begins before generating.
  if (remainingSeconds < MIN_REMAINING_SECONDS) {
    await sleep(remainingMs + 500); // +500ms safety margin for clock drift
  }

  return generate(secret);
}

/**
 * Validates that a secret string is structurally valid base32.
 * Use this when importing sessions to warn about bad 2FA secrets early.
 *
 * @param secret - The secret string to validate.
 * @returns True if the secret is non-empty and contains only valid base32 characters.
 *
 * @example
 * isValidSecret('JBSWY3DPEHPK3PXP') // → true
 * isValidSecret('')                  // → false
 * isValidSecret('not-base32!')       // → false
 */
function isValidSecret(secret: string): boolean {
  if (!secret || secret.trim().length === 0) return false;
  try {
    base32Decode(secret.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns a Promise that resolves after the specified number of milliseconds.
 * Internal utility — not exported.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The TOTP generator for handling Facebook 2FA prompts.
 * Uses Node.js built-in `crypto` — no external dependencies.
 *
 * @example
 * import { totpGenerator } from '../utils/totp-generator'
 *
 * // In auto-scraper or session launch flow:
 * if (session.twoFactorSecret && page.url().includes('two_step')) {
 *   const code = totpGenerator.generate(session.twoFactorSecret)
 *   await page.fill('[name="approvals_code"]', code)
 * }
 */
export const totpGenerator = {
  /** Generates the current TOTP code from a base32 secret. */
  generate,
  /** Waits for the next 30-second window and returns a fresh code. */
  waitAndRetry,
  /** Validates that a secret is structurally valid base32. */
  isValidSecret,
  /** Returns milliseconds until the current TOTP window expires. */
  msUntilNextWindow,
};
