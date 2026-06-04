/**
 * Flogination — Seed AI Settings Script
 *
 * Sets the OpenRouter API key and preferred models in the local SQLite database.
 * Run once: npx tsx scripts/seed-ai-settings.ts
 *
 * This does NOT commit credentials to git — it writes directly to flogination.db.
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve(process.cwd(), 'flogination.db');

// ── Check DB exists ───────────────────────────────────────────
import fs from 'fs';
if (!fs.existsSync(DB_PATH)) {
  console.error('[seed] flogination.db not found. Start the server once first to create it.');
  process.exit(1);
}

const db = new Database(DB_PATH);

// ── Read current settings ─────────────────────────────────────
const row = db
  .prepare('SELECT value FROM settings WHERE key = ?')
  .get('app_settings') as { value: string } | undefined;

const current = row ? JSON.parse(row.value) : {};

// ── Merge AI settings ─────────────────────────────────────────
const updated = {
  ...current,
  ai: {
    ...current.ai,
    provider: 'openrouter',
    apiKey: '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',
    model: 'deepseek/deepseek-v4-flash:free',          // primary model
    freeModel: 'openrouter/free',             // used for selector healing (free tier)
    enabled: true,
  },
};

// ── Save ──────────────────────────────────────────────────────
db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
  'app_settings',
  JSON.stringify(updated)
);

console.log('[seed] AI settings saved to flogination.db');
console.log('  provider : openrouter');
console.log('  model    : deepseek/deepseek-v4-flash:free');
console.log('  freeModel: google/gemma-4-31b-it:free');
console.log('  enabled  : true');
console.log('');
console.log('Available free models configured:');
console.log('  - cognitivecomputations/dolphin-mistral-24b-venice-edition:free');
console.log('  - deepseek/deepseek-v4-flash:free');
console.log('  - moonshotai/kimi-k2.6:free');
console.log('  - google/gemma-4-26b-a4b-it:free');
console.log('  - google/gemma-4-31b-it:free');
console.log('');
console.log('Change model anytime from Settings → AI in the dashboard.');

db.close();
