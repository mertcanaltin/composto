import { describe, it, expect } from "vitest";
import { buildEnvelope } from "../../../src/memory/envelope.js";
import type { Signal } from "../../../src/memory/types.js";

const s: Signal[] = [
  { type: "revert_match", strength: 1.0, precision: 0.5, sample_size: 25, evidence: [] },
  { type: "hotspot", strength: 0, precision: 0.3, sample_size: 0, evidence: [] },
  { type: "fix_ratio", strength: 0, precision: 0.3, sample_size: 0, evidence: [] },
  { type: "author_churn", strength: 0, precision: 0.3, sample_size: 0, evidence: [] },
];

describe("buildEnvelope", () => {
  it("assembles a valid ok response", () => {
    const env = buildEnvelope({
      status: "ok",
      signals: s,
      score: 0.5,
      confidence: 0.4,
      tazelik: "fresh",
      indexedThrough: "abc123",
      indexedTotal: 1500,
      queryMs: 18,
    });
    expect(env.status).toBe("ok");
    expect(env.verdict).toBe("medium");
    expect(env.signals.length).toBe(4);
    expect(env.metadata.signal_coverage).toBe("1/4");
    expect(env.calibration).toBe("repo-calibrated"); // any firing signal with sample_size > 0 → repo-calibrated
  });

  it("sets verdict 'unknown' when confidence is below threshold", () => {
    const env = buildEnvelope({
      status: "ok",
      signals: s,
      score: 0.9,
      confidence: 0.2,
      tazelik: "bootstrapping",
      indexedThrough: "abc123",
      indexedTotal: 30,
      queryMs: 5,
    });
    expect(env.verdict).toBe("unknown");
  });

  it("stays 'heuristic' when all signals have sample_size 0", () => {
    const env = buildEnvelope({
      status: "ok",
      signals: s.map((sig) => ({ ...sig, sample_size: 0 })),
      score: 0,
      confidence: 0,
      tazelik: "fresh",
      indexedThrough: "abc",
      indexedTotal: 100,
      queryMs: 10,
    });
    expect(env.calibration).toBe("heuristic");
  });

  it("applies confidence_cap on degraded statuses", () => {
    const env = buildEnvelope({
      status: "empty_repo",
      signals: [],
      score: 0,
      confidence: 1.0,
      tazelik: "fresh",
      indexedThrough: "",
      indexedTotal: 0,
      queryMs: 1,
      reason: "repo has 2 commits; blastradius requires >= 10",
    });
    expect(env.status).toBe("empty_repo");
    expect(env.confidence).toBeLessThanOrEqual(0.0);
    expect(env.verdict).toBe("unknown");
    expect(env.reason).toBeDefined();
  });
});
