// tests/memory/integration/degraded-modes.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryAPI } from "../../../dist/memory/api.js";

describe("BlastRadius degraded modes (Plan 3)", () => {
  let repoDir = "";
  let dbDir = "";

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-dg-repo-"));
    dbDir = mkdtempSync(join(tmpdir(), "composto-dg-db-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("returns 'disabled' when .composto/failures.json flags disabled state", async () => {
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    const compostoDir = join(dbDir, ".composto");
    mkdirSync(compostoDir, { recursive: true });
    writeFileSync(
      join(compostoDir, "failures.json"),
      JSON.stringify({ failures: [], disabled: true })
    );
    const api = new MemoryAPI({ dbPath: join(compostoDir, "memory.db"), repoPath: repoDir });
    const res = await api.blastradius({ file: "token.ts" });
    expect(res.status).toBe("disabled");
    expect(res.verdict).toBe("unknown");
    await api.close();
  });

  it("returns 'internal_error' when an unexpected error is thrown from the query path", async () => {
    // Make the repo unreadable by git by removing the .git directory AFTER
    // MemoryAPI is constructed. The first call into git will throw and should
    // surface as internal_error.
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    const api = new MemoryAPI({ dbPath: join(dbDir, "memory.db"), repoPath: repoDir });
    rmSync(join(repoDir, ".git"), { recursive: true, force: true });
    const res = await api.blastradius({ file: "token.ts" });
    expect(res.status).toBe("internal_error");
    expect(res.reason).toMatch(/internal error/);
    await api.close();
  });
});
