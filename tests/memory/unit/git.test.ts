import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  revParseHead,
  isShallowRepo,
  revListCount,
  isAncestor,
  countCommits,
} from "../../../src/memory/git.js";

describe("git helpers", () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-git-"));
    execSync(
      `bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`,
      { stdio: "ignore" }
    );
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns a full-length SHA for HEAD", () => {
    const head = revParseHead(repoDir);
    expect(head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reports not shallow for a normal repo", () => {
    expect(isShallowRepo(repoDir)).toBe(false);
  });

  it("counts commits reachable from HEAD", () => {
    expect(countCommits(repoDir)).toBeGreaterThanOrEqual(20);
  });

  it("revListCount between same SHA is 0", () => {
    const head = revParseHead(repoDir);
    expect(revListCount(repoDir, head, head)).toBe(0);
  });

  it("isAncestor returns true for HEAD~1..HEAD", () => {
    const prev = execSync("git rev-parse HEAD~1", { cwd: repoDir, encoding: "utf-8" }).trim();
    const head = revParseHead(repoDir);
    expect(isAncestor(repoDir, prev, head)).toBe(true);
  });
});
