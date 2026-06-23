import { describe, it, expect } from "vitest";
import {
  generateIR,
  buildContext,
  compressMessages,
  estimateTokens,
  resolveTarget,
} from "../../src/core/index.js";

const SAMPLE = `import { db } from "./db.js";

export function loadUser(id: string): User | null {
  if (!id) return null;
  const found = db.lookup(id);
  return found ?? null;
}`;

describe("composto-ai/core SDK surface", () => {
  it("generateIR compresses a file to IR (fewer tokens, structure kept)", async () => {
    const ir = await generateIR(SAMPLE, "user.ts");
    expect(ir).toContain("FN:loadUser");
    expect(estimateTokens(ir)).toBeLessThan(estimateTokens(SAMPLE));
  });

  it("buildContext packs files within a budget and reports tokens", async () => {
    const result = await buildContext(
      [
        { path: "user.ts", code: SAMPLE },
        { path: "db.ts", code: "export const db = { lookup(id: string) { return null; } };" },
      ],
      { budget: 2000, target: "loadUser" },
    );
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.totalTokens).toBeLessThanOrEqual(2000);
    expect(result.targetFile).toBe("user.ts");
  });

  it("compressMessages compresses code blocks in a chat array", async () => {
    const { stats } = await compressMessages([
      { role: "user", content: "Explain:\n```ts user.ts\n" + SAMPLE + "\n```" },
    ]);
    expect(stats.blocksCompressed).toBe(1);
    expect(stats.irTokens).toBeLessThan(stats.rawTokens);
  });

  it("resolveTarget reports how a symbol was matched", () => {
    const m = resolveTarget([{ path: "user.ts", code: SAMPLE, rawTokens: 0 }], "loadUser");
    expect(m?.matchedBy).toBe("declaration");
  });
});
