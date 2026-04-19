import type { DB } from "../db.js";
import type { SignalType } from "../types.js";

export interface CalibrationResult {
  precision: number;
  sampleSize: number;
  source: "repo-calibrated" | "heuristic";
}

export function getCalibration(
  db: DB,
  type: SignalType,
  fallbackPrecision: number
): CalibrationResult {
  const row = db
    .prepare("SELECT precision, sample_size FROM signal_calibration WHERE signal_type = ?")
    .get(type) as { precision: number; sample_size: number } | undefined;

  if (!row) {
    return { precision: fallbackPrecision, sampleSize: 0, source: "heuristic" };
  }
  return {
    precision: row.precision,
    sampleSize: row.sample_size,
    source: "repo-calibrated",
  };
}
