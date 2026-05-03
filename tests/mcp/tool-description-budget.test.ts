import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Lean Hook v0.7.0 budget: keep every tool description ≤ 80 chars and the
// total description budget under 500 chars. The descriptions ship to every
// MCP-registered conversation in the tools list, so we treat them as
// always-on system-prompt cost. Old descriptions averaged ~243 chars and
// totaled 1216, contributing measurable per-conversation overhead.

const SERVER_TS = resolve("src/mcp/server.ts");
const PER_TOOL_BUDGET = 80;
const TOTAL_BUDGET = 500;

function extractToolDescriptions(): Map<string, string> {
  const src = readFileSync(SERVER_TS, "utf-8");
  // Match `server.tool("name", "description", ...)` — name on one line,
  // description on the next line. The third arg (zod schema) follows.
  const re = /server\.tool\(\s*"(composto_[^"]+)",\s*"((?:[^"\\]|\\.)+)"/g;
  const out = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.set(m[1], m[2]);
  }
  return out;
}

describe("MCP tool descriptions — Lean Hook v0.7.0 budget", () => {
  const descs = extractToolDescriptions();

  it("registers all 5 known tools", () => {
    expect([...descs.keys()].sort()).toEqual([
      "composto_benchmark",
      "composto_blastradius",
      "composto_context",
      "composto_ir",
      "composto_scan",
    ]);
  });

  it("keeps every per-tool description at or below the 80-char budget", () => {
    const overages: Array<[string, number]> = [];
    for (const [name, desc] of descs) {
      if (desc.length > PER_TOOL_BUDGET) overages.push([name, desc.length]);
    }
    expect(overages, `over budget: ${JSON.stringify(overages)}`).toEqual([]);
  });

  it("keeps the total description budget at or below 500 chars", () => {
    let total = 0;
    for (const desc of descs.values()) total += desc.length;
    expect(total).toBeLessThanOrEqual(TOTAL_BUDGET);
  });
});
