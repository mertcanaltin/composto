import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Absolute path to the built CLI — the first test runs with cwd set to a
// fresh temp dir, so `node dist/index.js` alone would not resolve.
const CLI = resolve(process.cwd(), "dist/index.js");

describe("composto hook CLI — integration smoke", () => {
  it("emits valid JSON on stdout for claude-code posttooluse on a real file", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-clihook-"));
    try {
      const filePath = join(dir, "sample.ts");
      writeFileSync(
        filePath,
        [
          "export interface User { id: string; name: string; }",
          "export function greet(u: User): string {",
          "  if (!u.name) return 'anon';",
          "  return `hi ${u.name}`;",
          "}",
        ].join("\n"),
      );
      const stdin = JSON.stringify({
        tool_name: "Read",
        tool_input: { file_path: filePath },
      });
      const out = execSync(`node ${CLI} hook claude-code posttooluse`, {
        cwd: dir,
        input: stdin,
        encoding: "utf-8",
      });
      const parsed = JSON.parse(out);
      expect(parsed).toBeDefined();
      // Either passthrough or a compress envelope — both valid JSON objects.
      expect(typeof parsed).toBe("object");
      expect(parsed).toHaveProperty("hookSpecificOutput");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits passthrough on bad platform arg (never crashes)", () => {
    const out = execSync(`node ${CLI} hook no-such-platform posttooluse`, {
      input: "{}",
      encoding: "utf-8",
    });
    expect(JSON.parse(out)).toEqual({ hookSpecificOutput: {} });
  });
});
