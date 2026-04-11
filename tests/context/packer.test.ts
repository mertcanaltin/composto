import { describe, it, expect } from "vitest";
import { packContext } from "../../src/context/packer.ts";

describe("packContext", () => {
  const files = [
    { path: "src/big.ts", code: "export function big() {\n  const x = 1;\n  return x;\n}", rawTokens: 500 },
    { path: "src/small.ts", code: "export function small() { return 1; }", rawTokens: 100 },
    { path: "src/medium.ts", code: "export function med() {\n  if (true) return 2;\n}", rawTokens: 300 },
  ];

  it("returns all L0 when budget is very small", async () => {
    // L0 representations are very compact (~5-6 tokens each).
    // Use a budget that fits L0 but leaves no room for L1 upgrades.
    const result = await packContext(files, { budget: 20, hotspots: [] });
    expect(result.entries.every(e => e.layer === "L0")).toBe(true);
    expect(result.totalTokens).toBeLessThanOrEqual(20);
  });

  it("upgrades files to L1 when budget allows", async () => {
    const result = await packContext(files, { budget: 5000, hotspots: [] });
    expect(result.entries.some(e => e.layer === "L1")).toBe(true);
    expect(result.totalTokens).toBeLessThanOrEqual(5000);
  });

  it("prioritizes hotspot files for L1 upgrade", async () => {
    const hotspots = [{ file: "src/small.ts", changesInLast30Commits: 15, bugFixRatio: 0.6, authorCount: 3 }];
    const result = await packContext(files, { budget: 300, hotspots });
    const smallEntry = result.entries.find(e => e.path === "src/small.ts");
    expect(smallEntry?.layer).toBe("L1");
  });

  it("never exceeds the budget", async () => {
    const result = await packContext(files, { budget: 50, hotspots: [] });
    expect(result.totalTokens).toBeLessThanOrEqual(50);
  });
});
