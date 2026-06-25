// Thin router from "composto hook <platform> <event>" CLI invocation to the
// one surviving adapter: claude-code PostToolUse Read-compression. The old
// PreToolUse/BeforeTool risk-verdict adapters (cursor/gemini/claude-code) were
// the abandoned causal gate and have been removed. Unknown combos throw; the
// CLI entry point catches and passes through so the agent is never blocked.

import { runClaudeCodePostRead } from "./adapters/claude-code-read.js";
import type { HookMetadata } from "./types.js";

export type Platform = "claude-code";
export type Event = "posttooluse";

export interface DispatchOpts {
  platform: Platform;
  event: Event;
  stdin: string;
  cwd: string;
}

export interface DispatchResult {
  envelope: unknown;
  metadata: HookMetadata;
}

export type { HookMetadata } from "./types.js";

export async function runHookDispatch(opts: DispatchOpts): Promise<DispatchResult> {
  const hookOpts = { stdin: opts.stdin, cwd: opts.cwd };
  if (opts.platform === "claude-code" && opts.event === "posttooluse") {
    return runClaudeCodePostRead(hookOpts);
  }
  throw new Error(`unknown hook: ${opts.platform}/${opts.event}`);
}
