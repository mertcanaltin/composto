import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";

describe("fix-links derivation", () => {
  let repoDir: string;
  let dbDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-fl-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-fl-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("creates a revert_marker link from the revert commit to the reverted commit", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    const head = revParseHead(repoDir);
    ingestRange(db, repoDir, { from: null, to: head });

    const reverts = db.prepare(`
      SELECT * FROM fix_links WHERE evidence_type = 'revert_marker'
    `).all() as Array<{ fix_commit_sha: string; suspected_break_sha: string; confidence: number }>;

    expect(reverts.length).toBe(1);
    expect(reverts[0].confidence).toBe(1.0);
    db.close();
  });

  it("creates short_followup_fix links for fixes following prior touches within 72h", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const links = db.prepare(`
      SELECT * FROM fix_links WHERE evidence_type = 'short_followup_fix'
    `).all();
    // small-repo has at least one fix following a recent touch on the same file
    expect(links.length).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
