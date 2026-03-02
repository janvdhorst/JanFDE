import Database from "better-sqlite3";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, "..", "data", "loads.db");

import { mkdirSync } from "fs";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS loads (
    load_id        TEXT PRIMARY KEY,
    origin         TEXT NOT NULL,
    destination    TEXT NOT NULL,
    pickup_datetime  TEXT NOT NULL,
    delivery_datetime TEXT NOT NULL,
    equipment_type TEXT NOT NULL,
    loadboard_rate REAL NOT NULL,
    notes          TEXT,
    weight         REAL,
    commodity_type TEXT,
    num_of_pieces  INTEGER,
    miles          REAL,
    dimensions     TEXT,
    lat            REAL,
    lng            REAL,
    status         TEXT NOT NULL DEFAULT 'available'
  );

  CREATE TABLE IF NOT EXISTS offers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    load_id        TEXT NOT NULL REFERENCES loads(load_id),
    mc_number      TEXT NOT NULL,
    carrier_name   TEXT,
    offered_rate   REAL NOT NULL,
    counter_rate   REAL,
    final_rate     REAL,
    status         TEXT NOT NULL DEFAULT 'pending',
    rounds         INTEGER DEFAULT 1,
    call_outcome   TEXT,
    carrier_sentiment TEXT,
    equipment_type TEXT,
    lanes_requested TEXT,
    key_objections TEXT,
    notes          TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (load_id) REFERENCES loads(load_id)
  );
`);

export default db;
