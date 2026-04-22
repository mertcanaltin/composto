// src/memory/signals/hotspot.ts
// Spec §6.2: strength = min(1.0, touches_90d / 30)
//
// The 90-day window is anchored at the DB's latest commit timestamp, not
// wall clock, so this signal is meaningful during time-travel backtests
// and regardless of ingest freshness. Falls back to wall clock only when
// the DB is empty.

import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { getCalibration } from "./calibration-lookup.js";
import { getDbMaxTimestamp } from "./db-clock.js";

const WINDOW_SECONDS = 90 * 86400;
const SATURATION_TOUCHES = 30;
const FALLBACK_PRECISION = 0.3;

export function computeHotspot(db: DB, filePath: string): Signal {
  const anchor = getDbMaxTimestamp(db) ?? Math.floor(Date.now() / 1000);
  const lowerBound = anchor - WINDOW_SECONDS;

  const row = db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM file_touches ft
      JOIN commits c ON c.sha = ft.commit_sha
      WHERE ft.file_path = ? AND c.timestamp >= ?
    `)
    .get(filePath, lowerBound) as { n: number };

  const touches = row.n;
  const strength = Math.min(1.0, touches / SATURATION_TOUCHES);
  const cal = getCalibration(db, "hotspot", FALLBACK_PRECISION);

  return {
    type: "hotspot",
    strength,
    precision: cal.precision,
    sample_size: cal.sampleSize,
    evidence: [],
    touches_90d: touches,
  };
}
