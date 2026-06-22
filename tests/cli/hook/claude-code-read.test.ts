import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClaudeCodePostRead } from "../../../src/cli/hook/adapters/claude-code-read.js";

function bigCode(): string {
  const fns = [];
  for (let i = 0; i < 40; i++) {
    fns.push(
      `export function handler${i}(req: Request, res: Response): void {\n` +
        `  const id = req.params.id;\n` +
        `  if (!id) { res.status(400).send("missing id"); return; }\n` +
        `  res.json({ ok: true, id });\n}`
    );
  }
  return `import { db } from "./db.js";\n\n` + fns.join("\n\n");
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "composto-postread-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runClaudeCodePostRead", () => {
  it("replaces a large code Read with IR via updatedToolOutput and records savings", async () => {
    const file = join(dir, "handlers.ts");
    writeFileSync(file, bigCode());
    const stdin = JSON.stringify({ tool_name: "Read", tool_input: { file_path: file } });

    const res = await runClaudeCodePostRead({ stdin, cwd: dir, now: 1000 });
    const env = res.envelope as { hookSpecificOutput?: { updatedToolOutput?: string } };

    expect(env.hookSpecificOutput?.updatedToolOutput).toBeTruthy();
    expect(env.hookSpecificOutput!.updatedToolOutput).toContain("[composto]");
    expect(env.hookSpecificOutput!.updatedToolOutput).toContain("FN:handler0");
    expect(res.metadata.verdict).toBe("compressed");

    // savings counter persisted
    const savings = JSON.parse(readFileSync(join(dir, ".composto", "savings.json"), "utf8"));
    expect(savings.totalSavedTokens).toBeGreaterThan(0);
    expect(savings.compressedReads).toBe(1);
  });

  it("passes through a ranged read untouched (no compression, no savings)", async () => {
    const file = join(dir, "handlers.ts");
    writeFileSync(file, bigCode());
    const stdin = JSON.stringify({ tool_name: "Read", tool_input: { file_path: file, offset: 10, limit: 20 } });

    const res = await runClaudeCodePostRead({ stdin, cwd: dir, now: 1000 });
    const env = res.envelope as { hookSpecificOutput?: { updatedToolOutput?: string } };

    expect(env.hookSpecificOutput?.updatedToolOutput).toBeUndefined();
    expect(existsSync(join(dir, ".composto", "savings.json"))).toBe(false);
  });

  it("passes through non-Read tools", async () => {
    const stdin = JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } });
    const res = await runClaudeCodePostRead({ stdin, cwd: dir, now: 1000 });
    const env = res.envelope as { hookSpecificOutput?: { updatedToolOutput?: string } };
    expect(env.hookSpecificOutput?.updatedToolOutput).toBeUndefined();
  });

  it("passes through when the file cannot be read", async () => {
    const stdin = JSON.stringify({ tool_name: "Read", tool_input: { file_path: join(dir, "missing.ts") } });
    const res = await runClaudeCodePostRead({ stdin, cwd: dir, now: 1000 });
    const env = res.envelope as { hookSpecificOutput?: { updatedToolOutput?: string } };
    expect(env.hookSpecificOutput?.updatedToolOutput).toBeUndefined();
  });

  it("never throws on malformed stdin", async () => {
    const res = await runClaudeCodePostRead({ stdin: "not json", cwd: dir, now: 1000 });
    expect(res.metadata.filePath).toBeNull();
  });
});
