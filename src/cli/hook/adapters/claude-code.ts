// Claude Code PreToolUse hook adapter.
// Emits { hookSpecificOutput: { hookEventName: "PreToolUse",
// additionalContext: "<composto verdict block>" } } for medium|high|unknown
// verdicts on file-targeting tools. Passes through (empty hookSpecificOutput)
// for low verdicts, non-file tools, and any failure mode — hooks MUST NEVER
// block the agent.
//
// Returns a DispatchResult-shaped object: { envelope, metadata } where
// `metadata` carries the verdict/score/confidence so the CLI layer can
// record telemetry without re-parsing the envelope.

import { extractFilePath, type ToolInvocation } from "../extract.js";
import { type HookDeps, defaultDeps } from "../api-deps.js";
import { formatBlastRadiusContext } from "../format.js";
import { join } from "node:path";

interface HookOpts {
  stdin: string;
  cwd: string;
}

interface PreToolUseEnvelope {
  hookSpecificOutput?: {
    hookEventName?: "PreToolUse";
    additionalContext?: string;
  };
}

export interface HookMetadata {
  filePath: string | null;
  verdict: string | null;
  score: number | null;
  confidence: number | null;
}

export interface ClaudeCodeResult {
  envelope: PreToolUseEnvelope;
  metadata: HookMetadata;
}

const EMPTY_META: HookMetadata = {
  filePath: null,
  verdict: null,
  score: null,
  confidence: null,
};

function passthrough(filePath: string | null = null): ClaudeCodeResult {
  return {
    envelope: { hookSpecificOutput: {} },
    metadata: { ...EMPTY_META, filePath },
  };
}

export async function runClaudeCodeHook(
  opts: HookOpts,
  deps: HookDeps = defaultDeps,
): Promise<ClaudeCodeResult> {
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
            hookEventName: "PreToolUse",
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
