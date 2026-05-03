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

  it("does NOT write .cursor/mcp.json by default (Lean Hook v0.7.0)", () => {
    runInit(tmp, { client: "cursor" });
    expect(existsSync(join(tmp, ".cursor", "mcp.json"))).toBe(false);
  });

  it("writes .cursor/mcp.json with composto server when withMcp: true", () => {
    runInit(tmp, { client: "cursor", withMcp: true });
    const cfg = JSON.parse(readFileSync(join(tmp, ".cursor", "mcp.json"), "utf-8"));
    expect(cfg.mcpServers.composto.command).toBe("composto-mcp");
  });

  it("sets COMPOSTO_BLASTRADIUS=1 env on the cursor MCP server entry when withMcp: true", () => {
    runInit(tmp, { client: "cursor", withMcp: true });
    const cfg = JSON.parse(
      readFileSync(join(tmp, ".cursor", "mcp.json"), "utf-8"),
    );
    expect(cfg.mcpServers.composto.env?.COMPOSTO_BLASTRADIUS).toBe("1");
  });

  it("upgrades a legacy mcp.json (composto entry without env) by adding the env block when withMcp: true", () => {
    mkdirSync(join(tmp, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp, ".cursor", "mcp.json"),
      JSON.stringify(
        { mcpServers: { composto: { command: "composto-mcp" } } },
        null,
        2,
      ),
    );
    runInit(tmp, { client: "cursor", withMcp: true });
    const cfg = JSON.parse(
      readFileSync(join(tmp, ".cursor", "mcp.json"), "utf-8"),
    );
    expect(cfg.mcpServers.composto.env?.COMPOSTO_BLASTRADIUS).toBe("1");
  });

  it("default init leaves an existing mcp.json untouched (no composto entry added)", () => {
    mkdirSync(join(tmp, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other-mcp" } } }, null, 2),
    );
    runInit(tmp, { client: "cursor" });
    const cfg = JSON.parse(readFileSync(join(tmp, ".cursor", "mcp.json"), "utf-8"));
    expect(cfg.mcpServers.other.command).toBe("other-mcp");
    expect(cfg.mcpServers.composto).toBeUndefined();
  });

  it("does NOT write .cursor/rules/composto.mdc by default (Lean Hook v0.7.0)", () => {
    runInit(tmp, { client: "cursor" });
    const rulePath = join(tmp, ".cursor", "rules", "composto.mdc");
    expect(existsSync(rulePath)).toBe(false);
  });

  it("writes .cursor/rules/composto.mdc when withRules: true", () => {
    runInit(tmp, { client: "cursor", withRules: true });
    const rulePath = join(tmp, ".cursor", "rules", "composto.mdc");
    expect(existsSync(rulePath)).toBe(true);
    const content = readFileSync(rulePath, "utf-8");
    expect(content).toContain("alwaysApply: true");
    expect(content).toContain("composto_blastradius");
  });

  it("merges into existing mcp.json without removing other servers when withMcp: true", () => {
    mkdirSync(join(tmp, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other-mcp" } } }, null, 2),
    );
    runInit(tmp, { client: "cursor", withMcp: true });
    const cfg = JSON.parse(readFileSync(join(tmp, ".cursor", "mcp.json"), "utf-8"));
    expect(cfg.mcpServers.other.command).toBe("other-mcp");
    expect(cfg.mcpServers.composto.command).toBe("composto-mcp");
  });

  it("skips existing .cursor/rules/composto.mdc — does not overwrite user edits when withRules: true", () => {
    mkdirSync(join(tmp, ".cursor", "rules"), { recursive: true });
    writeFileSync(join(tmp, ".cursor", "rules", "composto.mdc"), "USER EDITS");
    runInit(tmp, { client: "cursor", withRules: true });
    expect(readFileSync(join(tmp, ".cursor", "rules", "composto.mdc"), "utf-8")).toBe("USER EDITS");
  });

  it("is idempotent — running twice with withMcp does not duplicate the composto server", () => {
    runInit(tmp, { client: "cursor", withMcp: true });
    runInit(tmp, { client: "cursor", withMcp: true });
    const cfg = JSON.parse(readFileSync(join(tmp, ".cursor", "mcp.json"), "utf-8"));
    expect(cfg.mcpServers.composto.command).toBe("composto-mcp");
    expect(Object.keys(cfg.mcpServers).length).toBe(1);
  });

  it("default summary includes hooks.json but NOT mcp.json or the rules file", () => {
    const result = runInit(tmp, { client: "cursor" });
    expect(result.written).not.toContain(".cursor/mcp.json");
    expect(result.written).not.toContain(".cursor/rules/composto.mdc");
    expect(result.skipped).toEqual([]);
  });

  it("withRules: true summary includes the rules file in written on first run, skipped on second", () => {
    const first = runInit(tmp, { client: "cursor", withRules: true });
    expect(first.written).toContain(".cursor/rules/composto.mdc");
    const second = runInit(tmp, { client: "cursor", withRules: true });
    expect(second.skipped).toContain(".cursor/rules/composto.mdc");
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
    expect(existsSync(join(tmp, ".cursor", "hooks.json"))).toBe(true);
  });
});
