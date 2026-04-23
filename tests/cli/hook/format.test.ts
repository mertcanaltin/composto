import { describe, it, expect } from "vitest";
import type { BlastRadiusResponse } from "../../../src/memory/types.js";
import { formatBlastRadiusContext } from "../../../src/cli/hook/format.js";

function makeResponse(overrides: Partial<BlastRadiusResponse> = {}): BlastRadiusResponse {
  return {
    status: "ok",
    verdict: "high",
    score: 0.9,
    confidence: 0.6,
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
    ...overrides,
  };
}

describe("formatBlastRadiusContext", () => {
  it("emits the 7-line <composto_blastradius> block with required sections", () => {
    const out = formatBlastRadiusContext("src/a.ts", makeResponse());
    const lines = out.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("<composto_blastradius>");
    expect(lines[1]).toMatch(/^\s*file:\s*src\/a\.ts$/);
    expect(lines[2]).toMatch(/^\s*verdict:\s*high$/);
    expect(lines[3]).toMatch(/^\s*score:\s*0\.90\s*confidence:\s*0\.60$/);
    expect(lines[4]).toMatch(/^\s*firing_signals:\s*revert_match=1\.00$/);
    expect(lines[5]).toMatch(/^\s*hint:\s*/);
    expect(lines[6]).toBe("</composto_blastradius>");
  });

  it("renders firing_signals: (none) when all signal strengths are 0", () => {
    const res = makeResponse({
      signals: [
        { type: "revert_match", strength: 0, precision: 0, sample_size: 0, evidence: [] },
        { type: "hotspot", strength: 0, precision: 0, sample_size: 0, evidence: [] },
      ],
    });
    const out = formatBlastRadiusContext("src/a.ts", res);
    expect(out).toMatch(/firing_signals:\s*\(none\)/);
  });

  it("uses custom hint when provided via opts", () => {
    const customHint = "this file's bug history suggests high risk — ask the user to confirm before editing.";
    const out = formatBlastRadiusContext("src/a.ts", makeResponse(), { hint: customHint });
    expect(out).toMatch(new RegExp(`hint:\\s*${customHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });
});
