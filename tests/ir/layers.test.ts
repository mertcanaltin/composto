import { describe, it, expect } from "vitest";
import { generateL0, generateL1 } from "../../src/ir/layers.js";

describe("generateL0 — Structure Map", () => {
  it("generates compact structure map", () => {
    const code = [
      'import { useState } from "react";',
      "",
      "export function App() {",
      "  const x = 1;",
      "  if (x) {",
      "    return null;",
      "  }",
      "}",
      "",
      "function helper() {",
      "  return true;",
      "}",
    ].join("\n");

    const result = generateL0(code, "src/App.ts");
    expect(result).toContain("src/App.ts");
    expect(result).toContain("App");
    expect(result).toContain("helper");
    expect(result.split("\n").length).toBeLessThan(6);
  });
});

describe("generateL1 — Health-Aware Generic IR", () => {
  it("generates fingerprinted IR", () => {
    const code = [
      'import { useState } from "react";',
      "",
      "export function App() {",
      "  const count = 0;",
      "  return count;",
      "}",
    ].join("\n");

    const result = generateL1(code, null);
    expect(result).toContain("USE:react{useState}");
    expect(result).toContain("OUT FN:App()");
    expect(result).toContain("RET count");
  });

  it("includes health annotations when provided", () => {
    const code = "export function broken() {\n  return null;\n}";
    const health = {
      churn: 15, fixRatio: 0.7, coverageTrend: "down" as const,
      staleness: "", authorCount: 3, consistency: "low" as const,
    };
    const result = generateL1(code, health);
    expect(result).toContain("[HOT:15/30 FIX:70% COV:↓ INCON]");
  });
});
