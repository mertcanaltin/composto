import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Absolute path to the built CLI — some subtests run with cwd set to a fresh
// tmpdir, so `node dist/index.js` alone would not resolve.
const CLI = resolve(process.cwd(), "dist/index.js");

describe("composto init CLI — shell surface exposes all three clients", () => {
  it("accepts --client=claude-code and writes .claude/settings.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-initcli-cc-"));
    try {
      const out = execSync(`node ${CLI} init --client=claude-code`, {
        cwd: dir,
        encoding: "utf-8",
      });
      expect(out).toMatch(/configured for claude-code/);
      const settingsPath = join(dir, ".claude", "settings.json");
      expect(existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      expect(settings.mcpServers?.composto?.command).toBe("composto-mcp");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts --client=gemini-cli and writes to the override path when HOME is redirected", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-initcli-gem-"));
    try {
      // Override HOME so the user-global write lands inside the tmpdir.
      const env = { ...process.env, HOME: dir };
      const out = execSync(`node ${CLI} init --client=gemini-cli`, {
        cwd: dir,
        env,
        encoding: "utf-8",
      });
      expect(out).toMatch(/configured for gemini-cli/);
      const settingsPath = join(dir, ".gemini", "settings.json");
      expect(existsSync(settingsPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown --client with a clear error", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-initcli-bad-"));
    try {
      let status = 0;
      let stderr = "";
      try {
        execSync(`node ${CLI} init --client=not-a-client`, {
          cwd: dir,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        status = (err as { status?: number }).status ?? 0;
        stderr = (err as { stderr?: Buffer | string }).stderr?.toString() ?? "";
      }
      expect(status).toBe(1);
      expect(stderr).toMatch(/cursor/);
      expect(stderr).toMatch(/claude-code/);
      expect(stderr).toMatch(/gemini-cli/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists all three clients in the default help text", () => {
    const out = execSync(`node ${CLI}`, { encoding: "utf-8" });
    expect(out).toMatch(/cursor/);
    expect(out).toMatch(/claude-code/);
    expect(out).toMatch(/gemini-cli/);
  });
});
