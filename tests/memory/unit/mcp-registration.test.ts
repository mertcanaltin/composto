import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("MCP server — composto_blastradius registration", () => {
  it("includes composto_blastradius in the compiled bundle", () => {
    const bundle = readFileSync("dist/mcp/server.js", "utf-8");
    expect(bundle).toMatch(/composto_blastradius/);
  });
});
