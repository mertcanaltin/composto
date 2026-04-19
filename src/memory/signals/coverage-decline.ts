// src/memory/signals/coverage-decline.ts
// Spec §6.2: strength = 1.0 if ir/health.ts reports coverageTrend === "down", else 0.
// Binary signal; reuses existing src/trends/ + src/ir/health.ts infrastructure.

import type { DB } from "../db.js";
import type { Signal, TrendAnalysis } from "../types.js";
import { getCalibration } from "./calibration-lookup.js";
import { getGitLog } from "../../trends/git-log-parser.js";
import { detectHotspots } from "../../trends/hotspot.js";
import { detectDecay } from "../../trends/decay.js";
import { detectInconsistencies } from "../../trends/inconsistency.js";
import { computeHealthFromTrends } from "../../ir/health.js";

const FALLBACK_PRECISION = 0.3;

export function computeCoverageDecline(db: DB, repoPath: string, filePath: string): Signal {
  const cal = getCalibration(db, "coverage_decline", FALLBACK_PRECISION);

  let strength = 0;
  try {
    const entries = getGitLog(repoPath, 200);
    const trends: TrendAnalysis = {
      hotspots: detectHotspots(entries, { threshold: 10, fixRatioThreshold: 0.5 }),
      decaySignals: detectDecay(entries),
      inconsistencies: detectInconsistencies(entries),
    };
    const health = computeHealthFromTrends(filePath, trends);
    if (health.coverageTrend === "down") strength = 1.0;
  } catch {
    strength = 0;
  }

  return {
    type: "coverage_decline",
    strength,
    precision: cal.precision,
    sample_size: cal.sampleSize,
    evidence: [],
  };
}
