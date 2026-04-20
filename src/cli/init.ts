import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type InitClient = "cursor";

export interface InitOptions {
  client?: InitClient;
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
}

export function runInit(projectPath: string, options: InitOptions): InitResult {
  const client: InitClient = options.client ?? "cursor";
  const result: InitResult = { client, written: [], skipped: [], merged: [] };
  initCursor(projectPath, result);
  return result;
}
