// Claude Code PostToolUse hook adapter for the `Read` tool.
//
// Replaces a large raw-code Read result with compressed structural IR via
// `updatedToolOutput`, so the agent's context holds the compressed version
// instead of the raw source — a real, compounding token saving on every
// subsequent turn. The saving is tallied into a cumulative counter.
//
// MUST NEVER break the agent: any parse/IO/IR failure passes through the
// original output untouched (empty hookSpecificOutput).

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { decideReadCompression } from "../compress-read.js";
import { recordSavings } from "../../../telemetry/savings.js";
import type { ClaudeCodeResult } from "../types.js";

interface HookOpts {
  stdin: string;
  cwd: string;
  now?: number; // unix seconds, injectable for tests
}

interface PostReadEnvelope {
  hookSpecificOutput?: {
    hookEventName?: "PostToolUse";
    updatedToolOutput?: string;
  };
}

function passthrough(filePath: string | null = null): ClaudeCodeResult {
  return {
    envelope: { hookSpecificOutput: {} } as PostReadEnvelope,
    metadata: { filePath, verdict: null, score: null, confidence: null },
  };
}

export async function runClaudeCodePostRead(opts: HookOpts): Promise<ClaudeCodeResult> {
  let payload: { tool_name?: string; tool_input?: Record<string, unknown> };
  try {
    payload = JSON.parse(opts.stdin);
  } catch {
    return passthrough();
  }
  if (!payload || payload.tool_name !== "Read") return passthrough();

  const input = payload.tool_input ?? {};
  const fp = input.file_path ?? (input as Record<string, unknown>).path;
  if (typeof fp !== "string" || fp.length === 0) return passthrough();

  const hasRange = input.offset != null || input.limit != null;
  const abs = isAbsolute(fp) ? fp : join(opts.cwd, fp);

  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return passthrough(fp);
  }

  try {
    const decision = await decideReadCompression({ filePath: fp, content, hasRange });
    if (!decision.compress) return passthrough(fp);

    const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
    recordSavings(join(opts.cwd, ".composto"), decision.savedTokens, nowSec);
    process.stderr.write(
      `[composto] compressed read of ${fp}: ${decision.rawTokens}->${decision.outputTokens} tok (saved ${decision.savedTokens})\n`
    );

    return {
      envelope: {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          updatedToolOutput: decision.output,
        },
      } as PostReadEnvelope,
      metadata: { filePath: fp, verdict: "compressed", score: decision.savedTokens, confidence: null },
    };
  } catch {
    return passthrough(fp);
  }
}
