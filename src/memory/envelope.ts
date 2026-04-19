// Assembles the BlastRadiusResponse envelope with all invariants from spec §7.5.

import type {
  BlastRadiusResponse,
  Signal,
  DegradedStatus,
  Tazelik,
} from "./types.js";
import { mapVerdict } from "./verdict.js";

interface BuildArgs {
  status: DegradedStatus;
  signals: Signal[];
  score: number;
  confidence: number;
  tazelik: Tazelik;
  indexedThrough: string;
  indexedTotal: number;
  queryMs: number;
  reason?: string;
  retry_hint_ms?: number;
}

// Degraded-mode confidence caps per spec §6.5.
// Plan 1 covers only the subset it supports; others map to 0.0 pending Plan 3.
const CONFIDENCE_CAP: Record<DegradedStatus, number> = {
  ok:                    1.0,
  empty_repo:            0.0,
  insufficient_history:  0.3,
  shallow_clone:         0.0,
  indexing:              0.4,
  squashed_history:      0.5,
  reindexing:            0.0,
  internal_error:        0.0,
  disabled:              0.0,
};

const USABLE_SAMPLE_THRESHOLD = 20;

export function buildEnvelope(args: BuildArgs): BlastRadiusResponse {
  const cap = CONFIDENCE_CAP[args.status];
  const cappedConfidence = Math.min(args.confidence, cap);
  const verdict = mapVerdict(args.score, cappedConfidence);

  const usable = args.signals.filter(
    (s) => s.strength > 0 && s.sample_size >= USABLE_SAMPLE_THRESHOLD
  ).length;

  return {
    status: args.status,
    reason: args.reason,
    verdict,
    score: args.score,
    confidence: cappedConfidence,
    signals: args.signals,
    calibration: "heuristic",
    retry_hint_ms: args.retry_hint_ms,
    confidence_cap: args.status === "ok" ? undefined : cap,
    metadata: {
      tazelik: args.tazelik,
      index_version: 1,
      indexed_commits_through: args.indexedThrough,
      indexed_commits_total: args.indexedTotal,
      query_ms: args.queryMs,
      signal_coverage: `${usable}/${args.signals.length}`,
    },
  };
}
