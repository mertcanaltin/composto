// tests/memory/unit/hotspot.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { computeHotspot } from "../../../src/memory/signals/hotspot.js";

describe("hotspot signal", () => {
  let repoDir = "";
  let dbDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-hs-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-hs-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("returns a valid signal shape for touched files", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    const s = computeHotspot(db, "token.ts");
    expect(s.type).toBe("hotspot");
    expect(s.strength).toBeGreaterThanOrEqual(0);
    expect(s.strength).toBeLessThanOrEqual(1.0);
    expect(s.touches_90d).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it("returns zero strength for untouched files", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const s = computeHotspot(db, "totally-unrelated-file.ts");
    expect(s.strength).toBe(0);
    expect(s.touches_90d).toBe(0);
    db.close();
  });
});
