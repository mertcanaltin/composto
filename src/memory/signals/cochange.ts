// src/memory/signals/cochange.ts
// Co-change coupling: how many DISTINCT other files this file has co-occurred
// with in past FIX commits (is_fix=1). Unlike the per-file activity signals
// (hotspot, fix_ratio, author_churn), this is a *coupling* measure — it fires
// on files that are repeatedly part of multi-file fixes, which discriminates
// real blast-radius hubs from merely-recently-active files. Validated as a
// precision lever in scripts/threshold-sweep.ts (it breaks the ~0.55 precision
// ceiling that threshold tuning could not).
//
// strength = min(1.0, degree / 10).

import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { getCalibration } from "./calibration-lookup.js";

const SATURATION_DEGREE = 10;
const FALLBACK_PRECISION = 0.3;

export function computeCochange(db: DB, filePath: string): Signal {
  const row = db
    .prepare(`
      SELECT COUNT(DISTINCT ft2.file_path) AS degree
      FROM file_touches ft1
      JOIN commits c ON c.sha = ft1.commit_sha AND c.is_fix = 1
      JOIN file_touches ft2 ON ft2.commit_sha = ft1.commit_sha AND ft2.file_path != ft1.file_path
      WHERE ft1.file_path = ?
    `)
    .get(filePath) as { degree: number } | undefined;

  const degree = row?.degree ?? 0;
  const strength = Math.min(1.0, degree / SATURATION_DEGREE);
  const cal = getCalibration(db, "cochange", FALLBACK_PRECISION);

  return {
    type: "cochange",
    strength,
    precision: cal.precision,
    sample_size: cal.sampleSize,
    evidence: [],
    cochange_degree: degree,
  };
}
