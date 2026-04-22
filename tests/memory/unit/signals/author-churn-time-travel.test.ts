import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../../src/memory/db.js";
import { runMigrations } from "../../../../src/memory/schema.js";
import { computeAuthorChurn } from "../../../../src/memory/signals/author-churn.js";

function seedCommit(
  db: ReturnType<typeof openDatabase>,
  sha: string,
  author: string,
  timestamp: number
) {
  db.prepare(
    `INSERT INTO commits (sha, parent_sha, author, timestamp, subject, is_fix, is_revert)
     VALUES (?, NULL, ?, ?, 's', 0, 0)`
  ).run(sha, author, timestamp);
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

describe("computeAuthorChurn — DB-relative activity window", () => {
  it("returns strength 0 when the file's author has 5+ commits within the DB-relative 90d window", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-churn-tt-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      // Simulate 2018 snapshot. Author "active-dev" has 6 commits in the
      // 90d before db-max. Last touch of target.ts is the newest.
      const dbMax = Math.floor(new Date("2018-06-01").getTime() / 1000);
      const dayS = 86400;
      for (let i = 0; i < 6; i++) {
        const sha = i.toString().padStart(40, "0");
        seedCommit(db, sha, "active-dev", dbMax - i * 10 * dayS);
      }
      seedTouch(db, "0".padStart(40, "0"), "src/target.ts");

      const sig = computeAuthorChurn(db, "src/target.ts");
      expect(sig.strength).toBe(0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns strength 1.0 when the file's author has 0 commits within the DB-relative 90d window", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-churn-tt-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      const dbMax = Math.floor(new Date("2018-06-01").getTime() / 1000);
      const dayS = 86400;
      // Anchor the DB at dbMax, then the target file's author's only
      // commit is 200 days before dbMax — outside the DB-relative 90d
      // window.
      seedCommit(db, "f".repeat(40), "anchor-dev", dbMax);
      seedCommit(db, "a".repeat(40), "gone-dev", dbMax - 200 * dayS);
      seedTouch(db, "a".repeat(40), "src/target.ts");

      const sig = computeAuthorChurn(db, "src/target.ts");
      expect(sig.strength).toBe(1.0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns strength 0.5 when the file's author has 1-4 commits within the DB-relative 90d window", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-churn-tt-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      const dbMax = Math.floor(new Date("2018-06-01").getTime() / 1000);
      const dayS = 86400;
      seedCommit(db, "a".repeat(40), "slow-dev", dbMax - 10 * dayS);
      seedCommit(db, "b".repeat(40), "slow-dev", dbMax - 20 * dayS);
      seedTouch(db, "a".repeat(40), "src/target.ts");

      const sig = computeAuthorChurn(db, "src/target.ts");
      expect(sig.strength).toBe(0.5);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns strength 0 for files with no touches", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-churn-tt-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      const sig = computeAuthorChurn(db, "src/nonexistent.ts");
      expect(sig.strength).toBe(0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
