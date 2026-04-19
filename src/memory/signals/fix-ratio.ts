// src/memory/signals/fix-ratio.ts
// Spec §6.2: strength = max(0, (ratio - 0.3) / 0.5) over last 30 commits touching file.

import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { getCalibration } from "./calibration-lookup.js";

const WINDOW_COMMITS = 30;
const DEAD_ZONE = 0.3;
const SATURATION_OVER_DEAD_ZONE = 0.5;
const FALLBACK_PRECISION = 0.3;

export function computeFixRatio(db: DB, filePath: string): Signal {
  const rows = db
    .prepare(`
      SELECT c.is_fix
      FROM file_touches ft
      JOIN commits c ON c.sha = ft.commit_sha
      WHERE ft.file_path = ?
      ORDER BY c.timestamp DESC
      LIMIT ?
    `)
    .all(filePath, WINDOW_COMMITS) as Array<{ is_fix: number }>;

  const cal = getCalibration(db, "fix_ratio", FALLBACK_PRECISION);

  if (rows.length === 0) {
    return {
      type: "fix_ratio",
      strength: 0,
      precision: cal.precision,
      sample_size: cal.sampleSize,
      evidence: [],
      ratio: 0,
    };
  }

  const fixes = rows.filter((r) => r.is_fix === 1).length;
  const ratio = fixes / rows.length;
  const strength = Math.max(0, Math.min(1.0, (ratio - DEAD_ZONE) / SATURATION_OVER_DEAD_ZONE));

  return {
    type: "fix_ratio",
    strength,
    precision: cal.precision,
    sample_size: cal.sampleSize,
    evidence: [],
    ratio,
  };
}
