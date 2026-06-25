// Shared hook envelope/metadata types. Kept provider-agnostic so the one
// surviving adapter (claude-code PostToolUse compress-read) and the dispatcher
// share a single definition.

export interface HookMetadata {
  filePath: string | null;
  verdict: string | null;
  score: number | null;
  confidence: number | null;
}

export interface HookEnvelope {
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
    updatedToolOutput?: string;
  };
}

export interface ClaudeCodeResult {
  envelope: HookEnvelope;
  metadata: HookMetadata;
}
