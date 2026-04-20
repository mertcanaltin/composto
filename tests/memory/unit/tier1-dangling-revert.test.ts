import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";

describe("tier1 ingest — dangling reverts_sha", () => {
  let repoDir = "";
  let dbDir = "";

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-dangling-"));
    execSync(`git init -q -b main`, { cwd: repoDir });
    execSync(`git config user.email "x@y.dev"`, { cwd: repoDir });
    execSync(`git config user.name "x"`, { cwd: repoDir });
    execSync(`git commit --allow-empty -m "feat: initial"`, { cwd: repoDir });
    // A revert commit whose body references a SHA that is not in this repo.
    // In real-world zod-like histories this happens when revert messages carry
    // truncated or mistyped SHAs, or reference commits from rebased branches
    // that never landed in the indexed range.
    execSync(
      `git commit --allow-empty -m 'Revert "something"

This reverts commit 0000000000000000000000000000000000000000.'`,
      { cwd: repoDir }
    );
    dbDir = mkdtempSync(join(tmpdir(), "composto-dangling-db-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("does NOT crash with FOREIGN KEY error when reverts_sha points at a missing commit", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);

    expect(() => {
      ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });
    }).not.toThrow();

    db.close();
  });

  it("nulls out dangling reverts_sha so FK constraint is satisfied", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    const row = db
      .prepare(`SELECT sha, is_revert, reverts_sha FROM commits WHERE is_revert = 1`)
      .get() as { sha: string; is_revert: number; reverts_sha: string | null } | undefined;

    expect(row).toBeDefined();
    expect(row?.is_revert).toBe(1);
    expect(row?.reverts_sha).toBeNull();
    db.close();
  });

  it("preserves reverts_sha when the target commit IS in range (short SHA prefix match)", () => {
    // Rebuild the fixture to include a valid short-SHA revert reference.
    rmSync(repoDir, { recursive: true, force: true });
    repoDir = mkdtempSync(join(tmpdir(), "composto-valid-revert-"));
    execSync(`git init -q -b main`, { cwd: repoDir });
    execSync(`git config user.email "x@y.dev"`, { cwd: repoDir });
    execSync(`git config user.name "x"`, { cwd: repoDir });
    execSync(`git commit --allow-empty -m "feat: first"`, { cwd: repoDir });
    execSync(`git commit --allow-empty -m "feat: target to revert"`, { cwd: repoDir });
    const targetFullSha = execSync(`git rev-parse HEAD`, { cwd: repoDir, encoding: "utf-8" }).trim();
    const targetShortSha = targetFullSha.slice(0, 7);
    execSync(
      `git commit --allow-empty -m 'Revert "feat: target to revert"

This reverts commit ${targetShortSha}.'`,
      { cwd: repoDir }
    );

    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    const row = db
      .prepare(`SELECT is_revert, reverts_sha FROM commits WHERE is_revert = 1`)
      .get() as { is_revert: number; reverts_sha: string | null } | undefined;

    expect(row?.is_revert).toBe(1);
    // The short SHA from the revert message should have been resolved to the
    // full SHA of the target commit.
    expect(row?.reverts_sha).toBe(targetFullSha);
    db.close();
  });
});
