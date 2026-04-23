// src/memory/schema.ts
// Composto memory schema v1 — embedded as a string constant so dist bundling
// never needs to resolve file paths. See spec §4.1.

import type { DB } from "./db.js";

const CURRENT_VERSION = 3;

// v2: covering index for the join in deriveFixLinks short_followup_fix
// (file_touches.file_path → commit_sha). Without this, derivation on
// large repos (10K+ commits) takes 10+ seconds; with it, ~1-2 seconds.
const V2_SQL = `
CREATE INDEX IF NOT EXISTS idx_ft_file_commit ON file_touches(file_path, commit_sha);
`;

// v3: hook_invocations telemetry log (Phase 1 P1.4). Records every hook
// firing so `composto stats` can surface fire-rate, verdict mix, latency.
// Local-only; never leaves the project .composto/memory.db.
const V3_SQL = `
CREATE TABLE IF NOT EXISTS hook_invocations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       INTEGER NOT NULL,
  platform        TEXT NOT NULL,
  event           TEXT NOT NULL,
  file_path       TEXT,
  verdict         TEXT,
  score           REAL,
  confidence      REAL,
  latency_ms      INTEGER NOT NULL,
  cache_hit       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hi_timestamp ON hook_invocations(timestamp);
`;

const V1_SQL = `
CREATE TABLE IF NOT EXISTS index_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commits (
  sha         TEXT PRIMARY KEY,
  parent_sha  TEXT,
  author      TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,
  subject     TEXT NOT NULL,
  is_fix      INTEGER NOT NULL,
  is_revert   INTEGER NOT NULL,
  reverts_sha TEXT,
  FOREIGN KEY (reverts_sha) REFERENCES commits(sha)
);
CREATE INDEX IF NOT EXISTS idx_commits_timestamp ON commits(timestamp);
CREATE INDEX IF NOT EXISTS idx_commits_is_fix    ON commits(is_fix) WHERE is_fix = 1;

CREATE TABLE IF NOT EXISTS file_touches (
  commit_sha    TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  adds          INTEGER NOT NULL,
  dels          INTEGER NOT NULL,
  change_type   TEXT NOT NULL,
  renamed_from  TEXT,
  PRIMARY KEY (commit_sha, file_path),
  FOREIGN KEY (commit_sha) REFERENCES commits(sha)
);
CREATE INDEX IF NOT EXISTS idx_ft_file ON file_touches(file_path);

CREATE TABLE IF NOT EXISTS symbols (
  id              INTEGER PRIMARY KEY,
  file_path       TEXT NOT NULL,
  kind            TEXT NOT NULL,
  qualified_name  TEXT NOT NULL,
  first_seen_sha  TEXT NOT NULL,
  last_seen_sha   TEXT,
  UNIQUE (file_path, kind, qualified_name)
);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);

CREATE TABLE IF NOT EXISTS symbol_touches (
  commit_sha    TEXT NOT NULL,
  symbol_id     INTEGER NOT NULL,
  change_type   TEXT NOT NULL,
  PRIMARY KEY (commit_sha, symbol_id),
  FOREIGN KEY (commit_sha) REFERENCES commits(sha),
  FOREIGN KEY (symbol_id)  REFERENCES symbols(id)
);
CREATE INDEX IF NOT EXISTS idx_st_symbol ON symbol_touches(symbol_id);

CREATE TABLE IF NOT EXISTS fix_links (
  fix_commit_sha       TEXT NOT NULL,
  suspected_break_sha  TEXT NOT NULL,
  evidence_type        TEXT NOT NULL,
  confidence           REAL NOT NULL,
  window_hours         INTEGER,
  PRIMARY KEY (fix_commit_sha, suspected_break_sha, evidence_type),
  FOREIGN KEY (fix_commit_sha)      REFERENCES commits(sha),
  FOREIGN KEY (suspected_break_sha) REFERENCES commits(sha)
);
CREATE INDEX IF NOT EXISTS idx_fl_break ON fix_links(suspected_break_sha);

CREATE TABLE IF NOT EXISTS signal_calibration (
  signal_type        TEXT PRIMARY KEY,
  precision          REAL NOT NULL,
  sample_size        INTEGER NOT NULL,
  last_computed_sha  TEXT NOT NULL,
  computed_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_index_state (
  file_path            TEXT PRIMARY KEY,
  last_commit_indexed  TEXT NOT NULL,
  last_blob_indexed    TEXT,
  indexed_at           INTEGER NOT NULL,
  parse_failed         INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (last_commit_indexed) REFERENCES commits(sha)
);
`;

export function runMigrations(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current >= CURRENT_VERSION) return;

  db.exec("BEGIN");
  try {
    if (current < 1) db.exec(V1_SQL);
    if (current < 2) db.exec(V2_SQL);
    if (current < 3) db.exec(V3_SQL);
    db.pragma(`user_version = ${CURRENT_VERSION}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
