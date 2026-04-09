import { describe, it, expect } from "vitest";
import { estimateTokens } from "../../src/benchmark/tokenizer.js";

describe("estimateTokens", () => {
  it("estimates tokens for simple text", () => {
    const result = estimateTokens("hello world");
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(10);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("counts code tokens reasonably", () => {
    const code = 'import { useState } from "react";';
    const tokens = estimateTokens(code);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(20);
  });

  it("handles multiline code", () => {
    const code = [
      'import { useState } from "react";',
      "",
      "export function App() {",
      "  const count = 0;",
      "  return count;",
      "}",
    ].join("\n");
    const tokens = estimateTokens(code);
    expect(tokens).toBeGreaterThan(15);
  });
});
