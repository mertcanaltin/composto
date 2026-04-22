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
}

export interface InitResult {
  client: InitClient;
  written: string[];
  skipped: string[];
  merged: string[];
}

const CURSOR_RULES_MDC = `---
description: Composto MCP usage — tells the agent when to prefer composto_blastradius / composto_context / composto_ir / composto_scan over built-in file tools.
alwaysApply: true
---

# Composto MCP — when to use

This project has the \`composto\` MCP server registered. Prefer Composto tools over Cursor's built-in tools in the situations below.

## Before editing any existing file under \`src/\`, \`lib/\`, or \`app/\`

Call \`composto_blastradius\` with the target file path **first**, before proposing any edit.

- If \`verdict\` is \`high\`: surface the risk to the user before changing the file. Mention the strongest signal (e.g. "this file was reverted the last time it was touched", "high fix-ratio in recent history").
- If \`verdict\` is \`medium\`: note it briefly and proceed.
- If \`verdict\` is \`low\` or \`unknown\`: proceed without comment.

Skip this on test files, generated code, lockfiles, and anything in \`node_modules/\` or \`dist/\`.

## When the user says "fix this bug in X", "why does X return wrong value", or "trace X"

Call \`composto_context\` with \`target: "<symbol-or-file>"\` and \`budget: 4000\` instead of opening 5 files individually. The target file comes back as raw code; surrounding files come back as compressed IR. One round-trip, full picture.

## When you only need to know what a file does (not its exact code)

Call \`composto_ir\` with \`layer: "L1"\` instead of \`read_file\`. ~89% fewer tokens, same understanding. Use \`read_file\` only when you need exact strings, regexes, or formatting.

## Before staging commits / when reviewing diffs

Call \`composto_scan\` on the changed paths to catch hardcoded secrets, debug artifacts, and stray \`console.log\` calls before the user commits.

## Don't

- Don't call \`composto_benchmark\` unless the user explicitly asks about token savings.
- Don't run \`composto_blastradius\` on every read — only before edits.
- Don't compress a file the user explicitly asked to see in full.
`;

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
// Cursor
// ---------------------------------------------------------------------------

function writeCursorHooks(projectPath: string, result: InitResult): void {
  const hooksPath = join(projectPath, ".cursor", "hooks.json");
  const relPath = ".cursor/hooks.json";
  const existed = existsSync(hooksPath);
  const existing = readJsonIfExists(hooksPath);

  const existingHooks = (existing.hooks as Record<string, unknown>) ?? {};
  const compostoEntry = {
    matcher: "Edit|Write",
    command: "composto hook cursor pretooluse",
  };
  const preToolUse = mergeHookArray(
    existingHooks.preToolUse,
    compostoEntry,
    (e) => (e as { command?: string })?.command ?? "",
  );

  const merged: Record<string, unknown> = {
    ...existing,
    version: existing.version ?? 1,
    hooks: { ...existingHooks, preToolUse },
  };

  ensureDir(hooksPath);
  writeFileSync(hooksPath, JSON.stringify(merged, null, 2) + "\n");
  if (existed) result.merged.push(relPath);
  else result.written.push(relPath);
}

function initCursor(projectPath: string, result: InitResult): void {
  writeJsonMerged(
    join(projectPath, ".cursor", "mcp.json"),
    { mcpServers: { composto: { command: "composto-mcp" } } },
    result,
    ".cursor/mcp.json",
  );
  writeFileSkipIfExists(
    join(projectPath, ".cursor", "rules", "composto.mdc"),
    CURSOR_RULES_MDC,
    result,
    ".cursor/rules/composto.mdc",
  );
  writeCursorHooks(projectPath, result);
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

function initClaudeCode(projectPath: string, result: InitResult): void {
  const settingsPath = join(projectPath, ".claude", "settings.json");
  const relPath = ".claude/settings.json";
  const existed = existsSync(settingsPath);
  const existing = readJsonIfExists(settingsPath);

  const mcpServers = {
    ...((existing.mcpServers as Record<string, unknown>) ?? {}),
    composto: { command: "composto-mcp" },
  };

  const compostoHookEntry = {
    matcher: "Edit|Write|MultiEdit",
    hooks: [
      { type: "command", command: "composto hook claude-code pretooluse" },
    ],
  };
  const existingHooks = (existing.hooks as Record<string, unknown>) ?? {};
  const preToolUse = mergeHookArray(
    existingHooks.PreToolUse,
    compostoHookEntry,
    (e) =>
      ((e as { hooks?: Array<{ command?: string }> })?.hooks?.[0]?.command) ??
      "",
  );

  const merged = {
    ...existing,
    mcpServers,
    hooks: { ...existingHooks, PreToolUse: preToolUse },
  };
  ensureDir(settingsPath);
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  if (existed) result.merged.push(relPath);
  else result.written.push(relPath);
}

// ---------------------------------------------------------------------------
// Gemini CLI (user-global, not project-local — tests MUST pass an override)
// ---------------------------------------------------------------------------

function initGeminiCli(
  _projectPath: string,
  result: InitResult,
  options: InitOptions,
): void {
  const settingsPath =
    options.geminiSettingsPath ?? join(homedir(), ".gemini", "settings.json");
  const relPath = settingsPath;
  const existed = existsSync(settingsPath);
  const existing = readJsonIfExists(settingsPath);

  const mcpServers = {
    ...((existing.mcpServers as Record<string, unknown>) ?? {}),
    composto: { command: "composto-mcp" },
  };

  const compostoHookEntry = {
    matcher: "edit_file|write_file|replace",
    hooks: [
      { type: "command", command: "composto hook gemini-cli beforetool" },
    ],
  };
  const existingHooks = (existing.hooks as Record<string, unknown>) ?? {};
  const beforeTool = mergeHookArray(
    existingHooks.BeforeTool,
    compostoHookEntry,
    (e) =>
      ((e as { hooks?: Array<{ command?: string }> })?.hooks?.[0]?.command) ??
      "",
  );

  const merged = {
    ...existing,
    mcpServers,
    hooks: { ...existingHooks, BeforeTool: beforeTool },
  };
  ensureDir(settingsPath);
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  if (existed) result.merged.push(relPath);
  else result.written.push(relPath);
}

export function runInit(projectPath: string, options: InitOptions): InitResult {
  const client: InitClient = options.client ?? "cursor";
  const result: InitResult = { client, written: [], skipped: [], merged: [] };
  if (client === "claude-code") initClaudeCode(projectPath, result);
  else if (client === "gemini-cli") initGeminiCli(projectPath, result, options);
  else initCursor(projectPath, result);
  return result;
}
