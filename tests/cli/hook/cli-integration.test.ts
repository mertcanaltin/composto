import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Absolute path to the built CLI — the first test runs with cwd set to a
// fresh temp fixture repo, so `node dist/index.js` alone would not resolve.
const CLI = resolve(process.cwd(), "dist/index.js");

describe("composto hook CLI — integration smoke", () => {
  it("emits valid JSON on stdout for claude-code pretooluse on a real repo", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "composto-clihook-"));
    try {
      execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
      const stdin = JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: "token.ts", old_string: "x", new_string: "y" },
      });
      const out = execSync(`node ${CLI} hook claude-code pretooluse`, {
        cwd: repoDir,
        input: stdin,
        encoding: "utf-8",
      });
      const parsed = JSON.parse(out);
      expect(parsed).toBeDefined();
      // Either passthrough or CC envelope — both valid.
      expect(typeof parsed).toBe("object");
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("emits passthrough on bad platform arg (never crashes)", () => {
    const out = execSync(`node ${CLI} hook no-such-platform pretooluse`, {
      input: "{}",
      encoding: "utf-8",
    });
    expect(JSON.parse(out)).toEqual({ hookSpecificOutput: {} });
  });
});
