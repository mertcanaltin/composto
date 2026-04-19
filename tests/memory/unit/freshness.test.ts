import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { ensureFresh } from "../../../src/memory/freshness.js";
import { revParseHead } from "../../../src/memory/git.js";

describe("ensureFresh", () => {
  let repoDir = "";
  let dbDir = "";

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-fresh-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-fresh-db-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("reports 'bootstrapping' when DB has no last_indexed_sha", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    const res = ensureFresh(db, repoDir);
    expect(res.tazelik).toBe("bootstrapping");
    expect(res.delta).toEqual({ from: null, to: expect.any(String) });
    db.close();
  });

  it("reports 'fresh' when last_indexed_sha matches HEAD", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });
    const res = ensureFresh(db, repoDir);
    expect(res.tazelik).toBe("fresh");
    expect(res.delta).toBeNull();
    db.close();
  });

  it("reports 'catching_up' and delta when HEAD has advanced", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    // Advance HEAD by one commit
    execSync("git commit --allow-empty -m 'chore: advance'", {
      cwd: repoDir,
      stdio: "ignore",
    });

    const res = ensureFresh(db, repoDir);
    expect(res.tazelik).toBe("catching_up");
    expect(res.delta?.from).not.toBeNull();
    expect(res.behind_by).toBe(1);
    db.close();
  });
});
