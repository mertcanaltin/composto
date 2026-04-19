// src/memory/ingest/fix-links.ts
// Derives fix_links from commits + file_touches using three evidence types
// defined in spec §5.1:
//   - revert_marker: is_revert commit links to reverts_sha
//   - short_followup_fix: a fix commit links to prior commits touching
//     the same files within WINDOW_HOURS
//   - same_region_fix_chain: three+ fix commits clustered on the same file
//     within CHAIN_WINDOW_DAYS are cross-linked to prior non-fix touches
//     in the same cluster

import type { DB } from "../db.js";

const FOLLOWUP_WINDOW_HOURS = 72;
const CHAIN_WINDOW_DAYS = 14;
const CHAIN_MIN = 3;

export function deriveFixLinks(db: DB): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO fix_links
      (fix_commit_sha, suspected_break_sha, evidence_type, confidence, window_hours)
    VALUES (?, ?, ?, ?, ?)
  `);

  // 1. revert_marker
  const reverts = db.prepare(`
    SELECT sha, reverts_sha FROM commits
    WHERE is_revert = 1 AND reverts_sha IS NOT NULL
  `).all() as Array<{ sha: string; reverts_sha: string }>;

  for (const r of reverts) {
    // Only link if the reverted SHA is actually in our commits table
    const exists = db.prepare("SELECT 1 FROM commits WHERE sha = ?").get(r.reverts_sha);
    if (exists) insert.run(r.sha, r.reverts_sha, "revert_marker", 1.0, null);
  }

  // 2. short_followup_fix
  const fixes = db.prepare(`
    SELECT sha, timestamp FROM commits WHERE is_fix = 1
  `).all() as Array<{ sha: string; timestamp: number }>;

  const priorByFile = db.prepare(`
    SELECT c.sha AS prior_sha
      FROM file_touches ft_fix
      JOIN file_touches ft_prior ON ft_prior.file_path = ft_fix.file_path
      JOIN commits c ON c.sha = ft_prior.commit_sha
     WHERE ft_fix.commit_sha = ?
       AND c.timestamp < ?
       AND c.timestamp >= ?
       AND c.sha != ?
       AND c.is_fix = 0
       AND c.is_revert = 0
  `);

  for (const f of fixes) {
    const lowerBound = f.timestamp - FOLLOWUP_WINDOW_HOURS * 3600;
    const priors = priorByFile.all(f.sha, f.timestamp, lowerBound, f.sha) as Array<{ prior_sha: string }>;
    const unique = new Set(priors.map((p) => p.prior_sha));
    for (const prior of unique) {
      insert.run(f.sha, prior, "short_followup_fix", 0.7, FOLLOWUP_WINDOW_HOURS);
    }
  }

  // 3. same_region_fix_chain
  // For each file, find windows of >= CHAIN_MIN fix commits within CHAIN_WINDOW_DAYS.
  // Link every fix in the window to the earliest non-fix touch immediately preceding
  // the window.
  const filesWithFixes = db.prepare(`
    SELECT DISTINCT ft.file_path
      FROM file_touches ft
      JOIN commits c ON c.sha = ft.commit_sha
     WHERE c.is_fix = 1
  `).all() as Array<{ file_path: string }>;

  const fixesOnFile = db.prepare(`
    SELECT c.sha, c.timestamp
      FROM commits c
      JOIN file_touches ft ON ft.commit_sha = c.sha
     WHERE ft.file_path = ? AND c.is_fix = 1
     ORDER BY c.timestamp ASC
  `);

  const priorNonFixOnFile = db.prepare(`
    SELECT c.sha
      FROM commits c
      JOIN file_touches ft ON ft.commit_sha = c.sha
     WHERE ft.file_path = ?
       AND c.timestamp < ?
       AND c.is_fix = 0 AND c.is_revert = 0
     ORDER BY c.timestamp DESC
     LIMIT 1
  `);

  for (const { file_path } of filesWithFixes) {
    const rows = fixesOnFile.all(file_path) as Array<{ sha: string; timestamp: number }>;
    const windowSec = CHAIN_WINDOW_DAYS * 86400;
    for (let i = 0; i + CHAIN_MIN - 1 < rows.length; i++) {
      const windowEnd = rows[i + CHAIN_MIN - 1];
      if (windowEnd.timestamp - rows[i].timestamp > windowSec) continue;
      const prior = priorNonFixOnFile.get(file_path, rows[i].timestamp) as { sha: string } | undefined;
      if (!prior) continue;
      for (let j = i; j < rows.length && rows[j].timestamp - rows[i].timestamp <= windowSec; j++) {
        insert.run(rows[j].sha, prior.sha, "same_region_fix_chain", 0.4, CHAIN_WINDOW_DAYS * 24);
      }
    }
  }
}
