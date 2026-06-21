import { describe, it, expect } from "vitest";
import { generateL0, generateL1, generateLayer } from "../../src/ir/layers.js";

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
  it("generates IR for code", async () => {
    const code = [
      'import { useState } from "react";',
      "",
      "export function App() {",
      "  const count = 0;",
      "  return count;",
      "}",
    ].join("\n");

    const result = await generateL1(code, "App.ts", null);
    // AST-IR or regex fallback — both should produce meaningful output
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });

  it("uses AST walker for TypeScript files and produces compressed output", async () => {
    const code = 'import { x } from "y";\nexport function hello(name: string) {\n  if (name) {\n    return "Hi " + name;\n  }\n  return "Hi";\n}';
    const result = await generateLayer("L1", { code, filePath: "test.ts", health: null });
    expect(result).toContain("USE:");
    expect(result).toContain("FN:hello");
    expect(result).toContain("IF:");
    expect(result).toContain("RET");
  });

  it("includes health annotations when provided", async () => {
    const code = "export function broken() {\n  return null;\n}";
    const health = {
      churn: 15, fixRatio: 0.7, coverageTrend: "down" as const,
      staleness: "", authorCount: 3, consistency: "low" as const,
    };
    const result = await generateL1(code, "broken.ts", health);
    expect(result).toContain("[HOT:15/30 FIX:70% COV:↓ INCON]");
  });
});

describe("generateL1 — safety fallback", () => {
  it("falls back to raw when the IR would be empty (generated/data files)", async () => {
    // A data blob with no extractable structure: the walker emits nothing, so
    // the old `ir.length < code.length` guard returned the empty IR (reported
    // as "100% saved" but really total information loss).
    const code = 'module.exports = "' + "token ".repeat(300) + '";';
    const l1 = await generateL1(code, "data.js", null);
    expect(l1.trim().length).toBeGreaterThan(0); // never empty
    expect(l1).toBe(code); // falls back to the raw source
  });
});
