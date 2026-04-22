import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClaudeCodeHook } from "../../../../src/cli/hook/adapters/claude-code.js";

describe("claude-code PreToolUse adapter", () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-cchook-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
  });

  it("emits a PreToolUse envelope with additionalContext containing a verdict", async () => {
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "token.ts", old_string: "x", new_string: "y" },
    });
    const result = await runClaudeCodeHook({ stdin, cwd: repoDir });
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
    expect(result.hookSpecificOutput?.additionalContext).toMatch(/composto_blastradius/i);
    expect(result.hookSpecificOutput?.additionalContext).toMatch(/verdict:\s*(low|medium|high|unknown)/);
  });

  it("returns a pass-through envelope when the tool is not an editor tool", async () => {
    const stdin = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const result = await runClaudeCodeHook({ stdin, cwd: repoDir });
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it("returns a pass-through envelope on malformed stdin (never blocks the tool)", async () => {
    const result = await runClaudeCodeHook({ stdin: "not-json", cwd: repoDir });
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    // MUST NOT throw.
  });
});
