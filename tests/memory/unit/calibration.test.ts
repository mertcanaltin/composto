import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { refreshCalibration, shouldRefresh } from "../../../src/memory/calibration.js";

describe("calibration", () => {
  let repoDir = "";
  let dbDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-cal-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-cal-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("refreshCalibration populates a row for each of the 4 signal types", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    const head = revParseHead(repoDir);
    ingestRange(db, repoDir, { from: null, to: head });

    refreshCalibration(db, head);

    const rows = db.prepare(`SELECT signal_type FROM signal_calibration ORDER BY signal_type`).all() as Array<{ signal_type: string }>;
    const types = rows.map((r) => r.signal_type);
    expect(types).toEqual([
      "author_churn",
      "fix_ratio",
      "hotspot",
      "revert_match",
    ]);
    db.close();
  });

  it("shouldRefresh returns true on first run", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    expect(shouldRefresh(db, "abc123")).toBe(true);
    db.close();
  });

  it("shouldRefresh returns false immediately after a refresh", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const head = revParseHead(repoDir);
    refreshCalibration(db, head);
    expect(shouldRefresh(db, head)).toBe(false);
    db.close();
  });
});
