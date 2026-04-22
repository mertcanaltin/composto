import { describe, it, expect } from "vitest";
import type { BlastRadiusResponse } from "../../../src/memory/types.js";
import type { HookDeps, HookApi } from "../../../src/cli/hook/api-deps.js";
import { runHookDispatch } from "../../../src/cli/hook/dispatcher.js";

function stubHigh(): HookDeps {
  const res: BlastRadiusResponse = {
    status: "ok",
    verdict: "high",
    score: 0.9,
    confidence: 0.6,
    signals: [{ type: "revert_match", strength: 1.0, precision: 0.5, sample_size: 25, evidence: [] }],
    metadata: { tazelik: "fresh", index_version: 1, indexed_commits_through: "abc", indexed_commits_total: 100, query_ms: 5, signal_coverage: "1/4" },
    calibration: "repo-calibrated",
  };
  const api: HookApi = { async blastradius() { return res; }, async close() {} };
  return { makeApi: () => api };
}

describe("runHookDispatch", () => {
  const stdin = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "src/a.ts", old_string: "x", new_string: "y" } });

  it("routes claude-code pretooluse to the claude-code adapter", async () => {
    const result = await runHookDispatch({ platform: "claude-code", event: "pretooluse", stdin, cwd: "/irrelevant" }, stubHigh());
    // CC envelope
    expect((result as any).hookSpecificOutput?.additionalContext).toMatch(/composto_blastradius/i);
  });

  it("routes cursor pretooluse to the cursor adapter", async () => {
    const result = await runHookDispatch({ platform: "cursor", event: "pretooluse", stdin, cwd: "/irrelevant" }, stubHigh());
    // Cursor envelope
    expect((result as any).permissionDecision).toBe("deny");
  });

  it("routes gemini-cli beforetool to the gemini-cli adapter", async () => {
    const result = await runHookDispatch({ platform: "gemini-cli", event: "beforetool", stdin, cwd: "/irrelevant" }, stubHigh());
    expect((result as any).hookSpecificOutput?.additionalContext).toMatch(/composto_blastradius/i);
  });

  it("throws on unknown platform", async () => {
    await expect(
      runHookDispatch({ platform: "unknown-platform" as any, event: "pretooluse", stdin: "{}", cwd: "." })
    ).rejects.toThrow(/unknown platform/);
  });

  it("throws on unknown event for a known platform", async () => {
    await expect(
      runHookDispatch({ platform: "claude-code", event: "no-such-event" as any, stdin: "{}", cwd: "." })
    ).rejects.toThrow(/unknown event/);
  });
});
