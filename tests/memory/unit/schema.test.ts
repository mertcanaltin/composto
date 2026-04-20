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
    expect(userVersion).toBe(2);

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

  it("is idempotent: running migrations twice leaves version at CURRENT_VERSION", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-memory-"));
    const dbPath = join(dir, "memory.db");

    const db = openDatabase(dbPath);
    runMigrations(db);
    runMigrations(db);
    expect(db.pragma("user_version", { simple: true })).toBe(2);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("upgrades a v1 database to v2 (adds idx_ft_file_commit)", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-memory-"));
    const dbPath = join(dir, "memory.db");

    // Simulate an existing v1 DB by setting user_version manually after the
    // fresh creation, then re-running migrations to confirm v2 picks up.
    const db = openDatabase(dbPath);
    runMigrations(db);
    db.pragma("user_version = 1");
    db.exec("DROP INDEX IF EXISTS idx_ft_file_commit");
    runMigrations(db);

    expect(db.pragma("user_version", { simple: true })).toBe(2);
    const indices = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ft_file_commit'")
      .all();
    expect(indices.length).toBe(1);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
