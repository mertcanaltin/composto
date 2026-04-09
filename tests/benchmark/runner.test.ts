import { describe, it, expect } from "vitest";
import { benchmarkFile, summarize } from "../../src/benchmark/runner.js";

describe("benchmarkFile", () => {
  it("returns token stats for a code string", () => {
    const code = [
      'import { useState } from "react";',
      "",
      "export function App() {",
      "  const count = 0;",
      "  return count;",
      "}",
    ].join("\n");

    const result = benchmarkFile(code, "test.ts");
    expect(result.file).toBe("test.ts");
    expect(result.rawTokens).toBeGreaterThan(0);
    expect(result.irL0Tokens).toBeGreaterThan(0);
    expect(result.irL1Tokens).toBeGreaterThan(0);
    expect(result.irL1Tokens).toBeLessThan(result.rawTokens);
    expect(result.savedPercent).toBeGreaterThan(0);
    expect(result.savedPercent).toBeLessThan(100);
    expect(result.avgConfidence).toBeGreaterThan(0);
    expect(result.avgConfidence).toBeLessThanOrEqual(1);
  });
});

describe("summarize", () => {
  it("aggregates multiple file results", () => {
    const results = [
      { file: "a.ts", rawTokens: 100, irL0Tokens: 20, irL1Tokens: 30, savedPercent: 70, avgConfidence: 0.9 },
      { file: "b.ts", rawTokens: 200, irL0Tokens: 40, irL1Tokens: 50, savedPercent: 75, avgConfidence: 0.85 },
    ];
    const summary = summarize(results);
    expect(summary.totalRaw).toBe(300);
    expect(summary.totalIRL1).toBe(80);
    expect(summary.totalSavedPercent).toBeCloseTo(73.3, 0);
    expect(summary.avgConfidence).toBeCloseTo(0.875, 2);
    expect(summary.fileCount).toBe(2);
  });
});
