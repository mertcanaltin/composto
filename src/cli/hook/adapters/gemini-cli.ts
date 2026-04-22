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

import { extractFilePath, type ToolInvocation } from "../extract.js";
import { type HookDeps, defaultDeps } from "../api-deps.js";
import { formatBlastRadiusContext } from "../format.js";
import { join } from "node:path";

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
      const body = formatBlastRadiusContext(filePath, res);
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
