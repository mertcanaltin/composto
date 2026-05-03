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
   * Lean Hook v0.7.0: rules file is opt-in. The agent learns Composto
   * exists from the hook envelope itself when there's a real signal,
   * so the always-on `composto.mdc` rules file (1940 chars × every turn)
   * is no longer the default. Pass `withRules: true` to restore the old
   * verbose teaching behavior.
   */
  withRules?: boolean;
  /**
   * Lean Hook v0.7.0: MCP server registration is opt-in. The hook
   * already exposes BlastRadius via the preToolUse envelope without
   * the agent needing tool-call permission. Registering the MCP
   * server adds 5 tool schemas (~300 tokens) to every conversation
   * and historically prompted the agent to call tools on every edit.
   * Pass `withMcp: true` to register the composto MCP server for
   * direct agent queries (composto_ir/_context/_scan/_blastradius).
   */
  withMcp?: boolean;
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

function initCursor(
  projectPath: string,
  result: InitResult,
  options: InitOptions,
): void {
  if (options.withMcp) {
    writeJsonMerged(
      join(projectPath, ".cursor", "mcp.json"),
      {
        mcpServers: {
          composto: {
            command: "composto-mcp",
            env: { COMPOSTO_BLASTRADIUS: "1" },
          },
        },
      },
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
  writeCursorHooks(projectPath, result);
}

// ---------------------------------------------------------------------------
// Claude Code
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
    ? {
        ...baseExistingMcp,
        composto: {
          command: "composto-mcp",
          env: { COMPOSTO_BLASTRADIUS: "1" },
        },
      }
    : baseExistingMcp;

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

  const merged: Record<string, unknown> = {
    ...existing,
    hooks: { ...existingHooks, PreToolUse: preToolUse },
  };
  // Only emit mcpServers if there's actually an entry to write — avoids
  // creating an empty mcpServers: {} on greenfield Lean Hook installs.
  if (Object.keys(mcpServers).length > 0) {
    merged.mcpServers = mcpServers;
  }
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
  // User-global HOME writes can fail in ways project-local writes cannot:
  // a read-only HOME, a symlink pointing nowhere, a path component that's a
  // character device (e.g. /dev/null/foo), an out-of-disk condition, or just
  // a filesystem permission surprise on locked-down CI. We catch the whole
  // write path and surface the failure via result.skipped so `runInit` can
  // still return normally — the user sees the reason instead of a crash.
  try {
    const existed = existsSync(settingsPath);
    const existing = readJsonIfExists(settingsPath);

    const baseExistingMcp = (existing.mcpServers as Record<string, unknown>) ?? {};
    const mcpServers = options.withMcp
      ? {
          ...baseExistingMcp,
          composto: {
            command: "composto-mcp",
            env: { COMPOSTO_BLASTRADIUS: "1" },
          },
        }
      : baseExistingMcp;

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

    const merged: Record<string, unknown> = {
      ...existing,
      hooks: { ...existingHooks, BeforeTool: beforeTool },
    };
    if (Object.keys(mcpServers).length > 0) {
      merged.mcpServers = mcpServers;
    }
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
  const client: InitClient = options.client ?? "cursor";
  const result: InitResult = { client, written: [], skipped: [], merged: [] };
  if (client === "claude-code") initClaudeCode(projectPath, result, options);
  else if (client === "gemini-cli") initGeminiCli(projectPath, result, options);
  else initCursor(projectPath, result, options);
  return result;
}
