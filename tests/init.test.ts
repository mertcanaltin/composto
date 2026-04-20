import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/cli/init.js";

describe("composto init — Cursor configuration", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "composto-init-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates .cursor/mcp.json with composto server when none exists", () => {
    runInit(tmp, { client: "cursor" });
    const mcpPath = join(tmp, ".cursor", "mcp.json");
    expect(existsSync(mcpPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(mcpPath, "utf-8"));
    expect(cfg.mcpServers.composto.command).toBe("composto-mcp");
  });

  it("creates .cursor/rules/composto.mdc when none exists", () => {
    runInit(tmp, { client: "cursor" });
    const rulePath = join(tmp, ".cursor", "rules", "composto.mdc");
    expect(existsSync(rulePath)).toBe(true);
    const content = readFileSync(rulePath, "utf-8");
    expect(content).toContain("alwaysApply: true");
    expect(content).toContain("composto_blastradius");
  });

  it("merges into existing mcp.json without removing other servers", () => {
    mkdirSync(join(tmp, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other-mcp" } } }, null, 2),
    );
    runInit(tmp, { client: "cursor" });
    const cfg = JSON.parse(readFileSync(join(tmp, ".cursor", "mcp.json"), "utf-8"));
    expect(cfg.mcpServers.other.command).toBe("other-mcp");
    expect(cfg.mcpServers.composto.command).toBe("composto-mcp");
  });

  it("skips existing .cursor/rules/composto.mdc — does not overwrite user edits", () => {
    mkdirSync(join(tmp, ".cursor", "rules"), { recursive: true });
    writeFileSync(join(tmp, ".cursor", "rules", "composto.mdc"), "USER EDITS");
    runInit(tmp, { client: "cursor" });
    expect(readFileSync(join(tmp, ".cursor", "rules", "composto.mdc"), "utf-8")).toBe("USER EDITS");
  });

  it("is idempotent — running twice does not duplicate the composto server", () => {
    runInit(tmp, { client: "cursor" });
    runInit(tmp, { client: "cursor" });
    const cfg = JSON.parse(readFileSync(join(tmp, ".cursor", "mcp.json"), "utf-8"));
    expect(cfg.mcpServers.composto.command).toBe("composto-mcp");
    expect(Object.keys(cfg.mcpServers).length).toBe(1);
  });

  it("returns a summary describing what changed", () => {
    const result = runInit(tmp, { client: "cursor" });
    expect(result.written).toContain(".cursor/mcp.json");
    expect(result.written).toContain(".cursor/rules/composto.mdc");
    expect(result.skipped).toEqual([]);
  });

  it("reports skipped files in summary on second run", () => {
    runInit(tmp, { client: "cursor" });
    const result = runInit(tmp, { client: "cursor" });
    expect(result.skipped).toContain(".cursor/rules/composto.mdc");
  });
});

describe("composto init — defaults", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "composto-init-default-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("defaults to cursor when no client is specified", () => {
    const result = runInit(tmp, {});
    expect(result.client).toBe("cursor");
    expect(existsSync(join(tmp, ".cursor", "mcp.json"))).toBe(true);
  });
});
