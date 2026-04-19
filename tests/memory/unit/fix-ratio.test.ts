// tests/memory/unit/fix-ratio.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { computeFixRatio } from "../../../src/memory/signals/fix-ratio.js";

describe("fix_ratio signal", () => {
  let repoDir = "";
  let dbDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-fr-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-fr-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("returns ratio and bounded strength for a file with history", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    const s = computeFixRatio(db, "token.ts");
    expect(s.type).toBe("fix_ratio");
    expect(s.ratio).toBeGreaterThanOrEqual(0);
    expect(s.ratio).toBeLessThanOrEqual(1);
    expect(s.strength).toBeGreaterThanOrEqual(0);
    expect(s.strength).toBeLessThanOrEqual(1);
    db.close();
  });

  it("returns zero strength when ratio is 0 (no touches)", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const s = computeFixRatio(db, "nowhere.ts");
    expect(s.strength).toBe(0);
    expect(s.ratio).toBe(0);
    db.close();
  });
});
