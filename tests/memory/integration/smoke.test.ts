import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("BlastRadius Plan 1 — end-to-end smoke", () => {
  let repoDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-smoke-"));
    execSync(`bash ${process.cwd()}/tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("bootstraps the memory index from scratch via `composto index`", () => {
    const bin = join(process.cwd(), "dist", "index.js");
    execSync(`node ${bin} index`, { cwd: repoDir, encoding: "utf-8" });
    expect(existsSync(join(repoDir, ".composto", "memory.db"))).toBe(true);
  });

  it("answers `composto impact token.ts` with a revert_match signal firing", () => {
    const bin = join(process.cwd(), "dist", "index.js");
    const out = execSync(`node ${bin} impact token.ts`, {
      cwd: repoDir,
      encoding: "utf-8",
    });
    expect(out).toMatch(/verdict:/);
    expect(out).toMatch(/revert_match\s+■+/);
  });

  it("responds immediately on an unrelated file with zero signals firing", () => {
    const bin = join(process.cwd(), "dist", "index.js");
    const out = execSync(`node ${bin} impact nonexistent-file.ts`, {
      cwd: repoDir,
      encoding: "utf-8",
    });
    expect(out).toMatch(/verdict:/);
    expect(out).toMatch(/revert_match\s+·/);
  });
});
