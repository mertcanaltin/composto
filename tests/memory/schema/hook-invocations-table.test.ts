import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";

// Phase 1 P1.4: verifies the hook_invocations table (v3 migration) exists
// after runMigrations and that INSERT/SELECT round-trips cleanly. If this
// fails, the telemetry layer can't persist anything.

describe("schema v3: hook_invocations table", () => {
  it("creates hook_invocations with the expected column set", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-hi-schema-"));
    const dbPath = join(dir, "memory.db");
    const db = openDatabase(dbPath);
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hook_invocations'")
      .all();
    expect(tables.length).toBe(1);

    // Verify all expected columns are present.
    const cols = db
      .prepare("PRAGMA table_info(hook_invocations)")
      .all()
      .map((r: any) => r.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "timestamp",
        "platform",
        "event",
        "file_path",
        "verdict",
        "score",
        "confidence",
        "latency_ms",
        "cache_hit",
      ]),
    );

    // Index on timestamp for stats windowing.
    const indices = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_hi_timestamp'")
      .all();
    expect(indices.length).toBe(1);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("supports INSERT + SELECT round-trip on hook_invocations", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-hi-roundtrip-"));
    const dbPath = join(dir, "memory.db");
    const db = openDatabase(dbPath);
    runMigrations(db);

    db.prepare(
      `INSERT INTO hook_invocations
         (timestamp, platform, event, file_path, verdict, score, confidence, latency_ms, cache_hit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(1700000000, "claude-code", "pretooluse", "src/a.ts", "high", 0.9, 0.6, 42, 0);

    const row = db
      .prepare("SELECT platform, event, file_path, verdict, latency_ms FROM hook_invocations WHERE id = 1")
      .get() as any;

    expect(row).toEqual({
      platform: "claude-code",
      event: "pretooluse",
      file_path: "src/a.ts",
      verdict: "high",
      latency_ms: 42,
    });

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("allows NULL for file_path, verdict, score, confidence (passthrough rows)", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-hi-null-"));
    const dbPath = join(dir, "memory.db");
    const db = openDatabase(dbPath);
    runMigrations(db);

    db.prepare(
      `INSERT INTO hook_invocations
         (timestamp, platform, event, file_path, verdict, score, confidence, latency_ms, cache_hit)
       VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    ).run(1700000000, "cursor", "pretooluse", 5, 0);

    const row = db
      .prepare("SELECT file_path, verdict, score, confidence FROM hook_invocations WHERE id = 1")
      .get() as any;
    expect(row.file_path).toBeNull();
    expect(row.verdict).toBeNull();
    expect(row.score).toBeNull();
    expect(row.confidence).toBeNull();

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
