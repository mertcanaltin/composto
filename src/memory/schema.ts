import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DB } from "./db.js";

const CURRENT_VERSION = 1;

function migrationPath(version: number): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const name = `${String(version).padStart(3, "0")}-initial.sql`;
  return join(here, "migrations", name);
}

export function runMigrations(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current >= CURRENT_VERSION) return;

  for (let v = current + 1; v <= CURRENT_VERSION; v++) {
    const sql = readFileSync(migrationPath(v), "utf-8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.pragma(`user_version = ${v}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
