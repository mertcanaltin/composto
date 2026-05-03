import { describe, it, expect } from "vitest";
import type { BlastRadiusResponse, Verdict } from "../../../../src/memory/types.js";
import type { HookApi, HookDeps } from "../../../../src/cli/hook/api-deps.js";
import { runCursorHook } from "../../../../src/cli/hook/adapters/cursor.js";

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

describe("cursor preToolUse adapter — hybrid deny-on-high", () => {
  it("emits deny with a composto reason when verdict is high", async () => {
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "src/auth.ts", old_string: "x", new_string: "y" },
    });
    const result = await runCursorHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(fakeResponse("high")),
    );
    expect(result.envelope.permissionDecision).toBe("deny");
    expect(result.envelope.permissionDecisionReason).toMatch(/composto_blastradius/i);
    expect(result.envelope.permissionDecisionReason).toMatch(/src\/auth\.ts/);
    expect(result.envelope.permissionDecisionReason).toMatch(/verdict:\s*high/);
  });

  it("passes through silently on verdict=medium (Lean Hook v0.7.0: signal in telemetry only, --with-mcp opt-in for chat surface)", async () => {
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "src/auth.ts", old_string: "x", new_string: "y" },
    });
    const result = await runCursorHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(fakeResponse("medium")),
    );
    expect(result.envelope.permissionDecision).toBeUndefined();
  });

  it("passes through on verdict=low", async () => {
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "src/auth.ts", old_string: "x", new_string: "y" },
    });
    const result = await runCursorHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(fakeResponse("low")),
    );
    expect(result.envelope.permissionDecision).toBeUndefined();
  });

  it("passes through on verdict=unknown", async () => {
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "src/auth.ts", old_string: "x", new_string: "y" },
    });
    const result = await runCursorHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(fakeResponse("unknown")),
    );
    expect(result.envelope.permissionDecision).toBeUndefined();
  });

  it("passes through on non-file tools (extract returns null, API never called)", async () => {
    const stdin = JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } });
    const result = await runCursorHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(null), // won't be called
    );
    expect(result.envelope.permissionDecision).toBeUndefined();
  });

  it("passes through on malformed stdin (never throws)", async () => {
    const result = await runCursorHook(
      { stdin: "not-json", cwd: "/irrelevant" },
      makeStubDeps(null),
    );
    expect(result.envelope.permissionDecision).toBeUndefined();
  });

  it("passes through on blastradius error (never blocks)", async () => {
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "src/auth.ts", old_string: "x", new_string: "y" },
    });
    const result = await runCursorHook(
      { stdin, cwd: "/irrelevant" },
      makeStubDeps(null, new Error("simulated DB failure")),
    );
    expect(result.envelope.permissionDecision).toBeUndefined();
  });
});
