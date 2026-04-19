import type { DB } from "../db.js";
import type { Signal, Evidence } from "../types.js";

// Strength per evidence type per spec §6.2.
const STRENGTH_BY_EVIDENCE: Record<string, number> = {
  revert_marker: 1.0,
  short_followup_fix: 0.7,
  same_region_fix_chain: 0.4,
};

// Plan 1 uses a fallback precision; Plan 2 computes this from signal_calibration.
const FALLBACK_PRECISION = 0.5;
const MAX_EVIDENCE = 5;

export function computeRevertMatch(db: DB, filePath: string): Signal {
  const rows = db
    .prepare(`
      SELECT fl.evidence_type, fl.confidence, fl.suspected_break_sha,
             c.subject, c.timestamp
        FROM fix_links fl
        JOIN file_touches ft ON ft.commit_sha = fl.suspected_break_sha
        JOIN commits c ON c.sha = fl.suspected_break_sha
       WHERE ft.file_path = ?
       ORDER BY c.timestamp DESC
       LIMIT ?
    `)
    .all(filePath, MAX_EVIDENCE) as Array<{
      evidence_type: string;
      confidence: number;
      suspected_break_sha: string;
      subject: string;
      timestamp: number;
    }>;

  if (rows.length === 0) {
    return {
      type: "revert_match",
      strength: 0,
      precision: FALLBACK_PRECISION,
      sample_size: 0,
      evidence: [],
    };
  }

  // Take max strength across matched evidence types
  let strength = 0;
  const evidence: Evidence[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const r of rows) {
    const s = STRENGTH_BY_EVIDENCE[r.evidence_type] ?? 0;
    if (s > strength) strength = s;
    evidence.push({
      commit_sha: r.suspected_break_sha,
      subject: r.subject,
      days_ago: Math.floor((now - r.timestamp) / 86400),
      evidence_type: r.evidence_type,
    });
  }

  return {
    type: "revert_match",
    strength,
    precision: FALLBACK_PRECISION,
    sample_size: rows.length,
    evidence,
  };
}
