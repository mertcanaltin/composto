import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";

describe("memory schema migrations", () => {
  it("creates all tables at version 1 on a fresh DB", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-memory-"));
    const dbPath = join(dir, "memory.db");

    const db = openDatabase(dbPath);
    runMigrations(db);

    const userVersion = db.pragma("user_version", { simple: true }) as number;
    expect(userVersion).toBe(1);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "commits",
        "file_touches",
        "file_index_state",
        "fix_links",
        "index_state",
        "signal_calibration",
        "symbol_touches",
        "symbols",
      ])
    );

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("is idempotent: running migrations twice leaves version at 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-memory-"));
    const dbPath = join(dir, "memory.db");

    const db = openDatabase(dbPath);
    runMigrations(db);
    runMigrations(db);
    expect(db.pragma("user_version", { simple: true })).toBe(1);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
