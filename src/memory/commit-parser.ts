// src/memory/commit-parser.ts
// Regex-based parser for git commit subjects/bodies.
// Mirrors spec §5.1 fix/revert detection rules.

const FIX_PATTERNS: RegExp[] = [
  /\bfix(es|ed|ing)?\b/i,
  /\bbugfix\b/i,
  /\bhotfix\b/i,
  /\bpatch\b/i,
  /\bbug\b/i,
  /closes?\s+#\d+/i,
  /resolves?\s+#\d+/i,
];

const REVERT_SUBJECT = /^\s*revert\b/i;
const REVERT_BODY_SHA = /This reverts commit ([0-9a-f]{7,40})/i;

export interface ParsedCommit {
  is_fix: boolean;
  is_revert: boolean;
  reverts_sha: string | null;
}

export function parseCommit(subject: string, body: string): ParsedCommit {
  const is_revert = REVERT_SUBJECT.test(subject);
  const match = is_revert ? body.match(REVERT_BODY_SHA) : null;
  const reverts_sha = match ? match[1] : null;

  // Don't treat "revert" as a fix by default (noise).
  const is_fix =
    !is_revert && FIX_PATTERNS.some((re) => re.test(subject));

  return { is_fix, is_revert, reverts_sha };
}
