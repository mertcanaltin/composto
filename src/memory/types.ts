// Shared types for the Composto memory subsystem. See spec §4, §6, §7.

export type DegradedStatus =
  | "ok"
  | "empty_repo"
  | "insufficient_history"
  | "shallow_clone"
  | "indexing"
  | "squashed_history"
  | "reindexing"
  | "internal_error"
  | "disabled";

export type Tazelik = "fresh" | "catching_up" | "partial" | "bootstrapping";

export type Verdict = "low" | "medium" | "high" | "unknown";

export type SignalType =
  | "revert_match"
  | "hotspot"
  | "fix_ratio"
  | "coverage_decline"
  | "author_churn";

export type Intent =
  | "refactor"
  | "bugfix"
  | "feature"
  | "test"
  | "docs"
  | "unknown";

export type Level = "summary" | "detail";

export interface Evidence {
  commit_sha: string;
  subject: string;
  days_ago: number;
  evidence_type?: string;
}

export interface Signal {
  type: SignalType;
  strength: number;           // 0.0..1.0
  precision: number;          // 0.0..1.0
  sample_size: number;
  evidence?: Evidence[];
  // Signal-specific extras (present for some signals only)
  touches_90d?: number;
  ratio?: number;
}

export interface ResponseMetadata {
  tazelik: Tazelik;
  index_version: number;
  indexed_commits_through: string;
  indexed_commits_total: number;
  query_ms: number;
  signal_coverage: string;    // "<usable>/<total>"
}

export interface BlastRadiusResponse {
  status: DegradedStatus;
  reason?: string;
  verdict: Verdict;
  score: number;
  confidence: number;
  signals: Signal[];
  calibration: "repo-calibrated" | "heuristic";
  retry_hint_ms?: number;
  confidence_cap?: number;
  metadata: ResponseMetadata;
}

export interface IngestRange {
  from: string | null;  // null = bootstrap from first commit
  to: string;           // HEAD SHA
}

export interface BlastRadiusInput {
  file: string;
  intent?: Intent;
  level?: Level;
  diff?: string;
}
