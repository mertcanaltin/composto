// Shared formatter for the <composto_blastradius> verdict block that
// hook adapters inject as additionalContext (or as a deny-reason on
// Cursor). Centralized here so wording changes are a one-file edit.

import type { BlastRadiusResponse } from "../../memory/types.js";

export function formatBlastRadiusContext(
  filePath: string,
  res: BlastRadiusResponse,
  opts: { hint?: string } = {}
): string {
  const firing = res.signals
    .filter((s) => s.strength > 0)
    .map((s) => `${s.type}=${s.strength.toFixed(2)}`)
    .join(", ");
  const hint = opts.hint ??
    "this file's bug history may be relevant to your edit. See composto_blastradius for detail.";
  return [
    `<composto_blastradius>`,
    `  file: ${filePath}`,
    `  verdict: ${res.verdict}`,
    `  score: ${res.score.toFixed(2)} confidence: ${res.confidence.toFixed(2)}`,
    firing ? `  firing_signals: ${firing}` : `  firing_signals: (none)`,
    `  hint: ${hint}`,
    `</composto_blastradius>`,
  ].join("\n");
}
