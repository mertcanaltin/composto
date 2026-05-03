// Cursor preToolUse hook adapter.
// Cursor drops additional_context silently (forum #155689), so this adapter
// uses the one channel that IS user-visible: permissionDecision. We only
// deny on verdict === "high" (justifies the interrupt). medium/low/unknown
// pass through silently. Lean Hook v0.7.0 deliberately keeps the chat
// uninterrupted on those verdicts; the signal is preserved in
// .composto/memory.db's hook_invocations table and queryable via
// `composto stats` and `composto impact <file>`. Users who want medium
// signals surfaced in chat can opt in with
// `composto init --client=cursor --with-mcp` and have the agent call
// composto_blastradius directly.
//
// Returns { envelope, metadata } so the CLI layer has full visibility into
// the verdict/score/confidence for telemetry, even when the user-visible
// envelope is empty (passthrough).

import { extractFilePath, type ToolInvocation } from "../extract.js";
import { type HookDeps, defaultDeps } from "../api-deps.js";
import { formatBlastRadiusContext } from "../format.js";
import { join } from "node:path";
import type { HookMetadata } from "./claude-code.js";

interface HookOpts {
  stdin: string;
  cwd: string;
}

interface CursorEnvelope {
  permissionDecision?: "deny" | "allow" | "ask";
  permissionDecisionReason?: string;
}

export interface CursorResult {
  envelope: CursorEnvelope;
  metadata: HookMetadata;
}

const CURSOR_HINT =
  "this file's bug history suggests high risk — ask the user to confirm before editing.";

const EMPTY_META: HookMetadata = {
  filePath: null,
  verdict: null,
  score: null,
  confidence: null,
};

function passthrough(filePath: string | null = null): CursorResult {
  return { envelope: {}, metadata: { ...EMPTY_META, filePath } };
}

export async function runCursorHook(
  opts: HookOpts,
  deps: HookDeps = defaultDeps,
): Promise<CursorResult> {
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
      if (!res || res.verdict !== "high") {
        return {
          envelope: {},
          metadata: {
            filePath,
            verdict: res ? res.verdict : null,
            score: res ? res.score : null,
            confidence: res ? res.confidence : null,
          },
        };
      }
      return {
        envelope: {
          permissionDecision: "deny",
          permissionDecisionReason: formatBlastRadiusContext(filePath, res, { hint: CURSOR_HINT }),
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
