import { describe, it, expect } from "vitest";
import { computeScoreAndConfidence } from "../../../src/memory/confidence.js";
import type { Signal } from "../../../src/memory/types.js";

function signal(s: Partial<Signal>): Signal {
  return {
    type: "revert_match",
    strength: 0,
    precision: 0.5,
    sample_size: 0,
    ...s,
  };
}

describe("computeScoreAndConfidence", () => {
  it("returns zero score when no signal fires", () => {
    const { score, confidence } = computeScoreAndConfidence(
      [signal({ strength: 0 }), signal({ type: "hotspot", strength: 0, precision: 0.3 })],
      { tazelik: "fresh", partial: false, totalCommits: 1500 }
    );
    expect(score).toBe(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("weights signals by their precision", () => {
    const { score } = computeScoreAndConfidence(
      [
        signal({ strength: 1.0, precision: 0.8, sample_size: 50 }),
        signal({ type: "hotspot", strength: 0.5, precision: 0.4, sample_size: 30 }),
      ],
      { tazelik: "fresh", partial: false, totalCommits: 1500 }
    );
    // Numerator = 1.0*0.8 + 0.5*0.4 = 1.0
    // Denominator = 0.8 + 0.4 = 1.2
    // score ≈ 0.833
    expect(score).toBeCloseTo(0.833, 2);
  });

  it("confidence is dominated by the weakest factor", () => {
    const { confidence } = computeScoreAndConfidence(
      [signal({ strength: 1.0, precision: 0.9, sample_size: 50 })],
      { tazelik: "fresh", partial: false, totalCommits: 30 }
    );
    // coverage_factor: 1 usable signal → 1/3 = 0.333
    // calibration_factor: avg_sample=50 → 0.6
    // freshness_factor: fresh → 1.0
    // history_factor: n<50 → 0.2
    // min = 0.2
    expect(confidence).toBeCloseTo(0.2, 2);
  });

  it("bootstrapping drops freshness_factor to 0.2", () => {
    const { confidence } = computeScoreAndConfidence(
      [signal({ strength: 1.0, precision: 0.9, sample_size: 100 })],
      { tazelik: "bootstrapping", partial: false, totalCommits: 2000 }
    );
    expect(confidence).toBeCloseTo(0.2, 2);
  });
});
