// Thin router from "composto hook <platform> <event>" CLI invocation to
// the platform-specific adapter. Platform/event pairs are a closed set;
// unknown combos throw (the CLI entry point catches and passthroughs so
// the agent is never blocked, but the dispatcher itself is strict so
// misconfiguration surfaces in tests).

import { defaultDeps, type HookDeps } from "./api-deps.js";
import { runClaudeCodeHook } from "./adapters/claude-code.js";
import { runCursorHook } from "./adapters/cursor.js";
import { runGeminiCliHook } from "./adapters/gemini-cli.js";

export type Platform = "claude-code" | "cursor" | "gemini-cli";
export type Event = "pretooluse" | "beforetool";

export interface DispatchOpts {
  platform: Platform;
  event: Event;
  stdin: string;
  cwd: string;
}

export async function runHookDispatch(
  opts: DispatchOpts,
  deps: HookDeps = defaultDeps
): Promise<unknown> {
  const p = opts.platform;
  const e = opts.event;
  const hookOpts = { stdin: opts.stdin, cwd: opts.cwd };
  switch (p) {
    case "claude-code":
      if (e === "pretooluse") return runClaudeCodeHook(hookOpts, deps);
      throw new Error(`unknown event for claude-code: ${e}`);
    case "cursor":
      if (e === "pretooluse") return runCursorHook(hookOpts, deps);
      throw new Error(`unknown event for cursor: ${e}`);
    case "gemini-cli":
      if (e === "beforetool") return runGeminiCliHook(hookOpts, deps);
      throw new Error(`unknown event for gemini-cli: ${e}`);
    default: {
      const _exhaustive: never = p;
      throw new Error(`unknown platform: ${_exhaustive}`);
    }
  }
}
