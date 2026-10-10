import { DatabaseSync } from "node:sqlite";
import { MACHINES, REASON_CODES } from "./config.ts";

export type DB = DatabaseSync;

export function openDb(file: string): DB {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'unknown',
      state_since INTEGER, reason_code TEXT,
      cycles INTEGER NOT NULL DEFAULT 0,
      temperature REAL, first_seen INTEGER, last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS reason_codes (code TEXT PRIMARY KEY, label TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
      machine_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_events_machine_ts ON events(machine_id, ts);
    CREATE TABLE IF NOT EXISTS downtimes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, machine_id TEXT NOT NULL,
      start_ts INTEGER NOT NULL, end_ts INTEGER, reason_code TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      downtime_id INTEGER NOT NULL UNIQUE, machine_id TEXT NOT NULL,
      raised_ts INTEGER NOT NULL, acked_by TEXT, acked_ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
      who TEXT NOT NULL, action TEXT NOT NULL, detail TEXT
    );
  `);
  const m = db.prepare("INSERT OR IGNORE INTO machines (id, name) VALUES (?, ?)");
  for (const x of MACHINES) m.run(x.id, x.name);
  const r = db.prepare("INSERT OR REPLACE INTO reason_codes (code, label) VALUES (?, ?)");
  for (const x of REASON_CODES) r.run(x.code, x.label);
  return db;
}
