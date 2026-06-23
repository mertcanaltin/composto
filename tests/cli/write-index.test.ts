import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeProjectIndex } from "../../src/cli/commands.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "composto-index-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(
    join(dir, "src", "a.ts"),
    "export function alpha(x: number): number {\n  return x > 0 ? x : -x;\n}\n"
  );
  writeFileSync(join(dir, "src", "b.ts"), "export const beta = 2;\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("writeProjectIndex", () => {
  it("writes a navigation map with a self-describing header and a staleness stamp", async () => {
    const out = join(dir, ".composto", "context.md");
    const r = await writeProjectIndex(dir, 4000, out);

    expect(existsSync(out)).toBe(true);
    const content = readFileSync(out, "utf8");
    // self-describing: tells the agent it's a map, not raw, and how to refresh
    expect(content).toContain("Composto navigation map");
    expect(content).toContain("COMPRESSED MAP");
    expect(content).toContain("composto reindex");
    // staleness stamp (no git here → "unknown", but the field must be present)
    expect(r.sha).toBeTruthy();
    expect(content).toContain(r.sha);
    // includes the files as IR entries
    expect(content).toContain("## src/a.ts");
    expect(content).toContain("FN:alpha");
    expect(r.files).toBe(2);
    expect(r.tokens).toBeGreaterThan(0);
  });

  it("creates the .composto directory if missing", async () => {
    const out = join(dir, "nested", "deep", "ctx.md");
    await writeProjectIndex(dir, 4000, out);
    expect(existsSync(out)).toBe(true);
  });
});
