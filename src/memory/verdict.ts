// Maps (score, confidence) → verdict per spec §6.4.

import type { Verdict } from "./types.js";

export function mapVerdict(score: number, confidence: number): Verdict {
  if (confidence < 0.3) return "unknown";
  if (score < 0.3)  return "low";
  if (score < 0.6)  return "medium";
  return "high";
}
