// src/memory/signals/hotspot.ts
// Spec §6.2: strength = min(1.0, touches_90d / 30)

import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { getCalibration } from "./calibration-lookup.js";

const WINDOW_SECONDS = 90 * 86400;
const SATURATION_TOUCHES = 30;
const FALLBACK_PRECISION = 0.3;

export function computeHotspot(db: DB, filePath: string): Signal {
  const now = Math.floor(Date.now() / 1000);
  const lowerBound = now - WINDOW_SECONDS;

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
