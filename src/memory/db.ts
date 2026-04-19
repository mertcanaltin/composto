import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export type { DB };
