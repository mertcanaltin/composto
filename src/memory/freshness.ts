import type { DB } from "./db.js";
import type { IngestRange, Tazelik } from "./types.js";
import { revParseHead, isAncestor, revListCount } from "./git.js";

export interface FreshnessResult {
  tazelik: Tazelik;
  head: string;
  delta: IngestRange | null;   // null when fresh
  behind_by: number;           // commits HEAD is ahead of last_indexed
  rewritten: boolean;          // true if last_indexed_sha no longer reachable
}

export function ensureFresh(db: DB, repoPath: string): FreshnessResult {
  const head = revParseHead(repoPath);
  const row = db
    .prepare("SELECT value FROM index_state WHERE key = 'last_indexed_sha'")
    .get() as { value: string } | undefined;

  if (!row) {
    return {
      tazelik: "bootstrapping",
      head,
      delta: { from: null, to: head },
      behind_by: 0,
      rewritten: false,
    };
  }

  const last = row.value;
  if (last === head) {
    return { tazelik: "fresh", head, delta: null, behind_by: 0, rewritten: false };
  }

  const reachable = isAncestor(repoPath, last, head);
  if (!reachable) {
    return {
      tazelik: "bootstrapping",
      head,
      delta: { from: null, to: head },
      behind_by: 0,
      rewritten: true,
    };
  }

  const behind_by = revListCount(repoPath, last, head);
  return {
    tazelik: "catching_up",
    head,
    delta: { from: last, to: head },
    behind_by,
    rewritten: false,
  };
}
