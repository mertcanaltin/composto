// tests/memory/unit/coverage-decline.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { computeCoverageDecline } from "../../../src/memory/signals/coverage-decline.js";

describe("coverage_decline signal", () => {
  let repoDir = "";
  let dbDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-cd-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-cd-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("returns zero strength for fixture files with no coverage evolution", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });
    const s = computeCoverageDecline(db, repoDir, "token.ts");
    expect(s.type).toBe("coverage_decline");
    expect(s.strength).toBe(0);
    db.close();
  });
});
