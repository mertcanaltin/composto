import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/cli/init.js";

const POST_RE = /composto hook claude-code posttooluse/;

// ----------------------------------------------------------------------------
// Claude Code — PostToolUse compress-read hook (the core value)
// ----------------------------------------------------------------------------
describe("composto init — claude-code hook wiring", () => {
  it("writes .claude/settings.json with the PostToolUse compress hook and NO mcpServers by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-initcc-"));
    try {
      runInit(dir, { client: "claude-code" });
      const settings = JSON.parse(
        readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.mcpServers?.composto).toBeUndefined();
      const post = settings.hooks?.PostToolUse;
      expect(Array.isArray(post)).toBe(true);
      const composto = post.find((h: any) =>
        POST_RE.test(h.hooks?.[0]?.command ?? ""),
      );
      expect(composto).toBeDefined();
      expect(composto.matcher).toBe("Read");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("registers MCP server (no env) on claude-code when withMcp: true", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-initcc-"));
    try {
      runInit(dir, { client: "claude-code", withMcp: true });
      const settings = JSON.parse(
        readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.mcpServers?.composto?.command).toBe("composto-mcp");
      expect(settings.mcpServers.composto.env).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("withCompress: false leaves the file without a composto PostToolUse hook", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-initcc-"));
    try {
      runInit(dir, { client: "claude-code", withCompress: false });
      const settings = JSON.parse(
        readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
      );
      const post = settings.hooks?.PostToolUse ?? [];
      expect(post.some((h: any) => POST_RE.test(h.hooks?.[0]?.command ?? ""))).toBe(false);
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
              PostToolUse: [
                {
                  matcher: "Read",
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
      const post = settings.hooks.PostToolUse;
      expect(post.some((h: any) => h.hooks?.[0]?.command === "user-existing-hook")).toBe(true);
      expect(post.some((h: any) => POST_RE.test(h.hooks?.[0]?.command ?? ""))).toBe(true);
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
      const post = settings.hooks.PostToolUse;
      const compostoEntries = post.filter((h: any) =>
        POST_RE.test(h.hooks?.[0]?.command ?? ""),
      );
      expect(compostoEntries.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
