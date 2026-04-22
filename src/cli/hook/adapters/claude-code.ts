// Claude Code PreToolUse hook adapter.
// Emits { hookSpecificOutput: { hookEventName: "PreToolUse",
// additionalContext: "<composto verdict block>" } } for medium|high|unknown
// verdicts on file-targeting tools. Passes through (empty hookSpecificOutput)
// for low verdicts, non-file tools, and any failure mode — hooks MUST NEVER
// block the agent.

import { extractFilePath, type ToolInvocation } from "../extract.js";
import { type HookDeps, defaultDeps } from "../api-deps.js";
import { formatBlastRadiusContext } from "../format.js";
import { join } from "node:path";

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

export async function runClaudeCodeHook(
  opts: HookOpts,
  deps: HookDeps = defaultDeps,
): Promise<PreToolUseOutput> {
  const passthrough: PreToolUseOutput = { hookSpecificOutput: {} };
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
      const body = formatBlastRadiusContext(filePath, res);
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
