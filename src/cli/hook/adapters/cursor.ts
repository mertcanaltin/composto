// Cursor preToolUse hook adapter.
// Cursor drops additional_context silently (forum #155689), so this adapter
// uses the one channel that IS user-visible: permissionDecision. We only
// deny on verdict === "high" (justifies the interrupt). medium/low/unknown
// fall back to the .cursor/rules/composto.mdc rule that `composto init`
// writes — that keeps the agent calling composto_blastradius proactively
// without user-visible interrupts.

import { extractFilePath, type ToolInvocation } from "../extract.js";
import { type HookDeps, defaultDeps } from "../api-deps.js";
import { formatBlastRadiusContext } from "../format.js";
import { join } from "node:path";

interface HookOpts {
  stdin: string;
  cwd: string;
}

interface CursorPreToolUseOutput {
  permissionDecision?: "deny" | "allow" | "ask";
  permissionDecisionReason?: string;
}

const CURSOR_HINT =
  "this file's bug history suggests high risk — ask the user to confirm before editing.";

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
        permissionDecisionReason: formatBlastRadiusContext(filePath, res, { hint: CURSOR_HINT }),
      };
    } finally {
      await api.close();
    }
  } catch {
    return passthrough;
  }
}
