// Returns the maximum commits.timestamp in the DB, or null if the DB
// has no commits. Used by signals that need a "now" reference tracking
// the DB's state (e.g., for time-travel backtests), not the wall clock.
// Load-bearing for signal honesty: using Date.now() means "last 90 days"
// is always wall-clock-anchored, which makes old pre-break snapshots
// saturate or go dark spuriously.

import type { DB } from "../db.js";

export function getDbMaxTimestamp(db: DB): number | null {
  const row = db
    .prepare("SELECT MAX(timestamp) AS ts FROM commits")
    .get() as { ts: number | null } | undefined;
  return row?.ts ?? null;
}
