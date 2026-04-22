// Claude Code PreToolUse hook adapter.
// Emits { hookSpecificOutput: { hookEventName: "PreToolUse",
// additionalContext: "<composto verdict block>" } } for medium|high|unknown
// verdicts on file-targeting tools. Passes through (empty hookSpecificOutput)
// for low verdicts, non-file tools, and any failure mode — hooks MUST NEVER
// block the agent.

import { extractFilePath } from "../extract.js";
import { MemoryAPI } from "../../../memory/api.js";
import { join } from "node:path";
import type { BlastRadiusResponse } from "../../../memory/types.js";

interface HookOpts {
  stdin: string;
  cwd: string;
}

interface PreToolUseOutput {
  hookSpecificOutput?: {
    hookEventName?: "PreToolUse";
    additionalContext?: string;
  };
}

export async function runClaudeCodeHook(opts: HookOpts): Promise<PreToolUseOutput> {
  const passthrough: PreToolUseOutput = { hookSpecificOutput: {} };
  let payload: unknown;
  try {
    payload = JSON.parse(opts.stdin);
  } catch {
    return passthrough;
  }
  if (typeof payload !== "object" || payload === null) return passthrough;

  const filePath = extractFilePath(payload as Record<string, unknown>);
  if (!filePath) return passthrough;

  try {
    const dbPath = join(opts.cwd, ".composto", "memory.db");
    const api = new MemoryAPI({ dbPath, repoPath: opts.cwd });
    try {
      const res = await api.blastradius({ file: filePath });
      if (!res || res.verdict === "low") return passthrough;
      const body = formatContext(filePath, res);
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: body,
        },
      };
    } finally {
      await api.close();
    }
  } catch {
    return passthrough;
  }
}

function formatContext(filePath: string, res: BlastRadiusResponse): string {
  const firing = res.signals
    .filter((s) => s.strength > 0)
    .map((s) => `${s.type}=${s.strength.toFixed(2)}`)
    .join(", ");
  return [
    `<composto_blastradius>`,
    `  file: ${filePath}`,
    `  verdict: ${res.verdict}`,
    `  score: ${res.score.toFixed(2)} confidence: ${res.confidence.toFixed(2)}`,
    firing ? `  firing_signals: ${firing}` : `  firing_signals: (none)`,
    `  hint: this file's bug history may be relevant to your edit. See composto_blastradius for detail.`,
    `</composto_blastradius>`,
  ].join("\n");
}
