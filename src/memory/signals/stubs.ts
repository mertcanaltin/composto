// src/memory/signals/stubs.ts
// Placeholder implementations for the four signals filled in by Plan 2.
// Each returns zero strength and a conservative fallback precision so that
// confidence math in Plan 1 degrades gracefully: coverage_factor drops when
// these signals do not contribute.

import type { DB } from "../db.js";
import type { Signal, SignalType } from "../types.js";

const FALLBACK_PRECISION = 0.3;

function zeroSignal(type: SignalType): Signal {
  return {
    type,
    strength: 0,
    precision: FALLBACK_PRECISION,
    sample_size: 0,
    evidence: [],
  };
}

export function computeHotspot(_db: DB, _filePath: string): Signal {
  return zeroSignal("hotspot");
}
export function computeFixRatio(_db: DB, _filePath: string): Signal {
  return zeroSignal("fix_ratio");
}
export function computeCoverageDecline(_db: DB, _filePath: string): Signal {
  return zeroSignal("coverage_decline");
}
export function computeAuthorChurn(_db: DB, _filePath: string): Signal {
  return zeroSignal("author_churn");
}
