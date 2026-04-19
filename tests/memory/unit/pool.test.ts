import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { WorkerPool } from "../../../dist/memory/pool.js";

describe("WorkerPool", () => {
  let pool: WorkerPool | null = null;
  let repoDir = "";
  let dbPath = "";

  afterEach(async () => {
    if (pool) await pool.close();
    pool = null;
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
    if (dbPath) rmSync(dbPath, { force: true });
  });

  it("dispatches an ingest job to a worker and receives completion", async () => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-pool-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbPath = join(mkdtempSync(join(tmpdir(), "composto-pool-db-")), "memory.db");

    pool = new WorkerPool({ size: 1 });
    const result = await pool.runIngest({
      dbPath,
      repoPath: repoDir,
      range: { from: null, to: execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf-8" }).trim() },
    });

    expect(result.status).toBe("done");
    expect(result.commits).toBeGreaterThanOrEqual(20);
  });
});
