import { describe, it, expect } from "vitest";
import { benchmarkFile, summarize } from "../../src/benchmark/runner.js";

describe("benchmarkFile", () => {
  it("returns token stats for a code string", async () => {
    const code = [
      'import { useState } from "react";',
      "",
      "export function App() {",
      "  const count = 0;",
      "  return count;",
      "}",
    ].join("\n");

    const result = await benchmarkFile(code, "test.ts");
    expect(result.file).toBe("test.ts");
    expect(result.rawTokens).toBeGreaterThan(0);
    expect(result.irL0Tokens).toBeGreaterThan(0);
    expect(result.irL1Tokens).toBeGreaterThan(0);
    expect(result.irL1Tokens).toBeLessThanOrEqual(result.rawTokens);
    expect(result.savedPercent).toBeGreaterThanOrEqual(0);
    expect(result.savedPercent).toBeLessThan(100);
    expect(result.engine).toBe("AST");
  });
});

describe("summarize", () => {
  it("aggregates multiple file results", () => {
    const results = [
      { file: "a.ts", rawTokens: 100, irL0Tokens: 20, irL1Tokens: 30, savedPercent: 70, engine: "AST" as const },
      { file: "b.ts", rawTokens: 200, irL0Tokens: 40, irL1Tokens: 50, savedPercent: 75, engine: "FP" as const },
    ];
    const summary = summarize(results);
    expect(summary.totalRaw).toBe(300);
    expect(summary.totalIRL1).toBe(80);
    expect(summary.totalSavedPercent).toBeCloseTo(73.3, 0);
    expect(summary.astCount).toBe(1);
    expect(summary.fpCount).toBe(1);
    expect(summary.fileCount).toBe(2);
  });
});
