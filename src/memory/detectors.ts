// src/memory/detectors.ts
// Heuristic detectors for degraded modes that aren't direct git facts.

import type { DB } from "./db.js";

// Squashed-history heuristic: if >= 50 commits land from a single author
// within a < 1-day window, flag. Catches common `filter-repo` / squashed-import
// patterns without false-positiving on normal monorepo activity.
export function detectSquashed(db: DB): boolean {
  const row = db.prepare(`
    SELECT author, COUNT(*) AS n, MIN(timestamp) AS t0, MAX(timestamp) AS t1
    FROM commits
    GROUP BY author
    ORDER BY n DESC
    LIMIT 1
  `).get() as { author: string; n: number; t0: number; t1: number } | undefined;

  if (!row || row.n < 50) return false;
  const span = row.t1 - row.t0;
  return span < 86400;
}
