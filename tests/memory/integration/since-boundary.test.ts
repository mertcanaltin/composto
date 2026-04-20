import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryAPI } from "../../../dist/memory/api.js";
import { resolveSinceBoundary } from "../../../src/memory/git.js";

describe("MemoryAPI.bootstrapFromBoundary — bounded indexing", () => {
  let repoDir: string;
  let dbDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-since-int-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-since-int-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("indexes only commits after the boundary SHA", async () => {
    // small-repo has 20 commits between 2026-01-01 and 2026-01-20.
    // Pick a boundary mid-way → expect roughly half the commits indexed.
    const fromSha = resolveSinceBoundary(repoDir, "2026-01-10");
    expect(fromSha).not.toBeNull();

    const api = new MemoryAPI({ dbPath: join(dbDir, "memory.db"), repoPath: repoDir });
    try {
      await api.bootstrapFromBoundary(fromSha);

      // Probe via a fresh DB connection to confirm the worker committed.
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(join(dbDir, "memory.db"), { readonly: true });
      const total = (db
        .prepare("SELECT value FROM index_state WHERE key = 'indexed_commits_total'")
        .get() as { value: string } | undefined)?.value;
      db.close();

      const n = parseInt(total ?? "0", 10);
      // Bounded: must be > 0 (some commits were after the boundary) AND
      // < 20 (some commits were before the boundary).
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(20);
    } finally {
      await api.close();
    }
  });
});
