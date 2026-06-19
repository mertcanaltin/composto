import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../../src/memory/db.js";
import { runMigrations } from "../../../../src/memory/schema.js";
import { computeCochange } from "../../../../src/memory/signals/cochange.js";

function seedCommit(
  db: ReturnType<typeof openDatabase>,
  sha: string,
  isFix: number,
  timestamp = 1_700_000_000
) {
  db.prepare(
    `INSERT INTO commits (sha, parent_sha, author, timestamp, subject, is_fix, is_revert)
     VALUES (?, NULL, 'x', ?, 's', ?, 0)`
  ).run(sha, timestamp, isFix);
}

function seedTouch(db: ReturnType<typeof openDatabase>, sha: string, file: string) {
  db.prepare(
    `INSERT INTO file_touches (commit_sha, file_path, adds, dels, change_type)
     VALUES (?, ?, 1, 0, 'M')`
  ).run(sha, file);
}

describe("computeCochange — fix co-change coupling", () => {
  it("counts distinct files co-touched with the target in fix commits", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-cochange-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      // Two fix commits couple target with {a,b} and {b,c} → distinct {a,b,c} = 3.
      seedCommit(db, "f".repeat(40), 1);
      seedTouch(db, "f".repeat(40), "src/target.ts");
      seedTouch(db, "f".repeat(40), "src/a.ts");
      seedTouch(db, "f".repeat(40), "src/b.ts");
      seedCommit(db, "g".repeat(40), 1);
      seedTouch(db, "g".repeat(40), "src/target.ts");
      seedTouch(db, "g".repeat(40), "src/b.ts");
      seedTouch(db, "g".repeat(40), "src/c.ts");
      // A NON-fix commit couples target with d — must NOT count.
      seedCommit(db, "a".repeat(40), 0);
      seedTouch(db, "a".repeat(40), "src/target.ts");
      seedTouch(db, "a".repeat(40), "src/d.ts");

      const sig = computeCochange(db, "src/target.ts");
      expect(sig.type).toBe("cochange");
      expect(sig.cochange_degree).toBe(3);
      expect(sig.strength).toBeCloseTo(3 / 10, 3);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns strength 0 when the file has no fix co-change", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-cochange-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      // Only a non-fix commit, and a solo fix commit (no co-touched files).
      seedCommit(db, "a".repeat(40), 0);
      seedTouch(db, "a".repeat(40), "src/target.ts");
      seedTouch(db, "a".repeat(40), "src/other.ts");
      seedCommit(db, "f".repeat(40), 1);
      seedTouch(db, "f".repeat(40), "src/target.ts");

      const sig = computeCochange(db, "src/target.ts");
      expect(sig.cochange_degree).toBe(0);
      expect(sig.strength).toBe(0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saturates strength at 1.0 for highly coupled hub files", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-cochange-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      seedCommit(db, "f".repeat(40), 1);
      seedTouch(db, "f".repeat(40), "src/hub.ts");
      for (let i = 0; i < 15; i++) seedTouch(db, "f".repeat(40), `src/dep${i}.ts`);

      const sig = computeCochange(db, "src/hub.ts");
      expect(sig.cochange_degree).toBe(15);
      expect(sig.strength).toBe(1.0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
