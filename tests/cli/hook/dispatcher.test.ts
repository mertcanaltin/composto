import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHookDispatch } from "../../../src/cli/hook/dispatcher.js";

// The dispatcher now has a single route: claude-code PostToolUse Read-compress.
// The risk-gate PreToolUse/BeforeTool adapters were removed in the fast-map
// consolidation.
describe("runHookDispatch", () => {
  it("routes claude-code posttooluse to the compress-read adapter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-disp-"));
    try {
      const filePath = join(dir, "a.ts");
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
      const stdin = JSON.stringify({ tool_name: "Read", tool_input: { file_path: filePath } });
      const result = await runHookDispatch({ platform: "claude-code", event: "posttooluse", stdin, cwd: dir });
      expect(result.envelope).toHaveProperty("hookSpecificOutput");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on an unknown platform", async () => {
    await expect(
      runHookDispatch({ platform: "cursor" as any, event: "posttooluse" as any, stdin: "{}", cwd: "." }),
    ).rejects.toThrow(/unknown hook/);
  });

  it("throws on an unknown event for claude-code", async () => {
    await expect(
      runHookDispatch({ platform: "claude-code", event: "pretooluse" as any, stdin: "{}", cwd: "." }),
    ).rejects.toThrow(/unknown hook/);
  });
});
