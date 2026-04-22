import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../../src/memory/db.js";
import { runMigrations } from "../../../../src/memory/schema.js";
import { computeHotspot } from "../../../../src/memory/signals/hotspot.js";

function seedCommit(
  db: ReturnType<typeof openDatabase>,
  sha: string,
  timestamp: number
) {
  db.prepare(
    `INSERT INTO commits (sha, parent_sha, author, timestamp, subject, is_fix, is_revert)
     VALUES (?, NULL, 'x', ?, 's', 0, 0)`
  ).run(sha, timestamp);
}

function seedTouch(
  db: ReturnType<typeof openDatabase>,
  sha: string,
  file: string
) {
  db.prepare(
    `INSERT INTO file_touches (commit_sha, file_path, adds, dels, change_type)
     VALUES (?, ?, 1, 0, 'M')`
  ).run(sha, file);
}

describe("computeHotspot — DB-relative time window", () => {
  it("counts touches in the 90 days before the DB's max commit, not wall-clock", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-hotspot-tt-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      // DB simulates a pre-break snapshot from 2018. Max commit at
      // 2018-06-01. Three touches on target file in the 90 days before.
      // Wall-clock "last 90 days" (2026-01-22 → now) excludes them all.
      const dbMax = Math.floor(new Date("2018-06-01").getTime() / 1000);
      const dayS = 86400;
      seedCommit(db, "a".repeat(40), dbMax - 80 * dayS);
      seedCommit(db, "b".repeat(40), dbMax - 40 * dayS);
      seedCommit(db, "c".repeat(40), dbMax - 10 * dayS);
      seedTouch(db, "a".repeat(40), "src/target.ts");
      seedTouch(db, "b".repeat(40), "src/target.ts");
      seedTouch(db, "c".repeat(40), "src/target.ts");

      const sig = computeHotspot(db, "src/target.ts");
      expect(sig.type).toBe("hotspot");
      expect(sig.touches_90d).toBe(3);
      expect(sig.strength).toBeCloseTo(3 / 30, 3);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns strength 0 when no commits are in the 90d window, regardless of wall clock", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-hotspot-tt-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      const dbMax = Math.floor(new Date("2018-06-01").getTime() / 1000);
      const dayS = 86400;
      // Seed a db-max anchor commit, then an old commit outside the window.
      seedCommit(db, "f".repeat(40), dbMax);
      seedCommit(db, "a".repeat(40), dbMax - 200 * dayS);
      seedTouch(db, "a".repeat(40), "src/target.ts");

      const sig = computeHotspot(db, "src/target.ts");
      expect(sig.touches_90d).toBe(0);
      expect(sig.strength).toBe(0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to wall-clock when DB is empty (no commits ingested yet)", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-hotspot-tt-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      const sig = computeHotspot(db, "src/target.ts");
      expect(sig.strength).toBe(0);
      expect(sig.touches_90d).toBe(0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
