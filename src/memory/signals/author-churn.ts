// src/memory/signals/author-churn.ts
// Spec §6.2:
//   - 1.0 if last author has 0 commits in last 90 days
//   - 0.5 if < 5 commits in last 90 days
//   - 0 otherwise

import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { getCalibration } from "./calibration-lookup.js";

const WINDOW_SECONDS = 90 * 86400;
const INACTIVE_THRESHOLD = 5;
const FALLBACK_PRECISION = 0.3;

export function computeAuthorChurn(db: DB, filePath: string): Signal {
  const cal = getCalibration(db, "author_churn", FALLBACK_PRECISION);
  const base = {
    type: "author_churn" as const,
    precision: cal.precision,
    sample_size: cal.sampleSize,
    evidence: [],
  };

  const lastTouch = db
    .prepare(`
      SELECT c.author, c.timestamp
      FROM file_touches ft
      JOIN commits c ON c.sha = ft.commit_sha
      WHERE ft.file_path = ?
      ORDER BY c.timestamp DESC
      LIMIT 1
    `)
    .get(filePath) as { author: string; timestamp: number } | undefined;

  if (!lastTouch) return { ...base, strength: 0 };

  const now = Math.floor(Date.now() / 1000);
  const lowerBound = now - WINDOW_SECONDS;

  const activity = db
    .prepare(`SELECT COUNT(*) AS n FROM commits WHERE author = ? AND timestamp >= ?`)
    .get(lastTouch.author, lowerBound) as { n: number };

  let strength = 0;
  if (activity.n === 0) strength = 1.0;
  else if (activity.n < INACTIVE_THRESHOLD) strength = 0.5;

  return { ...base, strength };
}
