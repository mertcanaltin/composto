import { describe, it, expect } from "vitest";
import { BENCHMARK_PROMPTS } from "../../src/benchmark/quality.js";

describe("BENCHMARK_PROMPTS", () => {
  it("has at least 5 different prompt scenarios", () => {
    expect(BENCHMARK_PROMPTS.length).toBeGreaterThanOrEqual(5);
  });

  it("covers understand, fix-bug, review, explain, refactor scenarios", () => {
    const ids = BENCHMARK_PROMPTS.map(p => p.id);
    expect(ids).toContain("understand");
    expect(ids).toContain("fix-bug");
    expect(ids).toContain("review");
    expect(ids).toContain("explain");
    expect(ids).toContain("refactor");
  });

  it("each prompt has id, label, and template with {code} placeholder", () => {
    for (const prompt of BENCHMARK_PROMPTS) {
      expect(prompt.id).toBeTruthy();
      expect(prompt.label).toBeTruthy();
      expect(prompt.template).toBeTruthy();
      expect(prompt.template).toContain("{code}");
    }
  });

  it("all prompt ids are unique", () => {
    const ids = BENCHMARK_PROMPTS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
