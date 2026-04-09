import { describe, it, expect } from "vitest";
import { buildHealthTag, annotateIR, computeHealthFromTrends } from "../../src/ir/health.js";
import type { HealthAnnotation, TrendAnalysis } from "../../src/types.js";

describe("buildHealthTag", () => {
  it("builds tag for unhealthy code", () => {
    const health: HealthAnnotation = {
      churn: 15, fixRatio: 0.73, coverageTrend: "down",
      staleness: "3w", authorCount: 3, consistency: "low",
    };
    expect(buildHealthTag(health)).toBe("[HOT:15/30 FIX:73% COV:↓ INCON]");
  });

  it("returns empty for healthy code", () => {
    const health: HealthAnnotation = {
      churn: 2, fixRatio: 0.1, coverageTrend: "stable",
      staleness: "1d", authorCount: 1, consistency: "high",
    };
    expect(buildHealthTag(health)).toBe("");
  });

  it("includes only relevant signals", () => {
    const health: HealthAnnotation = {
      churn: 15, fixRatio: 0.2, coverageTrend: "stable",
      staleness: "1d", authorCount: 1, consistency: "high",
    };
    expect(buildHealthTag(health)).toBe("[HOT:15/30]");
  });
});

describe("annotateIR", () => {
  it("adds health tag to first line for unhealthy file", () => {
    const ir = "FN:handleAuth({credentials})\n  VAR:session = createSession()";
    const health: HealthAnnotation = {
      churn: 15, fixRatio: 0.73, coverageTrend: "down",
      staleness: "3w", authorCount: 3, consistency: "low",
    };
    expect(annotateIR(ir, health)).toBe(
      "FN:handleAuth({credentials}) [HOT:15/30 FIX:73% COV:↓ INCON]\n  VAR:session = createSession()"
    );
  });

  it("returns IR unchanged for healthy file", () => {
    const ir = "FN:handlePayment({amount})";
    const health: HealthAnnotation = {
      churn: 2, fixRatio: 0.0, coverageTrend: "up",
      staleness: "1d", authorCount: 1, consistency: "high",
    };
    expect(annotateIR(ir, health)).toBe(ir);
  });
});

describe("computeHealthFromTrends", () => {
  it("computes health from trend analysis", () => {
    const trends: TrendAnalysis = {
      hotspots: [{ file: "src/auth.ts", changesInLast30Commits: 12, bugFixRatio: 0.67, authorCount: 3 }],
      decaySignals: [{ file: "src/auth.ts", metric: "churn", trend: "declining", dataPoints: [] }],
      inconsistencies: [{ file: "src/auth.ts", patterns: [
        { author: "A", style: "fix" }, { author: "B", style: "feat" }, { author: "C", style: "refactor" },
      ]}],
    };
    const health = computeHealthFromTrends("src/auth.ts", trends);
    expect(health.churn).toBe(12);
    expect(health.fixRatio).toBeCloseTo(0.67);
    expect(health.consistency).toBe("low");
  });

  it("returns healthy defaults for unknown file", () => {
    const trends: TrendAnalysis = { hotspots: [], decaySignals: [], inconsistencies: [] };
    const health = computeHealthFromTrends("src/unknown.ts", trends);
    expect(health.churn).toBe(0);
    expect(health.consistency).toBe("high");
  });
});
