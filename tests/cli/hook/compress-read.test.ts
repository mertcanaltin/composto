import { describe, it, expect } from "vitest";
import { decideReadCompression } from "../../../src/cli/hook/compress-read.js";

// A code body large enough to clear the threshold and compress well.
function bigCode(): string {
  const fns = [];
  for (let i = 0; i < 40; i++) {
    fns.push(
      `export function handler${i}(req: Request, res: Response): void {\n` +
        `  const id = req.params.id;\n` +
        `  if (!id) { res.status(400).send("missing id"); return; }\n` +
        `  const record = db.lookup(id);\n` +
        `  if (record === null) { res.status(404).send("not found"); return; }\n` +
        `  res.json({ ok: true, record });\n` +
        `}`
    );
  }
  return `import { db } from "./db.js";\n\n` + fns.join("\n\n");
}

describe("decideReadCompression", () => {
  it("compresses a large full read of a code file and reports savings", async () => {
    const content = bigCode();
    const r = await decideReadCompression({ filePath: "src/handlers.ts", content, hasRange: false });
    expect(r.compress).toBe(true);
    expect(r.savedTokens).toBeGreaterThan(0);
    expect(r.outputTokens).toBeLessThan(r.rawTokens);
    expect(r.output).toContain("[composto]");
    expect(r.output).toContain("FN:handler0");
  });

  it("leaves ranged reads raw (precision/edit intent)", async () => {
    const content = bigCode();
    const r = await decideReadCompression({ filePath: "src/handlers.ts", content, hasRange: true });
    expect(r.compress).toBe(false);
    expect(r.output).toBe(content);
    expect(r.savedTokens).toBe(0);
    expect(r.reason).toContain("ranged");
  });

  it("leaves unsupported (non-code) files raw", async () => {
    const content = JSON.stringify({ a: 1, b: 2, c: "x".repeat(8000) });
    const r = await decideReadCompression({ filePath: "config.json", content, hasRange: false });
    expect(r.compress).toBe(false);
    expect(r.reason).toContain("unsupported");
  });

  it("leaves small files raw (below threshold)", async () => {
    const r = await decideReadCompression({ filePath: "src/tiny.ts", content: "export const x = 1;", hasRange: false });
    expect(r.compress).toBe(false);
    expect(r.reason).toContain("threshold");
  });

  it("never throws and always returns the raw content when not compressing", async () => {
    const content = "export const y = 2;";
    const r = await decideReadCompression({ filePath: "src/tiny.ts", content, hasRange: false });
    expect(r.output).toBe(content);
    expect(r.rawTokens).toBeGreaterThan(0);
  });
});
