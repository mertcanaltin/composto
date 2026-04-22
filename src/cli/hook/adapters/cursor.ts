// Cursor preToolUse hook adapter.
// Cursor drops additional_context silently (forum #155689), so this adapter
// uses the one channel that IS user-visible: permissionDecision. We only
// deny on verdict === "high" (justifies the interrupt). medium/low/unknown
// fall back to the .cursor/rules/composto.mdc rule that `composto init`
// writes — that keeps the agent calling composto_blastradius proactively
// without user-visible interrupts.

import { extractFilePath, type ToolInvocation } from "../extract.js";
import { type HookDeps, defaultDeps } from "../api-deps.js";
import { join } from "node:path";
import type { BlastRadiusResponse } from "../../../memory/types.js";

interface HookOpts {
  stdin: string;
  cwd: string;
}

interface CursorPreToolUseOutput {
  permissionDecision?: "deny" | "allow" | "ask";
  permissionDecisionReason?: string;
}

export async function runCursorHook(
  opts: HookOpts,
  deps: HookDeps = defaultDeps,
): Promise<CursorPreToolUseOutput> {
  const passthrough: CursorPreToolUseOutput = {};
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
      if (!res || res.verdict !== "high") return passthrough;
      return {
        permissionDecision: "deny",
        permissionDecisionReason: formatReason(filePath, res),
      };
    } finally {
      await api.close();
    }
  } catch {
    return passthrough;
  }
}

function formatReason(filePath: string, res: BlastRadiusResponse): string {
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
    `  hint: this file's bug history suggests high risk — ask the user to confirm before editing.`,
    `</composto_blastradius>`,
  ].join("\n");
}
