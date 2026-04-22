// Gemini CLI BeforeTool hook adapter.
// Gemini CLI's BeforeTool envelope mirrors Claude Code's PreToolUse shape:
// { hookSpecificOutput: { hookEventName, additionalContext } }. We emit a
// composto verdict block on medium|high|unknown verdicts for file-targeting
// tools (edit_file, write_file, replace — normalization lives in extract.ts).
// Passthrough is { hookSpecificOutput: {} }. Hooks MUST NEVER block the agent,
// so every failure mode (JSON parse, non-object payload, extract miss,
// thrown error from the API) returns passthrough.
//
// Note on hookEventName: the Phase 1 plan specifies "BeforeTool" as Gemini
// CLI's event name. If a future Gemini CLI revision standardizes on a
// different literal, update here. The passthrough shape is the same
// regardless, so misconfiguration degrades to passthrough rather than a
// broken envelope.
// Opportunity for shared formatter in P1.1d cleanup — both CC and Gemini CLI
// currently duplicate `formatContext`.
// formatContext duplicated from claude-code.ts (identical wording) — see
// header note about P1.1d cleanup.

import { extractFilePath, type ToolInvocation } from "../extract.js";
import { type HookDeps, defaultDeps } from "../api-deps.js";
import { join } from "node:path";
import type { BlastRadiusResponse } from "../../../memory/types.js";

interface HookOpts {
  stdin: string;
  cwd: string;
}

interface BeforeToolOutput {
  hookSpecificOutput?: {
    hookEventName?: "BeforeTool";
    additionalContext?: string;
  };
}

export async function runGeminiCliHook(
  opts: HookOpts,
  deps: HookDeps = defaultDeps,
): Promise<BeforeToolOutput> {
  const passthrough: BeforeToolOutput = { hookSpecificOutput: {} };
  let payload: unknown;
  try {
    payload = JSON.parse(opts.stdin);
  } catch {
    return passthrough;
  }
  if (typeof payload !== "object" || payload === null) return passthrough;

  const filePath = extractFilePath(payload as ToolInvocation);
  if (!filePath) return passthrough;

  try {
    const dbPath = join(opts.cwd, ".composto", "memory.db");
    const api = deps.makeApi({ dbPath, repoPath: opts.cwd });
    try {
      const res = await api.blastradius({ file: filePath });
      if (!res || res.verdict === "low") return passthrough;
      const body = formatContext(filePath, res);
      return {
        hookSpecificOutput: {
          hookEventName: "BeforeTool",
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
