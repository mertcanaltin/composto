import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryAPI } from "../../../dist/memory/api.js";

describe("MemoryAPI.blastradius end-to-end", () => {
  let repoDir = "";
  let dbDir = "";
  let api: MemoryAPI;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-api-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-api-db-"));

    api = new MemoryAPI({ dbPath: join(dbDir, "memory.db"), repoPath: repoDir });
    await api.bootstrapIfNeeded();
  });

  afterAll(async () => {
    await api.close();
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("returns an ok response with a verdict for a file touched by a revert", async () => {
    const res = await api.blastradius({ file: "token.ts" });
    expect(res.status).toBe("ok");
    expect(res.signals.length).toBe(4);
    const revert = res.signals.find((s) => s.type === "revert_match");
    expect(revert?.strength).toBeGreaterThan(0);
    expect(res.metadata.indexed_commits_through).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns status 'empty_repo' on a repo with <10 commits", async () => {
    const shortRepo = mkdtempSync(join(tmpdir(), "composto-short-"));
    execSync(`git init -q -b main && git config user.email x@y && git config user.name x`, { cwd: shortRepo, shell: "/bin/bash" });
    for (let i = 0; i < 3; i++) {
      execSync(`git commit --allow-empty -m 'c${i}'`, { cwd: shortRepo });
    }
    const shortDb = mkdtempSync(join(tmpdir(), "composto-short-db-"));
    const shortApi = new MemoryAPI({ dbPath: join(shortDb, "memory.db"), repoPath: shortRepo });
    await shortApi.bootstrapIfNeeded();

    const res = await shortApi.blastradius({ file: "any.ts" });
    expect(res.status).toBe("empty_repo");
    expect(res.verdict).toBe("unknown");
    await shortApi.close();
    rmSync(shortRepo, { recursive: true, force: true });
    rmSync(shortDb, { recursive: true, force: true });
  });
});
