import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'data'), { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || join(root, 'data', 'farmacopea.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    created TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drugs (
    id INTEGER PRIMARY KEY,
    set_id TEXT UNIQUE,
    generic TEXT NOT NULL,
    brands TEXT NOT NULL DEFAULT '[]',
    substances TEXT NOT NULL DEFAULT '[]',
    pharm_class TEXT NOT NULL DEFAULT '[]',
    routes TEXT NOT NULL DEFAULT '[]',
    manufacturer TEXT,
    rxcui TEXT,
    effective_time TEXT,
    fetched TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS drugs_generic ON drugs(generic COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS sections (
    drug_id INTEGER NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    ord INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (drug_id, key)
  );

  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drug_id INTEGER NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, drug_id)
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drug_id INTEGER NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
    ts TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
