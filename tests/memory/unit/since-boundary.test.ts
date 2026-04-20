import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSinceBoundary, revParseHead } from "../../../src/memory/git.js";

describe("resolveSinceBoundary", () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-since-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns a real SHA for a date that lies inside the repo's history", () => {
    // small-repo starts at 2026-01-01. Pick a date well inside that window.
    const sha = resolveSinceBoundary(repoDir, "2026-01-05");
    expect(sha).not.toBeNull();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns null for a date older than the first commit", () => {
    const sha = resolveSinceBoundary(repoDir, "2025-01-01");
    expect(sha).toBeNull();
  });

  it("returns the HEAD-ward boundary for a date past the last commit", () => {
    const sha = resolveSinceBoundary(repoDir, "2030-01-01");
    expect(sha).toBe(revParseHead(repoDir));
  });

  it("rejects a malformed date string", () => {
    expect(() => resolveSinceBoundary(repoDir, "yesterday")).toThrow(/YYYY-MM-DD/);
    expect(() => resolveSinceBoundary(repoDir, "2026/01/01")).toThrow(/YYYY-MM-DD/);
    expect(() => resolveSinceBoundary(repoDir, "'; rm -rf /")).toThrow(/YYYY-MM-DD/);
  });
});
