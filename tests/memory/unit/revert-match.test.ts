import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { computeRevertMatch } from "../../../src/memory/signals/revert-match.js";

describe("revert_match signal", () => {
  let repoDir = "";
  let dbDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-rm-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-rm-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("fires with strength 1.0 for a file touched by a reverted commit", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    const sig = computeRevertMatch(db, "token.ts");
    expect(sig.type).toBe("revert_match");
    expect(sig.strength).toBe(1.0);
    expect(sig.evidence?.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("returns strength 0 for a file with no revert history", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    const sig = computeRevertMatch(db, "nonexistent.ts");
    expect(sig.strength).toBe(0);
    db.close();
  });
});
