// src/memory/ingest/tier1.ts
// Tier 1 ingest: git log → commits + file_touches.
// fix_links derivation lives in ingest/fix-links.ts (Task 6).

import type { DB } from "../db.js";
import type { IngestRange } from "../types.js";
import { logRange } from "../git.js";
import { parseCommit } from "../commit-parser.js";

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

export function ingestRange(db: DB, repoPath: string, range: IngestRange): number {
  const raw = logRange(repoPath, range.from, range.to);
  const commits = parseLogOutput(raw);

  // Sort by timestamp ascending so earlier commits are inserted first,
  // avoiding foreign key constraint violations when a newer commit reverts an older one.
  commits.sort((a, b) => a.timestamp - b.timestamp);

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
        parsed.reverts_sha
      );
      for (const t of c.touches) {
        insertTouch.run(c.sha, t.file_path, t.adds, t.dels, t.change_type);
      }
    }
  });

  const BATCH = 1000;
  for (let i = 0; i < commits.length; i += BATCH) {
    tx(commits.slice(i, i + BATCH));
  }

  upsertState.run("last_indexed_sha", range.to);
  const totalRow = db.prepare("SELECT COUNT(*) AS n FROM commits").get() as { n: number };
  upsertState.run("indexed_commits_total", String(totalRow.n));

  return commits.length;
}
