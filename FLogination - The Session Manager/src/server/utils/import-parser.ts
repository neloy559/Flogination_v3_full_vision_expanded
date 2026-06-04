/**
 * Flogination V5 — Import Parser
 *
 * Parses bulk session import files (.xlsx, .csv) and newline-separated
 * cookie paste inputs into structured session data.
 *
 * Supported input formats:
 *
 * 1. Newline-separated cookies (simplest):
 *    cookie1value
 *    cookie2value
 *
 * 2. CSV file with headers:
 *    cookie,uid,password,twoFactorSecret,email,phoneNumber
 *    c_user=123;xs=abc,...,123456789,mypass,JBSWY3DP,...
 *
 * 3. XLSX file with the same column headers as CSV.
 *
 * Column header matching is case-insensitive and supports common aliases:
 *    cookie / cookies
 *    uid / facebook_id / fb_id
 *    password / pass
 *    two_factor_secret / 2fa_secret / totp_secret
 *    email
 *    phone / phone_number
 */

import * as XLSX from 'xlsx';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** A parsed session row ready for database insertion. */
export interface ParsedRow {
  cookie: string;
  uid?: string;
  password?: string;
  twoFactorSecret?: string;
  email?: string;
  phoneNumber?: string;
}

/** A per-row parse error with row number and human-readable reason. */
export interface ParseError {
  row: number;
  reason: string;
}

/** Result of parsing a bulk import source. */
export interface ParseResult {
  rows: ParsedRow[];
  errors: ParseError[];
}

// Keep backward-compatible alias for existing callers
/** @deprecated Use ParsedRow instead. */
export type ParsedSessionRow = ParsedRow;

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Minimum cookie string length to be considered valid. */
const MIN_COOKIE_LENGTH = 10;

/** Known Facebook cookie key names used for validation heuristics. */
const FB_COOKIE_KEYS = ['c_user', 'xs', 'datr', 'sb', 'fr'] as const;

/** Minimum number of key=value pairs required for fallback cookie validation. */
const MIN_COOKIE_PAIRS = 2;

// ─────────────────────────────────────────────
// COLUMN ALIASES
// ─────────────────────────────────────────────

/**
 * Maps normalized column names to their accepted aliases (all lowercase,
 * spaces/underscores/hyphens stripped for comparison).
 *
 * Task-required aliases are listed first; additional common aliases follow.
 */
const COLUMN_ALIASES: Record<keyof ParsedRow, string[]> = {
  cookie:          ['cookie', 'cookies', 'sessioncookie', 'rawcookie', 'session', 'fbcookie'],
  uid:             ['uid', 'facebookid', 'fbid', 'userid', 'fbuid', 'cuser', 'id'],
  password:        ['password', 'pass', 'pwd', 'fbpassword'],
  twoFactorSecret: ['twofactorsecret', '2fasecret', 'totpsecret', '2fa', 'totp', 'twofactor', 'secret', 'otpsecret'],
  email:           ['email', 'mail', 'emailaddress', 'fbemail'],
  phoneNumber:     ['phonenumber', 'phone', 'mobile', 'tel'],
};

// ─────────────────────────────────────────────
// NEWLINE-SEPARATED COOKIE PASTE
// ─────────────────────────────────────────────

/**
 * Parses a newline-separated paste of cookie strings.
 * Supports multiple formats:
 * - "UID Password c_user=...cookie..." (one per line)
 * - "c_user=...;c_user=...;" (concatenated, no prefix)
 * - Plain "c_user=...;" per line
 *
 * @param text - The pasted text content from the import textarea.
 * @param existingCookies - Optional array of cookies already in the DB for duplicate detection.
 * @returns A ParseResult with one row per valid cookie line.
 */
function parsePastedCookies(text: string, existingCookies: string[] = []): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];

  if (!text || text.trim().length === 0) return { rows, errors };

  const rawText = text.trim();
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  // Detect format A: lines starting with "UID Password c_user=..."
  const isFormatA = lines.some(l => /^\d{10,}\s+\S+\s*c_user=/.test(l));

  let entries: { uid?: string; password?: string; cookie: string }[] = [];

  if (isFormatA) {
    // Format A: each line = "UID Password c_user=...cookie..."
    for (const line of lines) {
      const cUserIdx = line.indexOf('c_user=');
      if (cUserIdx === -1) continue;
      const prefix = line.slice(0, cUserIdx).trim();
      const cookie = line.slice(cUserIdx);
      const parts = prefix.split(/\s+/);
      const uid = (parts.length >= 2 && /^\d{10,}$/.test(parts[0])) ? parts[0] : undefined;
      const password = (uid && parts.length >= 2) ? parts[1] : undefined;
      entries.push({ uid, password, cookie });
    }
  } else {
    // Format B/C: split on c_user= boundaries (concatenated or per-line)
    const flat = rawText.replace(/\n/g, '').replace(/\r/g, '');
    if (flat.includes('c_user=')) {
      const parts = flat.split(/(?=c_user=)/).map(s => s.replace(/^[;\s]+/, '').trim()).filter(s => s.includes('c_user='));
      for (const part of parts) {
        const uidMatch = part.match(/c_user=(\d+)/);
        entries.push({ uid: uidMatch?.[1], cookie: part });
      }
    } else {
      // Fallback: one cookie per line
      for (const line of lines) {
        if (line.startsWith('#') || line.startsWith('//')) continue;
        entries.push({ cookie: line });
      }
    }
  }

  entries.forEach(({ uid, password, cookie }, index) => {
    const rowNum = index + 1;

    if (!isValidCookie(cookie)) {
      errors.push({ row: rowNum, reason: `Row ${rowNum}: Does not look like a valid cookie string` });
      return;
    }

    if (isDuplicateCookie(cookie, existingCookies)) {
      errors.push({ row: rowNum, reason: `Row ${rowNum}: Cookie already exists in the database` });
      return;
    }

    rows.push({ cookie, uid, password });
  });

  return { rows, errors };
}

// ─────────────────────────────────────────────
// CSV PARSER
// ─────────────────────────────────────────────

/**
 * Parses a CSV file buffer into session rows.
 * Expects the first row to be column headers.
 * Column matching is case-insensitive and supports aliases.
 * Validates that each row has a non-empty cookie field.
 * Detects duplicate cookies against the provided existing cookie list.
 *
 * @param buffer - The raw file buffer from a CSV upload.
 * @param existingCookies - Optional array of cookies already in the DB for duplicate detection.
 * @returns A ParseResult with one row per valid data row.
 *
 * @example
 * const existing = db_.getSessions().map(s => s.cookie)
 * parseCSV(fs.readFileSync('sessions.csv'), existing)
 */
function parseCSV(buffer: Buffer, existingCookies: string[] = []): ParseResult {
  const text = buffer.toString('utf-8');
  const workbook = XLSX.read(text, { type: 'string' });
  return parseWorkbook(workbook, existingCookies);
}

// ─────────────────────────────────────────────
// XLSX PARSER
// ─────────────────────────────────────────────

/**
 * Parses an XLSX file buffer into session rows.
 * Uses the first sheet. Expects the first row to be column headers.
 * Validates that each row has a non-empty cookie field.
 * Detects duplicate cookies against the provided existing cookie list.
 *
 * @param buffer - The raw file buffer from an XLSX upload.
 * @param existingCookies - Optional array of cookies already in the DB for duplicate detection.
 * @returns A ParseResult with one row per valid data row.
 *
 * @example
 * const existing = db_.getSessions().map(s => s.cookie)
 * parseXLSX(fs.readFileSync('sessions.xlsx'), existing)
 */
function parseXLSX(buffer: Buffer, existingCookies: string[] = []): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return parseWorkbook(workbook, existingCookies);
}

// ─────────────────────────────────────────────
// SHARED WORKBOOK PARSER
// ─────────────────────────────────────────────

/**
 * Parses an XLSX workbook (used by both CSV and XLSX parsers).
 * Reads the first sheet, maps column headers to field names,
 * validates each row, checks for duplicates, and returns structured session data.
 *
 * @param workbook - The parsed XLSX workbook object.
 * @param existingCookies - Array of cookies already in the DB for duplicate detection.
 * @returns A ParseResult with valid rows and per-row errors.
 */
function parseWorkbook(workbook: XLSX.WorkBook, existingCookies: string[]): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: [{ row: 0, reason: 'File is empty or has no sheets' }] };
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: '',
    raw: false,
  });

  if (rawRows.length === 0) {
    return { rows: [], errors: [{ row: 0, reason: 'Sheet has no data rows' }] };
  }

  // Build column mapping from the first row's keys
  const columnMap = buildColumnMap(Object.keys(rawRows[0]));

  rawRows.forEach((rawRow, index) => {
    const rowNum = index + 2; // +2 because row 1 is headers, data starts at row 2

    const parsed = mapRow(rawRow, columnMap);

    if (!parsed.cookie || !isValidCookie(parsed.cookie)) {
      errors.push({
        row: rowNum,
        reason: `Row ${rowNum}: Missing or invalid cookie value`,
      });
      return;
    }

    if (isDuplicateCookie(parsed.cookie, existingCookies)) {
      errors.push({
        row: rowNum,
        reason: `Row ${rowNum}: Cookie already exists in the database`,
      });
      return;
    }

    rows.push(parsed);
  });

  return { rows, errors };
}

// ─────────────────────────────────────────────
// COLUMN MAPPING
// ─────────────────────────────────────────────

/**
 * Builds a mapping from raw column header names to normalized field names.
 * Matching is case-insensitive and strips spaces/underscores/hyphens for comparison.
 *
 * @param headers - The raw column header strings from the file.
 * @returns A map from raw header → normalized field name.
 *
 * @example
 * buildColumnMap(['Cookie', 'facebook_id', 'Pass', '2fa_secret'])
 * // → { 'Cookie': 'cookie', 'facebook_id': 'uid', 'Pass': 'password', '2fa_secret': 'twoFactorSecret' }
 */
function buildColumnMap(headers: string[]): Record<string, keyof ParsedRow> {
  const map: Record<string, keyof ParsedRow> = {};

  for (const header of headers) {
    const normalized = header.toLowerCase().replace(/[\s_-]/g, '');

    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(normalized)) {
        map[header] = field as keyof ParsedRow;
        break;
      }
    }
  }

  return map;
}

/**
 * Maps a raw spreadsheet row to a ParsedRow using the column map.
 *
 * @param rawRow - The raw row object from XLSX.utils.sheet_to_json.
 * @param colMap - The column mapping built by buildColumnMap.
 * @returns A ParsedRow with mapped values (cookie defaults to empty string).
 */
function mapRow(
  rawRow: Record<string, string>,
  colMap: Record<string, keyof ParsedRow>
): ParsedRow {
  const result: ParsedRow = { cookie: '' };

  for (const [header, field] of Object.entries(colMap)) {
    const value = rawRow[header]?.trim();
    if (value && value.length > 0) {
      (result as unknown as Record<string, string>)[field] = value;
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────

/**
 * Validates that a string looks like a Facebook cookie.
 * A valid cookie must contain at least one key=value pair
 * and ideally contain known Facebook cookie keys.
 * Handles URL-encoded cookie strings automatically.
 *
 * @param cookie - The cookie string to validate.
 * @returns True if the string appears to be a valid cookie.
 */
function isValidCookie(cookie: string): boolean {
  if (!cookie || cookie.trim().length < MIN_COOKIE_LENGTH) return false;

  // Decode URL-encoded cookies before validation
  let decoded = cookie;
  try {
    if (cookie.includes('%')) {
      decoded = decodeURIComponent(cookie.replace(/\+/g, ' '));
    }
  } catch { /* malformed encoding — use original */ }

  // Must contain at least one key=value pair
  if (!decoded.includes('=')) return false;

  // Bonus check: contains known Facebook cookie keys
  const hasFbKey = FB_COOKIE_KEYS.some((key) => decoded.includes(key));

  // Accept if it has FB keys, or if it's a JSON array (some tools export this way)
  if (hasFbKey) return true;
  if (decoded.trim().startsWith('[') && decoded.includes('"name"')) return true;

  // Accept any string with multiple key=value pairs as a fallback
  const pairs = decoded.split(';').filter((p) => p.includes('='));
  return pairs.length >= MIN_COOKIE_PAIRS;
}

/**
 * Checks if an existing cookie string is already in the provided list.
 * Used to detect duplicates during bulk import.
 *
 * @param cookie - The cookie string to check.
 * @param existing - Array of existing session cookies (e.g. from db_.getSessions().map(s => s.cookie)).
 * @returns True if the cookie already exists.
 *
 * @example
 * const existingCookies = db_.getSessions().map(s => s.cookie)
 * isDuplicateCookie('c_user=123;xs=abc', existingCookies) // → false if not in DB
 */
function isDuplicateCookie(cookie: string, existing: string[]): boolean {
  const normalized = cookie.trim();
  return existing.some((c) => c.trim() === normalized);
}

// ─────────────────────────────────────────────
// BULK IMPORT ORCHESTRATOR
// ─────────────────────────────────────────────

/**
 * Processes a bulk import from any supported source.
 * Deduplicates against the provided existing cookie list.
 * Returns a summary of imported, failed, and duplicate rows.
 *
 * @param source - Either a Buffer (file) or string (pasted text).
 * @param format - 'csv', 'xlsx', or 'text' (newline-separated cookies).
 * @param existingCookies - Optional array of cookies already in the DB for duplicate detection.
 * @returns A ParseResult with valid rows and per-row errors.
 *
 * @example
 * const existing = db_.getSessions().map(s => s.cookie)
 * const result = importParser.process(fileBuffer, 'xlsx', existing)
 * // → { rows: [...], errors: [{row: 3, reason: '...'}] }
 */
function process(
  source: Buffer | string,
  format: 'csv' | 'xlsx' | 'text',
  existingCookies: string[] = []
): ParseResult {
  switch (format) {
    case 'csv':
      return parseCSV(source as Buffer, existingCookies);
    case 'xlsx':
      return parseXLSX(source as Buffer, existingCookies);
    case 'text':
      return parsePastedCookies(source as string, existingCookies);
    default:
      return { rows: [], errors: [{ row: 0, reason: `Unknown format: ${format as string}` }] };
  }
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The import parser for bulk session imports.
 * Supports CSV, XLSX, and newline-separated cookie paste formats.
 * All parse functions accept an optional existingCookies array for
 * duplicate detection — pass db_.getSessions().map(s => s.cookie) from the caller.
 *
 * @example
 * import { importParser } from '../utils/import-parser'
 *
 * // From file upload with duplicate detection:
 * const existingCookies = db_.getSessions().map(s => s.cookie)
 * const result = importParser.parseXLSX(req.file.buffer, existingCookies)
 *
 * // From textarea paste:
 * const result = importParser.parsePastedCookies(req.body.cookies, existingCookies)
 *
 * // Using the unified process() method:
 * const result = importParser.process(req.file.buffer, 'csv', existingCookies)
 */
export const importParser = {
  /** Parses a newline-separated cookie paste. */
  parsePastedCookies,
  /** Parses a CSV file buffer. */
  parseCSV,
  /** Parses an XLSX file buffer. */
  parseXLSX,
  /** Processes any supported format. */
  process,
  /** Checks if a cookie already exists in the provided list. */
  isDuplicateCookie,
  /** Validates that a string looks like a Facebook cookie. */
  isValidCookie,
};
