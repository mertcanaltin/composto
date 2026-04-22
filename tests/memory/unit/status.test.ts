// tests/memory/unit/status.test.ts
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { collectStatus } from "../../../src/memory/status.js";

describe("collectStatus", () => {
  let repoDir = "";
  let dbDir = "";

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-st-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-st-db-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("produces a populated StatusReport after ingest", () => {
    const dbPath = join(dbDir, "memory.db");
    const db = openDatabase(dbPath);
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });
    db.close();

    const s = collectStatus(dbPath);
    expect(s.schemaVersion).toBe(2);
    expect(s.bootstrapped).toBe(true);
    expect(s.indexedCommitsTotal).toBeGreaterThanOrEqual(20);
    expect(s.calibrationRows).toBe(4);
    expect(s.storageBytes).toBeGreaterThan(0);
    expect(s.integrityOk).toBe(true);
  });
});
