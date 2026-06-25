import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type InitClient = "cursor" | "claude-code" | "gemini-cli";

export interface InitOptions {
  client?: InitClient;
  /**
   * Override the Gemini CLI settings path (normally ~/.gemini/settings.json).
   * Used by tests to redirect writes away from the real user home.
   */
  geminiSettingsPath?: string;
  /**
   * Write the slim Composto rules file (cursor only). Opt-in. Tells the agent
   * to prefer composto_ir / composto_context over reading raw files.
   */
  withRules?: boolean;
  /**
   * Register the composto MCP server (composto_ir / composto_context /
   * composto_benchmark) so the agent can query the map directly. For
   * cursor/gemini-cli this is the primary integration (they have no hook).
   */
  withMcp?: boolean;
  /**
   * claude-code only: register the PostToolUse Read-compression hook. This is
   * Composto's core value — large full reads of code files are replaced with
   * structural IR before they enter the agent's context, saving tokens on
   * every subsequent turn (tallied in `composto stats`). Ranged reads stay raw
   * and non-wins fall back to the source. Defaults ON for claude-code.
   */
  withCompress?: boolean;
}

export interface InitResult {
  client: InitClient;
  written: string[];
  skipped: string[];
  merged: string[];
}

const CURSOR_RULES_MDC = `---
description: Composto MCP — prefer composto_ir / composto_context over reading raw files.
alwaysApply: true
---

# Composto MCP — when to use

This project has the \`composto\` MCP server registered. Prefer its tools over reading raw files.

## When you only need to know what a file does (not its exact code)

Call \`composto_ir\` with \`layer: "L1"\` instead of \`read_file\`. ~89% fewer tokens, same structural understanding. Use \`read_file\` only when you need exact strings, regexes, or formatting.

## When you need to trace a bug or feature across several files

Call \`composto_context\` with \`target: "<symbol-or-file>"\` and \`budget: 4000\` instead of opening 5 files individually. The target file comes back as raw code; surrounding files come back as compressed IR. One round-trip, full picture.

## Don't

- Don't call \`composto_benchmark\` unless the user explicitly asks about token savings.
- Don't compress a file the user explicitly asked to see in full.
`;

const MCP_SERVER = { command: "composto-mcp" } as const;

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function writeJsonMerged(
  filePath: string,
  patch: Record<string, unknown>,
  result: InitResult,
  relPath: string,
): void {
  ensureDir(filePath);
  if (existsSync(filePath)) {
    const existing = JSON.parse(readFileSync(filePath, "utf-8")) as {
      mcpServers?: Record<string, unknown>;
      [k: string]: unknown;
    };
    const mergedServers = {
      ...(existing.mcpServers ?? {}),
      ...((patch.mcpServers as Record<string, unknown>) ?? {}),
    };
    const merged = { ...existing, ...patch, mcpServers: mergedServers };
    writeFileSync(filePath, JSON.stringify(merged, null, 2) + "\n");
    result.merged.push(relPath);
  } else {
    writeFileSync(filePath, JSON.stringify(patch, null, 2) + "\n");
    result.written.push(relPath);
  }
}

function writeFileSkipIfExists(
  filePath: string,
  content: string,
  result: InitResult,
  relPath: string,
): void {
  ensureDir(filePath);
  if (existsSync(filePath)) {
    result.skipped.push(relPath);
    return;
  }
  writeFileSync(filePath, content);
  result.written.push(relPath);
}

/**
 * Append a composto hook entry to an existing hook array, de-duplicated on a
 * user-supplied key. Hook arrays are _additive_ (users may have their own
 * entries) so we never replace — we only append when our key is absent. This
 * keeps `composto init` idempotent across repeated runs.
 */
function mergeHookArray(
  existingHooks: unknown,
  newEntry: unknown,
  dedupKey: (entry: unknown) => string,
): unknown[] {
  const arr: unknown[] = Array.isArray(existingHooks) ? [...existingHooks] : [];
  const key = dedupKey(newEntry);
  if (arr.some((e) => dedupKey(e) === key)) return arr;
  arr.push(newEntry);
  return arr;
}

function readJsonIfExists(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    return (parsed && typeof parsed === "object" ? parsed : {}) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Cursor — MCP-only (no hook; the risk-gate hook was removed)
// ---------------------------------------------------------------------------

function initCursor(
  projectPath: string,
  result: InitResult,
  options: InitOptions,
): void {
  // Default to registering MCP — it's cursor's only integration now.
  if (options.withMcp !== false) {
    writeJsonMerged(
      join(projectPath, ".cursor", "mcp.json"),
      { mcpServers: { composto: MCP_SERVER } },
      result,
      ".cursor/mcp.json",
    );
  }
  if (options.withRules) {
    writeFileSkipIfExists(
      join(projectPath, ".cursor", "rules", "composto.mdc"),
      CURSOR_RULES_MDC,
      result,
      ".cursor/rules/composto.mdc",
    );
  }
}

// ---------------------------------------------------------------------------
// Claude Code — PostToolUse compress-read hook (the core value) + optional MCP
// ---------------------------------------------------------------------------

function initClaudeCode(
  projectPath: string,
  result: InitResult,
  options: InitOptions,
): void {
  const settingsPath = join(projectPath, ".claude", "settings.json");
  const relPath = ".claude/settings.json";
  const existed = existsSync(settingsPath);
  const existing = readJsonIfExists(settingsPath);

  const baseExistingMcp = (existing.mcpServers as Record<string, unknown>) ?? {};
  const mcpServers = options.withMcp
    ? { ...baseExistingMcp, composto: MCP_SERVER }
    : baseExistingMcp;

  const existingHooks = (existing.hooks as Record<string, unknown>) ?? {};
  const hooksOut: Record<string, unknown> = { ...existingHooks };

  // Compress-read hook is Composto's core value; default ON for claude-code.
  if (options.withCompress !== false) {
    const postReadEntry = {
      matcher: "Read",
      hooks: [
        { type: "command", command: "composto hook claude-code posttooluse" },
      ],
    };
    hooksOut.PostToolUse = mergeHookArray(
      existingHooks.PostToolUse,
      postReadEntry,
      (e) =>
        ((e as { hooks?: Array<{ command?: string }> })?.hooks?.[0]?.command) ?? "",
    );
  }

  const merged: Record<string, unknown> = { ...existing, hooks: hooksOut };
  if (Object.keys(mcpServers).length > 0) {
    merged.mcpServers = mcpServers;
  }
  ensureDir(settingsPath);
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  if (existed) result.merged.push(relPath);
  else result.written.push(relPath);
}

// ---------------------------------------------------------------------------
// Gemini CLI — MCP-only (user-global; tests MUST pass an override)
// ---------------------------------------------------------------------------

function initGeminiCli(
  _projectPath: string,
  result: InitResult,
  options: InitOptions,
): void {
  const settingsPath =
    options.geminiSettingsPath ?? join(homedir(), ".gemini", "settings.json");
  const relPath = settingsPath;
  // User-global HOME writes can fail in ways project-local writes cannot
  // (read-only HOME, dangling symlink, out-of-disk, locked-down CI). Catch the
  // whole write path and surface the failure via result.skipped.
  try {
    const existed = existsSync(settingsPath);
    const existing = readJsonIfExists(settingsPath);

    const baseExistingMcp = (existing.mcpServers as Record<string, unknown>) ?? {};
    const mcpServers = { ...baseExistingMcp, composto: MCP_SERVER };

    const merged: Record<string, unknown> = { ...existing, mcpServers };
    ensureDir(settingsPath);
    writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
    if (existed) result.merged.push(relPath);
    else result.written.push(relPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    result.skipped.push(`${settingsPath} (write failed: ${reason})`);
  }
}

export function runInit(projectPath: string, options: InitOptions): InitResult {
  const client: InitClient = options.client ?? "claude-code";
  const result: InitResult = { client, written: [], skipped: [], merged: [] };
  if (client === "claude-code") initClaudeCode(projectPath, result, options);
  else if (client === "gemini-cli") initGeminiCli(projectPath, result, options);
  else initCursor(projectPath, result, options);
  return result;
}
