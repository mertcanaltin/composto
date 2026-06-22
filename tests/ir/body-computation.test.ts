import { describe, it, expect } from "vitest";
import { astWalkIR } from "../../src/ir/ast-walker.js";

describe("body computation retention", () => {
  it("keeps an in-body const whose RHS is a boolean/comparison decision", async () => {
    const code = `export function pick(ir: string, code: string): string {
  const irIsWin = ir.trim().length > 0 && estimateTokens(ir) < estimateTokens(code);
  return irIsWin ? ir : code;
}`;
    const ir = await astWalkIR(code, "pick.ts");
    expect(ir).toContain("LET:irIsWin");
    expect(ir).toContain("estimateTokens(ir) < estimateTokens(code)");
  });

  it("keeps an in-body const whose RHS is a ternary decision (with its literals)", async () => {
    const code = `export function trend(x: string): string {
  const dir = x === "declining" ? "down" : x === "improving" ? "up" : "stable";
  return dir;
}`;
    const ir = await astWalkIR(code, "trend.ts");
    expect(ir).toContain("LET:dir");
    expect(ir).toContain('"stable"');
  });

  it("still drops trivial in-body copies/refs (compression preserved)", async () => {
    const code = `export function handle(req: Request): void {
  const id = req.params.id;
  const name = req.body.name;
  doThing(id, name);
}`;
    const ir = await astWalkIR(code, "handle.ts");
    expect(ir).not.toContain("LET:id");
    expect(ir).not.toContain("LET:name");
  });

  it("does not change module-level const handling", async () => {
    const code = `const THRESHOLD = 10;\nexport const FLAGS = { a: 1, b: 2 };`;
    const ir = await astWalkIR(code, "mod.ts");
    expect(ir).toContain("VAR:THRESHOLD = 10");
    expect(ir).toContain("VAR:FLAGS");
  });
});
