import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../../src/memory/db.js";
import { runMigrations } from "../../../../src/memory/schema.js";
import { getDbMaxTimestamp } from "../../../../src/memory/signals/db-clock.js";

describe("getDbMaxTimestamp", () => {
  it("returns null on an empty DB", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-clock-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      expect(getDbMaxTimestamp(db)).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns the max commits.timestamp when commits exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-clock-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      const insert = db.prepare(
        `INSERT INTO commits (sha, parent_sha, author, timestamp, subject, is_fix, is_revert)
         VALUES (?, ?, ?, ?, ?, 0, 0)`
      );
      insert.run("a".repeat(40), null, "x", 1000, "early");
      insert.run("b".repeat(40), "a".repeat(40), "x", 2500, "late");
      expect(getDbMaxTimestamp(db)).toBe(2500);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
