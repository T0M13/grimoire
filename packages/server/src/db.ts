import fs from "node:fs";
import Database from "better-sqlite3";
import type { PublicState, SaveMeta } from "@grimoire/shared";
import type { ChatMessage } from "./ollama.js";
import { DB_PATH, VAR_DIR } from "./config.js";

fs.mkdirSync(VAR_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS campaign (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state_json TEXT NOT NULL,
    history_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    who TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS saves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    state_json TEXT NOT NULL,
    history_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const saveStmt = db.prepare(
  `INSERT INTO campaign (id, state_json, history_json, updated_at)
   VALUES (1, ?, ?, datetime('now'))
   ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,
     history_json=excluded.history_json, updated_at=excluded.updated_at`,
);
const loadStmt = db.prepare(`SELECT state_json, history_json FROM campaign WHERE id = 1`);
const eventStmt = db.prepare(`INSERT INTO events (ts, who, text) VALUES (datetime('now'), ?, ?)`);

/** Write-through save: called after every resolved action. Crash-safe by design. */
export function saveCampaign(state: PublicState, history: ChatMessage[]): void {
  saveStmt.run(JSON.stringify(state), JSON.stringify(history));
}

export function loadCampaign(): { state: PublicState; history: ChatMessage[] } | null {
  const row = loadStmt.get() as { state_json: string; history_json: string } | undefined;
  if (!row) return null;
  return { state: JSON.parse(row.state_json), history: JSON.parse(row.history_json) };
}

export function logEvent(who: string, text: string): void {
  eventStmt.run(who, text);
}

// ---------- named save slots (all local to the host) ----------

const slotInsert = db.prepare(`INSERT INTO saves (name, state_json, history_json, created_at) VALUES (?, ?, ?, datetime('now'))`);
const slotList = db.prepare(`SELECT id, name, created_at FROM saves ORDER BY id DESC`);
const slotGet = db.prepare(`SELECT state_json, history_json FROM saves WHERE id = ?`);
const slotDelete = db.prepare(`DELETE FROM saves WHERE id = ?`);

export function listSaves(): SaveMeta[] {
  return (slotList.all() as { id: number; name: string; created_at: string }[])
    .map(r => ({ id: r.id, name: r.name, savedAt: r.created_at }));
}

export function saveSlot(name: string, state: PublicState, history: ChatMessage[]): void {
  slotInsert.run(name, JSON.stringify(state), JSON.stringify(history));
}

export function loadSlot(id: number): { state: PublicState; history: ChatMessage[] } | null {
  const row = slotGet.get(id) as { state_json: string; history_json: string } | undefined;
  if (!row) return null;
  return { state: JSON.parse(row.state_json), history: JSON.parse(row.history_json) };
}

export function deleteSlot(id: number): void {
  slotDelete.run(id);
}
