import { describe, it, expect } from "vitest";
import type { BlastRadiusResponse, Verdict } from "../../../../src/memory/types.js";
import type { HookApi, HookDeps } from "../../../../src/cli/hook/api-deps.js";
import { runGeminiCliHook } from "../../../../src/cli/hook/adapters/gemini-cli.js";

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
  // SAME SHAPE as claude-code.test.ts / cursor.test.ts — keep in sync.
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

describe("gemini-cli BeforeTool adapter — unit tests with stubbed API", () => {
  it("emits additionalContext on verdict=high", async () => {
    const stdin = JSON.stringify({
      tool_name: "edit_file",
      tool_input: { path: "src/auth.ts", patch: "..." },
    });
    const result = await runGeminiCliHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(fakeResponse("high")),
    );
    expect(result.hookSpecificOutput?.hookEventName).toBe("BeforeTool");
    expect(result.hookSpecificOutput?.additionalContext).toMatch(/verdict:\s*high/);
  });

  it("emits additionalContext on verdict=medium", async () => {
    const stdin = JSON.stringify({
      tool_name: "write_file",
      tool_input: { path: "src/auth.ts", content: "..." },
    });
    const result = await runGeminiCliHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(fakeResponse("medium")),
    );
    expect(result.hookSpecificOutput?.additionalContext).toMatch(/verdict:\s*medium/);
  });

  it("emits additionalContext on verdict=unknown (surfaces thin-data warning)", async () => {
    const stdin = JSON.stringify({
      tool_name: "replace",
      tool_input: { path: "src/auth.ts", old_string: "x", new_string: "y" },
    });
    const result = await runGeminiCliHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(fakeResponse("unknown")),
    );
    expect(result.hookSpecificOutput?.additionalContext).toMatch(/verdict:\s*unknown/);
  });

  it("passes through on verdict=low", async () => {
    const stdin = JSON.stringify({
      tool_name: "edit_file",
      tool_input: { path: "src/auth.ts", patch: "..." },
    });
    const result = await runGeminiCliHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(fakeResponse("low")),
    );
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it("passes through on non-file tool (API never called)", async () => {
    const result = await runGeminiCliHook(
      {
        stdin: JSON.stringify({ tool_name: "run_shell_command", tool_input: { command: "ls" } }),
        cwd: "/irrelevant",
      },
      makeStubDeps(null),
    );
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it("passes through on malformed stdin (never throws)", async () => {
    const result = await runGeminiCliHook(
      { stdin: "not-json", cwd: "/irrelevant" },
      makeStubDeps(null),
    );
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it("passes through on blastradius error (never blocks)", async () => {
    const stdin = JSON.stringify({
      tool_name: "edit_file",
      tool_input: { path: "src/auth.ts", patch: "..." },
    });
    const result = await runGeminiCliHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(null, new Error("simulated DB failure")),
    );
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
  });
});
