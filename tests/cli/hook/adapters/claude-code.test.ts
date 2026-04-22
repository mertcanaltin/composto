import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BlastRadiusResponse, Verdict } from "../../../../src/memory/types.js";
import type { HookApi, HookDeps } from "../../../../src/cli/hook/api-deps.js";
import { runClaudeCodeHook } from "../../../../src/cli/hook/adapters/claude-code.js";

function makeStubDeps(response: BlastRadiusResponse | null, throwErr?: Error): HookDeps {
  return {
    makeApi(): HookApi {
      return {
        async blastradius() {
          if (throwErr) throw throwErr;
          if (!response) throw new Error("no stub response configured");
          return response;
        },
        async close() {},
      };
    },
  };
}

function fakeResponse(verdict: Verdict): BlastRadiusResponse {
  // SAME SHAPE as cursor.test.ts — keep in sync.
  return {
    status: "ok",
    verdict,
    score: verdict === "high" ? 0.9 : verdict === "medium" ? 0.5 : 0.1,
    confidence: verdict === "unknown" ? 0.1 : 0.6,
    signals: [
      { type: "revert_match", strength: 1.0, precision: 0.5, sample_size: 25, evidence: [] },
    ],
    calibration: "repo-calibrated",
    metadata: {
      tazelik: "fresh",
      index_version: 1,
      indexed_commits_through: "abc123",
      indexed_commits_total: 100,
      query_ms: 10,
      signal_coverage: "1/4",
    },
  };
}

describe("claude-code PreToolUse adapter — unit tests with stubbed API", () => {
  it("emits additionalContext on verdict=high", async () => {
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "src/auth.ts", old_string: "x", new_string: "y" },
    });
    const result = await runClaudeCodeHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(fakeResponse("high")),
    );
    expect(result.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
    expect(result.hookSpecificOutput?.additionalContext).toMatch(/verdict:\s*high/);
  });

  it("emits additionalContext on verdict=medium", async () => {
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "src/auth.ts", old_string: "x", new_string: "y" },
    });
    const result = await runClaudeCodeHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(fakeResponse("medium")),
    );
    expect(result.hookSpecificOutput?.additionalContext).toMatch(/verdict:\s*medium/);
  });

  it("emits additionalContext on verdict=unknown (surfaces it so agent knows data is thin)", async () => {
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "src/auth.ts", old_string: "x", new_string: "y" },
    });
    const result = await runClaudeCodeHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(fakeResponse("unknown")),
    );
    expect(result.hookSpecificOutput?.additionalContext).toMatch(/verdict:\s*unknown/);
  });

  it("passes through on verdict=low", async () => {
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "src/auth.ts", old_string: "x", new_string: "y" },
    });
    const result = await runClaudeCodeHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(fakeResponse("low")),
    );
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it("passes through on non-file tool (API never called)", async () => {
    const result = await runClaudeCodeHook(
      {
        stdin: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }),
        cwd: "/irrelevant",
      },
      makeStubDeps(null),
    );
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it("passes through on malformed stdin (never throws)", async () => {
    const result = await runClaudeCodeHook(
      { stdin: "not-json", cwd: "/irrelevant" },
      makeStubDeps(null),
    );
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it("passes through on blastradius error (never blocks)", async () => {
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "src/auth.ts", old_string: "x", new_string: "y" },
    });
    const result = await runClaudeCodeHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(null, new Error("simulated DB failure")),
    );
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
  });
});

describe("claude-code PreToolUse adapter — integration smoke on real fixture", () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-cchook-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("wires end-to-end without throwing on a real fixture repo", async () => {
    // Fixture can produce unknown or low verdicts; we only verify the
    // adapter doesn't throw and emits a valid envelope. Verdict-level
    // behavior is covered by the unit tests above.
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "token.ts", old_string: "x", new_string: "y" },
    });
    const result = await runClaudeCodeHook({ stdin, cwd: repoDir });
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    // Either passthrough or a valid additionalContext block — both fine.
  });

  it("passes through on non-file tool against real fixture", async () => {
    const result = await runClaudeCodeHook({
      stdin: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }),
      cwd: repoDir,
    });
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
  });
});
