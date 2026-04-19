// src/memory/calibration.ts
// Self-validation: replay historical signals against observed fix_links and
// compute a per-signal precision. Writes one row per signal_type into
// signal_calibration. See spec §5.6.

import type { DB } from "./db.js";
import type { SignalType } from "./types.js";

const LOOKAHEAD_SECONDS = 14 * 86400;
const REFRESH_AFTER_SECONDS = 7 * 86400;

interface Validation {
  total: number;
  hits: number;
}

function validateRevertMatch(db: DB): Validation {
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM fix_links`).get() as { n: number }).n;
  const hits = (db.prepare(`
    SELECT COUNT(*) AS n
    FROM fix_links fl
    JOIN commits fix_c ON fix_c.sha = fl.fix_commit_sha
    JOIN commits break_c ON break_c.sha = fl.suspected_break_sha
    WHERE fix_c.timestamp - break_c.timestamp <= ?
  `).get(LOOKAHEAD_SECONDS) as { n: number }).n;
  return { total, hits };
}

function validateHotspot(db: DB): Validation {
  const total = (db.prepare(`
    SELECT COUNT(DISTINCT file_path) AS n FROM file_touches
  `).get() as { n: number }).n;
  const hits = (db.prepare(`
    SELECT COUNT(DISTINCT ft.file_path) AS n
    FROM file_touches ft
    JOIN fix_links fl ON fl.suspected_break_sha = ft.commit_sha
  `).get() as { n: number }).n;
  return { total, hits };
}

function validateFixRatio(db: DB): Validation {
  const total = (db.prepare(`
    SELECT COUNT(DISTINCT file_path) AS n FROM file_touches
  `).get() as { n: number }).n;
  const hits = (db.prepare(`
    SELECT COUNT(DISTINCT ft.file_path) AS n
    FROM file_touches ft
    JOIN fix_links fl ON fl.suspected_break_sha = ft.commit_sha
  `).get() as { n: number }).n;
  return { total, hits };
}

function validateCoverageDecline(_db: DB): Validation {
  // Binary signal from ir/health.ts — no retrospective event stream.
  // Sample size starts at 0; stays heuristic until Plan 5 external backtest.
  return { total: 0, hits: 0 };
}

function validateAuthorChurn(db: DB): Validation {
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM file_touches`).get() as { n: number }).n;
  const hits = (db.prepare(`SELECT COUNT(*) AS n FROM fix_links`).get() as { n: number }).n;
  return { total, hits };
}

const VALIDATORS: Record<SignalType, (db: DB) => Validation> = {
  revert_match: validateRevertMatch,
  hotspot: validateHotspot,
  fix_ratio: validateFixRatio,
  coverage_decline: validateCoverageDecline,
  author_churn: validateAuthorChurn,
};

export function refreshCalibration(db: DB, headSha: string): void {
  const now = Math.floor(Date.now() / 1000);
  const upsert = db.prepare(`
    INSERT INTO signal_calibration (signal_type, precision, sample_size, last_computed_sha, computed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(signal_type) DO UPDATE SET
      precision = excluded.precision,
      sample_size = excluded.sample_size,
      last_computed_sha = excluded.last_computed_sha,
      computed_at = excluded.computed_at
  `);

  for (const [type, validator] of Object.entries(VALIDATORS) as Array<[SignalType, (db: DB) => Validation]>) {
    const v = validator(db);
    const precision = v.total === 0 ? 0 : v.hits / v.total;
    upsert.run(type, precision, v.total, headSha, now);
  }

  db.prepare(`
    INSERT INTO index_state (key, value) VALUES ('calibration_last_refreshed_at', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(now));
}

export function shouldRefresh(db: DB, currentHeadSha: string): boolean {
  const lastTimeRow = db
    .prepare(`SELECT value FROM index_state WHERE key = 'calibration_last_refreshed_at'`)
    .get() as { value: string } | undefined;

  if (!lastTimeRow) return true;

  const now = Math.floor(Date.now() / 1000);
  const lastTime = parseInt(lastTimeRow.value, 10);
  if (now - lastTime >= REFRESH_AFTER_SECONDS) return true;

  const anyCal = db
    .prepare(`SELECT last_computed_sha FROM signal_calibration LIMIT 1`)
    .get() as { last_computed_sha: string } | undefined;
  if (!anyCal) return true;
  return anyCal.last_computed_sha !== currentHeadSha;
}
