import { describe, it, expect } from "vitest";
import { collapseExpr } from "../../src/ir/ast-walker.js";
import { generateL1 } from "../../src/ir/layers.js";

describe("collapseExpr", () => {
  it("returns short expressions unchanged (normalized)", () => {
    expect(collapseExpr("a === b", 60)).toBe("a === b");
  });

  it("normalizes internal whitespace and newlines", () => {
    expect(collapseExpr("a   ===\n   b", 60)).toBe("a === b");
  });

  it("truncates long expressions with an ellipsis", () => {
    const long = "x".repeat(100);
    const out = collapseExpr(long, 60);
    expect(out.length).toBeLessThanOrEqual(60 + 40); // head + preserved tail budget
    expect(out).toContain("...");
  });

  it("preserves trailing string literals that fall past the cut", () => {
    // The decision values live at the end of a long ternary chain.
    const expr =
      'coverageTrend: decay?.trend === "declining" ? "down" : decay?.trend === "improving" ? "up" : "stable"';
    const out = collapseExpr(expr, 60);
    expect(out).toContain('"improving"');
    expect(out).toContain('"stable"');
  });

  it("does not duplicate literals already inside the head", () => {
    const expr = '"keepme" ' + "z".repeat(80) + ' "tail"';
    const out = collapseExpr(expr, 60);
    // "keepme" is in the head; it should not also appear in the appended set.
    expect(out.match(/"keepme"/g)?.length).toBe(1);
    expect(out).toContain('"tail"');
  });
});

describe("IR fidelity — branch values survive truncation", () => {
  it("retains ternary decision literals in a long return expression", async () => {
    const code = `export function trendOf(decay: { trend: string } | null) {
  return {
    coverageTrend: decay?.trend === "declining" ? "down" : decay?.trend === "improving" ? "up" : "stable",
  };
}`;
    const ir = await generateL1(code, "trend.ts", null);
    expect(ir).toContain("improving");
    expect(ir).toContain("stable");
  });
});
