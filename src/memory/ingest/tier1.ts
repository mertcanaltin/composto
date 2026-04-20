// src/memory/ingest/tier1.ts
// Tier 1 ingest: git log → commits + file_touches.
// fix_links derivation lives in ingest/fix-links.ts (Task 6).

import type { DB } from "../db.js";
import type { IngestRange } from "../types.js";
import { logRange } from "../git.js";
import { parseCommit } from "../commit-parser.js";
import { deriveFixLinks } from "./fix-links.js";
import { refreshCalibration, shouldRefresh } from "../calibration.js";

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x00";
const RECORD_END = "\x1f";

interface RawCommit {
  sha: string;
  parent_sha: string | null;
  author: string;
  timestamp: number;
  subject: string;
  body: string;
  touches: Array<{
    file_path: string;
    adds: number;
    dels: number;
    change_type: string;
  }>;
}

function parseNumstatLine(line: string): { adds: number; dels: number; path: string } | null {
  // Format: "<adds>\t<dels>\t<path>" or "-\t-\t<path>" for binary
  const parts = line.split("\t");
  if (parts.length < 3) return null;
  const adds = parts[0] === "-" ? 0 : parseInt(parts[0], 10);
  const dels = parts[1] === "-" ? 0 : parseInt(parts[1], 10);
  if (Number.isNaN(adds) || Number.isNaN(dels)) return null;
  return { adds, dels, path: parts.slice(2).join("\t").trim() };
}

function parseLogOutput(output: string): RawCommit[] {
  const commits: RawCommit[] = [];
  // Each record starts with RECORD_SEP and ends with RECORD_END.
  // Body may span multiple lines; numstat follows the body before RECORD_END.
  const records = output.split(RECORD_SEP).slice(1);
  for (const rec of records) {
    const endIdx = rec.indexOf(RECORD_END);
    if (endIdx === -1) continue;
    const content = rec.slice(0, endIdx);
    const tail = rec.slice(endIdx + 1);

    const fields = content.split(FIELD_SEP);
    if (fields.length < 6) continue;
    const [sha, parent, author, tsStr, subject, ...rest] = fields;
    const body = rest.join(FIELD_SEP);

    const touches: RawCommit["touches"] = [];
    for (const line of tail.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = parseNumstatLine(trimmed);
      if (!parsed) continue;
      touches.push({
        file_path: parsed.path,
        adds: parsed.adds,
        dels: parsed.dels,
        change_type: parsed.adds > 0 && parsed.dels === 0 ? "A" : parsed.dels > 0 && parsed.adds === 0 ? "D" : "M",
      });
    }

    commits.push({
      sha,
      parent_sha: parent ? parent.split(" ")[0] : null,
      author,
      timestamp: parseInt(tsStr, 10),
      subject,
      body,
      touches,
    });
  }
  return commits;
}

function resolveRevertsSha(raw: string | null, knownShas: Set<string>): string | null {
  // Revert messages commonly carry truncated SHAs (e.g. "This reverts commit abc1234.").
  // The captured text may also point at a commit outside the indexed range, or be
  // wrong altogether (mistyped / rebased branches). Validate against the known SHA
  // set before handing the value to SQLite so the FK on commits.reverts_sha never
  // crashes ingest. See docs/blastradius-proof.md "Attempted: zod".
  if (!raw) return null;
  if (knownShas.has(raw)) return raw;
  if (raw.length < 40) {
    for (const sha of knownShas) {
      if (sha.startsWith(raw)) return sha;
    }
  }
  return null;
}

export function ingestRange(db: DB, repoPath: string, range: IngestRange): number {
  const raw = logRange(repoPath, range.from, range.to);
  const commits = parseLogOutput(raw);

  // Sort by timestamp ascending so earlier commits are inserted first,
  // avoiding foreign key constraint violations when a newer commit reverts an older one.
  commits.sort((a, b) => a.timestamp - b.timestamp);

  // Build the set of SHAs that will be present in the commits table after this
  // batch lands. Used by resolveRevertsSha to null out dangling references.
  const knownShas = new Set<string>(commits.map((c) => c.sha));
  for (const existing of db.prepare(`SELECT sha FROM commits`).all() as Array<{ sha: string }>) {
    knownShas.add(existing.sha);
  }

  const insertCommit = db.prepare(`
    INSERT OR IGNORE INTO commits
      (sha, parent_sha, author, timestamp, subject, is_fix, is_revert, reverts_sha)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTouch = db.prepare(`
    INSERT OR IGNORE INTO file_touches
      (commit_sha, file_path, adds, dels, change_type, renamed_from)
    VALUES (?, ?, ?, ?, ?, NULL)
  `);
  const upsertState = db.prepare(`
    INSERT INTO index_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const tx = db.transaction((batch: RawCommit[]) => {
    for (const c of batch) {
      const parsed = parseCommit(c.subject, c.body);
      insertCommit.run(
        c.sha,
        c.parent_sha,
        c.author,
        c.timestamp,
        c.subject,
        parsed.is_fix ? 1 : 0,
        parsed.is_revert ? 1 : 0,
        resolveRevertsSha(parsed.reverts_sha, knownShas)
      );
      for (const t of c.touches) {
        insertTouch.run(c.sha, t.file_path, t.adds, t.dels, t.change_type);
      }
    }
  });

  // Disable FK enforcement for the batch insert. Two reasons:
  //   1. Commits with identical timestamps (common in bulk imports, squashed
  //      history, or --allow-empty commit chains) have an unstable sort order,
  //      so a revert may land before its target within a batch.
  //   2. resolveRevertsSha already guarantees the value written to
  //      commits.reverts_sha is either NULL or a SHA that WILL be present in
  //      the commits table by end of the batch. FK consistency holds once the
  //      batch is committed.
  db.pragma("foreign_keys = OFF");
  try {
    const BATCH = 1000;
    for (let i = 0; i < commits.length; i += BATCH) {
      tx(commits.slice(i, i + BATCH));
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }

  deriveFixLinks(db);

  if (shouldRefresh(db, range.to)) {
    refreshCalibration(db, range.to);
  }

  upsertState.run("last_indexed_sha", range.to);
  const totalRow = db.prepare("SELECT COUNT(*) AS n FROM commits").get() as { n: number };
  upsertState.run("indexed_commits_total", String(totalRow.n));

  return commits.length;
}
