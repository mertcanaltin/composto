import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/cli/init.js";

// Cursor and Gemini CLI are MCP-only integrations now — the PreToolUse/BeforeTool
// risk-gate hook was removed in the fast-map consolidation. MCP registration is
// their primary (default-on) wiring.
describe("composto init — Cursor configuration", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "composto-init-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes .cursor/mcp.json with the composto server (no env) by default", () => {
    runInit(tmp, { client: "cursor" });
    const cfg = JSON.parse(readFileSync(join(tmp, ".cursor", "mcp.json"), "utf-8"));
    expect(cfg.mcpServers.composto.command).toBe("composto-mcp");
    expect(cfg.mcpServers.composto.env).toBeUndefined();
  });

  it("does NOT write hooks.json (cursor is MCP-only now)", () => {
    runInit(tmp, { client: "cursor" });
    expect(existsSync(join(tmp, ".cursor", "hooks.json"))).toBe(false);
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

  it("is idempotent — running twice does not duplicate the composto server", () => {
    runInit(tmp, { client: "cursor" });
    runInit(tmp, { client: "cursor" });
    const cfg = JSON.parse(readFileSync(join(tmp, ".cursor", "mcp.json"), "utf-8"));
    expect(cfg.mcpServers.composto.command).toBe("composto-mcp");
    expect(Object.keys(cfg.mcpServers).length).toBe(1);
  });

  it("does NOT write .cursor/rules/composto.mdc by default", () => {
    runInit(tmp, { client: "cursor" });
    expect(existsSync(join(tmp, ".cursor", "rules", "composto.mdc"))).toBe(false);
  });

  it("writes a slim ir/context rules file when withRules: true", () => {
    runInit(tmp, { client: "cursor", withRules: true });
    const rulePath = join(tmp, ".cursor", "rules", "composto.mdc");
    expect(existsSync(rulePath)).toBe(true);
    const content = readFileSync(rulePath, "utf-8");
    expect(content).toContain("alwaysApply: true");
    expect(content).toContain("composto_ir");
    expect(content).toContain("composto_context");
    // The dead blastradius/scan tooling must not be referenced anymore.
    expect(content).not.toContain("composto_blastradius");
  });

  it("skips an existing rules file — does not overwrite user edits", () => {
    mkdirSync(join(tmp, ".cursor", "rules"), { recursive: true });
    writeFileSync(join(tmp, ".cursor", "rules", "composto.mdc"), "USER EDITS");
    runInit(tmp, { client: "cursor", withRules: true });
    expect(readFileSync(join(tmp, ".cursor", "rules", "composto.mdc"), "utf-8")).toBe("USER EDITS");
  });
});

describe("composto init — Gemini CLI configuration", () => {
  let tmp: string;
  let settingsPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "composto-init-gem-"));
    settingsPath = join(tmp, "fake-home", ".gemini", "settings.json");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("registers the composto MCP server (no env, no hooks)", () => {
    runInit(tmp, { client: "gemini-cli", geminiSettingsPath: settingsPath });
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.mcpServers?.composto?.command).toBe("composto-mcp");
    expect(settings.mcpServers.composto.env).toBeUndefined();
    expect(settings.hooks).toBeUndefined();
  });

  it("preserves unrelated settings when merging", () => {
    mkdirSync(join(tmp, "fake-home", ".gemini"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }, null, 2));
    runInit(tmp, { client: "gemini-cli", geminiSettingsPath: settingsPath });
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.theme).toBe("dark");
    expect(settings.mcpServers.composto.command).toBe("composto-mcp");
  });

  it("captures a write failure in result.skipped instead of throwing", () => {
    const unwritable = "/dev/null/composto-gemini-settings.json";
    let result: ReturnType<typeof runInit> | undefined;
    expect(() => {
      result = runInit(tmp, { client: "gemini-cli", geminiSettingsPath: unwritable });
    }).not.toThrow();
    expect(result).toBeDefined();
    const skippedHit = result!.skipped.find((s) => /write failed/.test(s));
    expect(skippedHit).toBeDefined();
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

  it("defaults to claude-code when no client is specified", () => {
    const result = runInit(tmp, {});
    expect(result.client).toBe("claude-code");
    expect(existsSync(join(tmp, ".claude", "settings.json"))).toBe(true);
  });
});
