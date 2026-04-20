import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { deriveFixLinks } from "../../../src/memory/ingest/fix-links.js";

// Perf characterization for deriveFixLinks. The function previously took
// O(fixes × files-with-fixes × prior-touches) per insert with each insert
// running as its own auto-commit transaction. On large repos (10K+ commits,
// 30% fix rate) this would not complete in any practical time. After the
// batching/index fix, this synthetic benchmark must complete well under the
// asserted budget.
describe("deriveFixLinks — perf at scale", () => {
  let dbDir: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "composto-flperf-"));
  });

  afterEach(() => {
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("processes 10K commits / 50K touches in under 5 seconds", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);

    // Seed: 10,000 commits, ~30% fixes, ~5 file_touches each across 200 files.
    const COMMITS = 10_000;
    const FILES = 200;
    const TOUCHES_PER_COMMIT = 5;
    const FIX_RATIO = 0.3;
    const baseTs = 1_700_000_000;

    const insertCommit = db.prepare(
      `INSERT INTO commits (sha, parent_sha, author, timestamp, subject, is_fix, is_revert, reverts_sha)
       VALUES (?, NULL, 'a@b', ?, 'msg', ?, 0, NULL)`,
    );
    const insertTouch = db.prepare(
      `INSERT INTO file_touches (commit_sha, file_path, adds, dels, change_type, renamed_from)
       VALUES (?, ?, 1, 0, 'M', NULL)`,
    );

    db.pragma("foreign_keys = OFF");
    const seed = db.transaction(() => {
      for (let i = 0; i < COMMITS; i++) {
        const sha = `c${i.toString().padStart(8, "0")}${"0".repeat(31)}`.slice(0, 40);
        const isFix = Math.random() < FIX_RATIO ? 1 : 0;
        insertCommit.run(sha, baseTs + i * 60, isFix);
        for (let j = 0; j < TOUCHES_PER_COMMIT; j++) {
          const file = `src/file_${(i * 7 + j) % FILES}.ts`;
          insertTouch.run(sha, file);
        }
      }
    });
    seed();
    db.pragma("foreign_keys = ON");

    const t0 = Date.now();
    deriveFixLinks(db);
    const elapsed = Date.now() - t0;

    // Sanity: ensure the function actually did something.
    const linkCount = (db.prepare("SELECT COUNT(*) AS n FROM fix_links").get() as { n: number }).n;
    expect(linkCount).toBeGreaterThan(0);

    // Hard budget: 5 seconds for 10K commits. Pre-fix, this would not finish
    // in any reasonable time on this size.
    expect(elapsed).toBeLessThan(5_000);

    db.close();
  }, 60_000);
});
