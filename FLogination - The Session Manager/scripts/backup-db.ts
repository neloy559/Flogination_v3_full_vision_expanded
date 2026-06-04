/**
 * Flogination V5 — Database Backup Script
 *
 * Copies flogination.db to backups/flogination-{timestamp}.db
 * Keeps the last 7 backups, deletes older ones.
 *
 * Usage: npm run backup
 */

import fs from 'fs';
import path from 'path';

const DB_PATH     = path.resolve(process.cwd(), 'flogination.db');
const BACKUP_DIR  = path.resolve(process.cwd(), 'backups');
const MAX_BACKUPS = 7;

function run(): void {
  if (!fs.existsSync(DB_PATH)) {
    console.error('[backup] flogination.db not found — nothing to backup');
    process.exit(1);
  }

  // Ensure backup directory exists
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Create timestamped backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(BACKUP_DIR, `flogination-${timestamp}.db`);
  fs.copyFileSync(DB_PATH, backupPath);
  console.log(`[backup] Created: ${backupPath}`);

  // List all backups sorted oldest first
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('flogination-') && f.endsWith('.db'))
    .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => a.time - b.time);

  // Delete oldest backups beyond MAX_BACKUPS
  const toDelete = backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS));
  for (const backup of toDelete) {
    fs.unlinkSync(path.join(BACKUP_DIR, backup.name));
    console.log(`[backup] Deleted old backup: ${backup.name}`);
  }

  console.log(`[backup] Done. ${Math.min(backups.length, MAX_BACKUPS)} backups retained.`);
}

run();
