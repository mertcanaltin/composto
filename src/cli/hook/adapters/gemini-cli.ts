// Gemini CLI BeforeTool hook adapter.
// Gemini CLI's BeforeTool envelope mirrors Claude Code's PreToolUse shape:
// { hookSpecificOutput: { hookEventName, additionalContext } }. We emit a
// composto verdict block on medium|high|unknown verdicts for file-targeting
// tools (edit_file, write_file, replace — normalization lives in extract.ts).
// Passthrough is { hookSpecificOutput: {} }. Hooks MUST NEVER block the agent,
// so every failure mode (JSON parse, non-object payload, extract miss,
// thrown error from the API) returns passthrough.
//
// Returns { envelope, metadata } so the CLI layer has full telemetry
// visibility without re-parsing additionalContext.

import { extractFilePath, type ToolInvocation } from "../extract.js";
import { type HookDeps, defaultDeps } from "../api-deps.js";
import { formatBlastRadiusContext } from "../format.js";
import { join } from "node:path";
import type { HookMetadata } from "./claude-code.js";

interface HookOpts {
  stdin: string;
  cwd: string;
}

interface BeforeToolEnvelope {
  hookSpecificOutput?: {
    hookEventName?: "BeforeTool";
    additionalContext?: string;
  };
}

export interface GeminiCliResult {
  envelope: BeforeToolEnvelope;
  metadata: HookMetadata;
}

const EMPTY_META: HookMetadata = {
  filePath: null,
  verdict: null,
  score: null,
  confidence: null,
};

function passthrough(filePath: string | null = null): GeminiCliResult {
  return {
    envelope: { hookSpecificOutput: {} },
    metadata: { ...EMPTY_META, filePath },
  };
}

export async function runGeminiCliHook(
  opts: HookOpts,
  deps: HookDeps = defaultDeps,
): Promise<GeminiCliResult> {
  let payload: unknown;
  try {
    payload = JSON.parse(opts.stdin);
  } catch {
    return passthrough();
  }
  if (typeof payload !== "object" || payload === null) return passthrough();

  const filePath = extractFilePath(payload as ToolInvocation);
  if (!filePath) return passthrough();

  try {
    const dbPath = join(opts.cwd, ".composto", "memory.db");
    const api = deps.makeApi({ dbPath, repoPath: opts.cwd });
    try {
      const res = await api.blastradius({ file: filePath });
      if (!res || res.verdict === "low") {
        return {
          envelope: { hookSpecificOutput: {} },
          metadata: {
            filePath,
            verdict: res ? res.verdict : null,
            score: res ? res.score : null,
            confidence: res ? res.confidence : null,
          },
        };
      }
      const body = formatBlastRadiusContext(filePath, res);
      return {
        envelope: {
          hookSpecificOutput: {
            hookEventName: "BeforeTool",
            additionalContext: body,
          },
        },
        metadata: {
          filePath,
          verdict: res.verdict,
          score: res.score,
          confidence: res.confidence,
        },
      };
    } finally {
      await api.close();
    }
  } catch {
    return passthrough(filePath);
  }
}
