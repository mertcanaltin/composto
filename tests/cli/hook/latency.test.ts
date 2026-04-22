import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Absolute path to the built CLI — test runs with cwd in a fresh fixture
// repo, so `node dist/index.js` alone would not resolve.
const CLI = resolve(process.cwd(), "dist/index.js");

describe("hook CLI latency budget", () => {
  it("end-to-end round-trip is < 2000ms cold on small-repo fixture", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "composto-lat-"));
    try {
      execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
      const stdin = JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: "token.ts", old_string: "x", new_string: "y" },
      });
      const t0 = Date.now();
      execSync(`node ${CLI} hook claude-code pretooluse`, {
        cwd: repoDir,
        input: stdin,
        encoding: "utf-8",
      });
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(2000); // generous cold budget
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
