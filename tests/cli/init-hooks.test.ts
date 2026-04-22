import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/cli/init.js";

// ----------------------------------------------------------------------------
// Claude Code
// ----------------------------------------------------------------------------
describe("composto init — claude-code hook wiring", () => {
  it("writes .claude/settings.json with MCP + PreToolUse hook entry on fresh project", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-initcc-"));
    try {
      runInit(dir, { client: "claude-code" });
      const settings = JSON.parse(
        readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
      );
      // MCP server registered
      expect(settings.mcpServers?.composto?.command).toBe("composto-mcp");
      // PreToolUse hook entry for Edit|Write|MultiEdit
      const pre = settings.hooks?.PreToolUse;
      expect(Array.isArray(pre)).toBe(true);
      const composto = pre.find((h: any) =>
        /composto hook claude-code pretooluse/.test(h.hooks?.[0]?.command ?? ""),
      );
      expect(composto).toBeDefined();
      expect(composto.matcher).toMatch(/Edit|Write|MultiEdit/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merges into existing .claude/settings.json without destroying user hooks", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-initcc-"));
    try {
      mkdirSync(join(dir, ".claude"), { recursive: true });
      writeFileSync(
        join(dir, ".claude", "settings.json"),
        JSON.stringify(
          {
            hooks: {
              PreToolUse: [
                {
                  matcher: "Edit",
                  hooks: [{ type: "command", command: "user-existing-hook" }],
                },
              ],
            },
            model: "claude-3-5-sonnet",
          },
          null,
          2,
        ),
      );
      runInit(dir, { client: "claude-code" });
      const settings = JSON.parse(
        readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
      );
      const pre = settings.hooks.PreToolUse;
      expect(
        pre.some((h: any) => h.hooks?.[0]?.command === "user-existing-hook"),
      ).toBe(true);
      expect(
        pre.some((h: any) =>
          /composto hook claude-code pretooluse/.test(h.hooks?.[0]?.command ?? ""),
        ),
      ).toBe(true);
      // Preserve the user's other settings (model).
      expect(settings.model).toBe("claude-3-5-sonnet");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent — repeated init does not duplicate the composto hook entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-initcc-"));
    try {
      runInit(dir, { client: "claude-code" });
      runInit(dir, { client: "claude-code" });
      runInit(dir, { client: "claude-code" });
      const settings = JSON.parse(
        readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
      );
      const pre = settings.hooks.PreToolUse;
      const compostoEntries = pre.filter((h: any) =>
        /composto hook claude-code pretooluse/.test(h.hooks?.[0]?.command ?? ""),
      );
      expect(compostoEntries.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ----------------------------------------------------------------------------
// Cursor hook block
// ----------------------------------------------------------------------------
describe("composto init — cursor hook wiring", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "composto-initcur-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes .cursor/hooks.json alongside mcp.json and rules on fresh project", () => {
    runInit(tmp, { client: "cursor" });

    // Existing behavior preserved
    expect(existsSync(join(tmp, ".cursor", "mcp.json"))).toBe(true);
    expect(existsSync(join(tmp, ".cursor", "rules", "composto.mdc"))).toBe(true);

    // New: hooks.json
    const hooksPath = join(tmp, ".cursor", "hooks.json");
    expect(existsSync(hooksPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(hooksPath, "utf-8"));
    expect(cfg.version).toBe(1);
    expect(Array.isArray(cfg.hooks?.preToolUse)).toBe(true);
    const composto = cfg.hooks.preToolUse.find((e: any) =>
      /composto hook cursor pretooluse/.test(e.command ?? ""),
    );
    expect(composto).toBeDefined();
    expect(composto.matcher).toMatch(/Edit|Write/);
  });

  it("merges into existing .cursor/hooks.json without destroying user hooks", () => {
    mkdirSync(join(tmp, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmp, ".cursor", "hooks.json"),
      JSON.stringify(
        {
          version: 1,
          hooks: {
            preToolUse: [
              { matcher: "Edit", command: "user-existing-cursor-hook" },
            ],
            postToolUse: [
              { matcher: "Edit", command: "user-post-hook" },
            ],
          },
        },
        null,
        2,
      ),
    );
    runInit(tmp, { client: "cursor" });
    const cfg = JSON.parse(
      readFileSync(join(tmp, ".cursor", "hooks.json"), "utf-8"),
    );
    expect(cfg.version).toBe(1);
    expect(
      cfg.hooks.preToolUse.some(
        (e: any) => e.command === "user-existing-cursor-hook",
      ),
    ).toBe(true);
    expect(
      cfg.hooks.preToolUse.some((e: any) =>
        /composto hook cursor pretooluse/.test(e.command ?? ""),
      ),
    ).toBe(true);
    // Other top-level hook categories survive
    expect(
      cfg.hooks.postToolUse.some((e: any) => e.command === "user-post-hook"),
    ).toBe(true);
  });

  it("is idempotent — repeated init does not duplicate the composto cursor hook", () => {
    runInit(tmp, { client: "cursor" });
    runInit(tmp, { client: "cursor" });
    runInit(tmp, { client: "cursor" });
    const cfg = JSON.parse(
      readFileSync(join(tmp, ".cursor", "hooks.json"), "utf-8"),
    );
    const compostoEntries = cfg.hooks.preToolUse.filter((e: any) =>
      /composto hook cursor pretooluse/.test(e.command ?? ""),
    );
    expect(compostoEntries.length).toBe(1);
  });
});

// ----------------------------------------------------------------------------
// Gemini CLI — user-global, MUST use geminiSettingsPath override in tests
// ----------------------------------------------------------------------------
describe("composto init — gemini-cli hook wiring", () => {
  let tmp: string;
  let settingsPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "composto-initgem-"));
    settingsPath = join(tmp, "fake-home", ".gemini", "settings.json");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes Gemini CLI settings with MCP + BeforeTool hook entry on fresh file", () => {
    runInit(tmp, { client: "gemini-cli", geminiSettingsPath: settingsPath });
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.mcpServers?.composto?.command).toBe("composto-mcp");
    const before = settings.hooks?.BeforeTool;
    expect(Array.isArray(before)).toBe(true);
    const composto = before.find((h: any) =>
      /composto hook gemini-cli beforetool/.test(h.hooks?.[0]?.command ?? ""),
    );
    expect(composto).toBeDefined();
    expect(composto.matcher).toMatch(/edit_file|write_file|replace/);
  });

  it("merges into existing Gemini settings without destroying user hooks", () => {
    mkdirSync(join(tmp, "fake-home", ".gemini"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          theme: "dark",
          hooks: {
            BeforeTool: [
              {
                matcher: "edit_file",
                hooks: [{ type: "command", command: "user-gemini-hook" }],
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    runInit(tmp, { client: "gemini-cli", geminiSettingsPath: settingsPath });
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const before = settings.hooks.BeforeTool;
    expect(
      before.some((h: any) => h.hooks?.[0]?.command === "user-gemini-hook"),
    ).toBe(true);
    expect(
      before.some((h: any) =>
        /composto hook gemini-cli beforetool/.test(h.hooks?.[0]?.command ?? ""),
      ),
    ).toBe(true);
    // Preserve unrelated settings
    expect(settings.theme).toBe("dark");
  });

  it("is idempotent — repeated init does not duplicate the Gemini hook", () => {
    runInit(tmp, { client: "gemini-cli", geminiSettingsPath: settingsPath });
    runInit(tmp, { client: "gemini-cli", geminiSettingsPath: settingsPath });
    runInit(tmp, { client: "gemini-cli", geminiSettingsPath: settingsPath });
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const before = settings.hooks.BeforeTool;
    const compostoEntries = before.filter((h: any) =>
      /composto hook gemini-cli beforetool/.test(h.hooks?.[0]?.command ?? ""),
    );
    expect(compostoEntries.length).toBe(1);
  });
});
