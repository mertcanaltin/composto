// Plan 5b — Time-travel BlastRadius backtest.
//
// The v1 backtest (scripts/blastradius-backtest.ts) queries the production
// BlastRadius signal against HEAD and compares its medium|high verdict to
// fix_links ground truth. Two honest limitations:
//
//   1. revert_match reads directly from fix_links, so it's tautological on
//      a HEAD-state DB.
//   2. The DB at HEAD contains every fix that ever landed — the signal
//      cannot possibly miss a file whose fix is already indexed.
//
// This harness rewinds the DB to the pre-fix state (commits up to and
// including the "suspected break" but NOT the subsequent fix), runs signal
// collection + scoring, and asks "would BlastRadius have flagged this file
// before we knew the fix was coming?" It supports --exclude-signal to
// measure precision/recall without a given signal — used for
// signal-attributed P/R where we exclude revert_match, the one signal that
// directly reads fix_links.
//
// Design note (see docs/blastradius-proof-v2.md): for v1 we use the
// "ingest cutoff" approach (option A in the Plan 5b spec) — each event
// builds a fresh DB ingested up to the break SHA. This matches the
// existing --since semantics in api.ts and avoids schema changes. The
// trade-off is speed: each event re-ingests from scratch. For large repos
// we cap events via maxEvents (sampled deterministically).

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openDatabase } from "../../src/memory/db.js";
import { runMigrations } from "../../src/memory/schema.js";
import { ingestRange } from "../../src/memory/ingest/tier1.js";
import { collectSignals } from "../../src/memory/signals/index.js";
import { computeScoreAndConfidence } from "../../src/memory/confidence.js";
import { mapVerdict } from "../../src/memory/verdict.js";
import type { Signal, Verdict } from "../../src/memory/types.js";

export type SignalType = Signal["type"];

export interface TimeTravelOptions {
  repoPath: string;
  // Directory for per-event scratch DBs. Each event creates one and tears it
  // down after the query (we never keep more than one open at a time to
  // keep memory flat).
  workDir: string;
  // Cap on events to evaluate. Real repos have thousands of fix_links; we
  // sample deterministically (uniform by index) to keep runtime sane.
  maxEvents?: number;
  // Signals whose strength is forced to 0 before scoring. Used to measure
  // non-circular signal contribution (e.g., excludeSignals=['revert_match']
  // drops the one signal that reads fix_links directly).
  excludeSignals?: SignalType[];
  // When true, returns per-event debug records. Off in normal runs because
  // thousands of events produce megabytes of JSON; tests rely on it for
  // self-audit assertions.
  returnDebugEvents?: boolean;
  // Progress hook — invoked every ~10 events. Only for CLI UX.
  onProgress?: (done: number, total: number) => void;
}

export interface TimeTravelEvent {
  suspected_break_sha: string;
  fix_commit_sha: string;
  evidence_type: string;
  // All files that the fix commit touched. These are the "positive set"
  // for recall on this event.
  fix_files: string[];
  // Per-file verdicts recorded pre-fix.
  file_verdicts: Array<{
    file: string;
    verdict: Verdict;
    score: number;
    confidence: number;
    firing_signals: SignalType[];
  }>;
  // Self-audit: at query time, count of fix_links in the scratch DB whose
  // suspected_break_sha equals this event's break. Must be 0 — otherwise
  // the cutoff leaked the fix into the DB and invalidates the eval.
  fix_links_visible_pre_break: number;
}

export interface TimeTravelResult {
  repo: string;
  head: string;
  events_total: number;        // total ground-truth events discovered
  events_evaluated: number;    // after maxEvents cap
  files_predicted: number;     // sum of fix_files across evaluated events
  // Confusion matrix where "positive" means "BlastRadius flagged this
  // file medium|high pre-fix" and "true" means "the fix actually
  // touched this file".
  //
  // By construction fix_files IS the positive set, so fn is simply
  // fix_files not flagged. Files that the fix did NOT touch are not
  // sampled here (we restrict to the pre-fix scope — evaluating every
  // other file in the repo against "this specific fix didn't touch it"
  // would be trivially noisy). This matches spec §9.3's file-level
  // recall semantics.
  tp: number;
  fp: number;
  fn: number;
  flagged_count: number;       // tp + fp
  precision: number;           // tp / (tp + fp)
  recall: number;              // tp / (tp + fn)
  excluded_signals: SignalType[];
  debug_events?: TimeTravelEvent[];
}

// Enumerate ground-truth events from a fully-indexed DB. Each event pairs
// a suspected_break_sha with the fix that followed. We filter to
// 'revert_marker' and 'short_followup_fix' — both have concrete
// temporal ordering we can time-travel against. 'same_region_fix_chain'
// is excluded because its "break" is a heuristic cluster anchor, not a
// real bug-intro commit.
interface Row {
  suspected_break_sha: string;
  fix_commit_sha: string;
  evidence_type: string;
  fix_timestamp: number;
  break_timestamp: number;
  break_parent_sha: string | null;
}

function enumerateEvents(dbPath: string): Row[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(`
        SELECT fl.suspected_break_sha,
               fl.fix_commit_sha,
               fl.evidence_type,
               c_fix.timestamp   AS fix_timestamp,
               c_break.timestamp AS break_timestamp,
               c_break.parent_sha AS break_parent_sha
          FROM fix_links fl
          JOIN commits c_fix   ON c_fix.sha   = fl.fix_commit_sha
          JOIN commits c_break ON c_break.sha = fl.suspected_break_sha
         WHERE fl.evidence_type IN ('revert_marker', 'short_followup_fix')
           AND c_break.parent_sha IS NOT NULL
         ORDER BY c_break.timestamp ASC, fl.suspected_break_sha ASC
      `)
      .all() as Row[];
    return rows;
  } finally {
    db.close();
  }
}

// Sample `n` elements from `arr` deterministically — uniform by index.
// No PRNG: given the same input, same output. Callers can increase
// maxEvents to see more events; the first `n` are always the same set.
function sampleUniform<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

// Per-commit file_touches lookup from a *fully indexed* source DB. We use
// this to know, for each event, which files the fix commit will touch —
// so we can score exactly those files at pre-fix time.
function fetchFixFiles(sourceDbPath: string, fixCommitSha: string): string[] {
  const db = new Database(sourceDbPath, { readonly: true });
  try {
    const rows = db
      .prepare(`SELECT file_path FROM file_touches WHERE commit_sha = ?`)
      .all(fixCommitSha) as Array<{ file_path: string }>;
    return rows.map((r) => r.file_path);
  } finally {
    db.close();
  }
}

// Build (or rebuild) a scratch DB at dbPath ingested with {from: null, to: sha}.
// Runs the migration suite + Tier 1 ingest. Mirrors what MemoryAPI does on
// bootstrap, minus the worker pool — this is a synchronous helper.
function ingestToSha(repoPath: string, dbPath: string, sha: string): void {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true });
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (existsSync(walPath)) rmSync(walPath, { force: true });
  if (existsSync(shmPath)) rmSync(shmPath, { force: true });

  const db = openDatabase(dbPath);
  try {
    runMigrations(db);
    ingestRange(db, repoPath, { from: null, to: sha });
  } finally {
    db.close();
  }
}

// Apply the --exclude-signal policy to a signal list before scoring.
// We zero both strength AND precision so the weighted mean in
// computeScoreAndConfidence treats the signal as absent — per Plan 5b
// spec, just omitting from output isn't enough: the verdict math must run
// as if the signal were never computed.
function applyExclusions(signals: Signal[], excluded: SignalType[]): Signal[] {
  if (excluded.length === 0) return signals;
  const set = new Set(excluded);
  return signals.map((s) =>
    set.has(s.type) ? { ...s, strength: 0, precision: 0 } : s
  );
}

export async function runTimeTravelBacktest(
  opts: TimeTravelOptions
): Promise<TimeTravelResult> {
  const {
    repoPath,
    workDir,
    maxEvents = 40,
    excludeSignals = [],
    returnDebugEvents = false,
    onProgress,
  } = opts;

  mkdirSync(workDir, { recursive: true });
  const head = execSync("git rev-parse HEAD", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  // Step 1: ingest full history into a ground-truth DB. This is the source
  // we enumerate events from and look up fix_files against. Kept for the
  // lifetime of the backtest.
  const sourceDbPath = join(workDir, "source.db");
  ingestToSha(repoPath, sourceDbPath, head);

  // Step 2: enumerate ground-truth events and sample.
  const allEvents = enumerateEvents(sourceDbPath);
  const sampled = sampleUniform(allEvents, maxEvents);

  const debug: TimeTravelEvent[] = [];
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let filesPredicted = 0;

  // Step 3: per-event time-travel query. Each event gets its own scratch
  // DB ingested to the break SHA. We query signals for every file the
  // *fix* will touch (the positive set) and record verdicts.
  for (let i = 0; i < sampled.length; i++) {
    const ev = sampled[i];
    if (onProgress && i % 10 === 0) onProgress(i, sampled.length);

    const fixFiles = fetchFixFiles(sourceDbPath, ev.fix_commit_sha);
    if (fixFiles.length === 0) continue; // fix touched no tracked files

    const eventDbPath = join(workDir, `event-${i}.db`);
    ingestToSha(repoPath, eventDbPath, ev.suspected_break_sha);

    // Self-audit: confirm the fix is NOT in this snapshot.
    const auditDb = new Database(eventDbPath, { readonly: true });
    let fixLinksVisible = 0;
    try {
      fixLinksVisible = (auditDb
        .prepare(`SELECT COUNT(*) AS n FROM fix_links WHERE suspected_break_sha = ?`)
        .get(ev.suspected_break_sha) as { n: number }).n;
    } finally {
      auditDb.close();
    }

    // Now query signals on the pre-fix DB for each file the fix will touch.
    const queryDb = openDatabase(eventDbPath);
    const fileVerdicts: TimeTravelEvent["file_verdicts"] = [];
    try {
      runMigrations(queryDb); // no-op; ensures schema matches
      const indexedTotalRow = queryDb
        .prepare("SELECT value FROM index_state WHERE key='indexed_commits_total'")
        .get() as { value: string } | undefined;
      const indexedTotal = indexedTotalRow
        ? parseInt(indexedTotalRow.value, 10)
        : 0;

      for (const file of fixFiles) {
        const rawSignals = collectSignals(queryDb, repoPath, file);
        const signals = applyExclusions(rawSignals, excludeSignals);
        const { score, confidence } = computeScoreAndConfidence(signals, {
          tazelik: "fresh",
          partial: false,
          totalCommits: indexedTotal,
        });
        const verdict = mapVerdict(score, confidence);
        const firing = signals.filter((s) => s.strength > 0).map((s) => s.type);

        fileVerdicts.push({
          file,
          verdict,
          score,
          confidence,
          firing_signals: firing,
        });
        filesPredicted++;

        // Ground truth for this event: every fix_file IS a positive. Verdict
        // positive = medium|high. We don't count the files NOT touched by
        // this fix against the confusion matrix — that broader "negative
        // set" is ill-defined at this scope (any unrelated file is trivially
        // "negative for THIS fix") and would explode FP.
        if (verdict === "medium" || verdict === "high") tp++;
        else fn++;
      }
    } finally {
      queryDb.close();
    }

    if (returnDebugEvents) {
      debug.push({
        suspected_break_sha: ev.suspected_break_sha,
        fix_commit_sha: ev.fix_commit_sha,
        evidence_type: ev.evidence_type,
        fix_files: fixFiles,
        file_verdicts: fileVerdicts,
        fix_links_visible_pre_break: fixLinksVisible,
      });
    }

    // Tear down event DB to keep disk flat across big runs.
    rmSync(eventDbPath, { force: true });
    const walPath = `${eventDbPath}-wal`;
    const shmPath = `${eventDbPath}-shm`;
    if (existsSync(walPath)) rmSync(walPath, { force: true });
    if (existsSync(shmPath)) rmSync(shmPath, { force: true });
  }

  // fp is measured off the "files the fix didn't touch" dimension, which we
  // declined to sample. In this per-event-positive-set evaluation, fp is
  // always 0 by construction — but precision remains meaningful as tp /
  // (tp + fn) when the negative set is empty; we expose both precision and
  // recall and let the proof doc explain the scope. (Plan 5b v2 could add a
  // per-file negative sample — left for a follow-on.)
  //
  // Update: per Plan 5b spec, we need to also score a *control* set so
  // precision is a real precision (flagged-and-risky / flagged-total). We
  // add a control pass: for each event, sample an equal-sized set of
  // non-fix-touched files present at the pre-fix SHA. If BlastRadius flags
  // any of those medium|high, those count as FP.

  // --- Control pass for FP accounting ---
  // Rationale: without FPs, "precision" is just recall-inverted. The spec's
  // ship gate requires a real precision ≥ 60%, so we need negatives. For
  // each event, draw up to K control files (same cardinality as fix_files,
  // capped at 5) that exist at the pre-fix SHA but weren't touched by this
  // particular fix. Any medium|high verdict on those is FP.
  const CONTROL_CAP = 5;
  for (let i = 0; i < sampled.length; i++) {
    const ev = sampled[i];
    const fixFiles = fetchFixFiles(sourceDbPath, ev.fix_commit_sha);
    if (fixFiles.length === 0) continue;

    const eventDbPath = join(workDir, `event-${i}-ctrl.db`);
    ingestToSha(repoPath, eventDbPath, ev.suspected_break_sha);

    const queryDb = openDatabase(eventDbPath);
    try {
      const indexedTotalRow = queryDb
        .prepare("SELECT value FROM index_state WHERE key='indexed_commits_total'")
        .get() as { value: string } | undefined;
      const indexedTotal = indexedTotalRow
        ? parseInt(indexedTotalRow.value, 10)
        : 0;

      const fixSet = new Set(fixFiles);
      // Pick candidate control files: files that EXIST at pre-fix (i.e.,
      // were touched by some commit in the DB) but aren't in fixSet. We
      // order by timestamp DESC so the controls skew recent — representative
      // of "files a developer might have been working on anyway".
      const controlRows = queryDb
        .prepare(`
          SELECT ft.file_path, MAX(c.timestamp) AS last_ts
            FROM file_touches ft
            JOIN commits c ON c.sha = ft.commit_sha
           GROUP BY ft.file_path
           ORDER BY last_ts DESC
        `)
        .all() as Array<{ file_path: string; last_ts: number }>;

      let taken = 0;
      const cap = Math.min(CONTROL_CAP, fixFiles.length);
      for (const row of controlRows) {
        if (taken >= cap) break;
        if (fixSet.has(row.file_path)) continue;
        taken++;

        const rawSignals = collectSignals(queryDb, repoPath, row.file_path);
        const signals = applyExclusions(rawSignals, excludeSignals);
        const { score, confidence } = computeScoreAndConfidence(signals, {
          tazelik: "fresh",
          partial: false,
          totalCommits: indexedTotal,
        });
        const verdict = mapVerdict(score, confidence);
        if (verdict === "medium" || verdict === "high") fp++;
      }
    } finally {
      queryDb.close();
    }

    rmSync(eventDbPath, { force: true });
    const walPath = `${eventDbPath}-wal`;
    const shmPath = `${eventDbPath}-shm`;
    if (existsSync(walPath)) rmSync(walPath, { force: true });
    if (existsSync(shmPath)) rmSync(shmPath, { force: true });
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);

  // Tear down source DB last.
  rmSync(sourceDbPath, { force: true });
  const srcWal = `${sourceDbPath}-wal`;
  const srcShm = `${sourceDbPath}-shm`;
  if (existsSync(srcWal)) rmSync(srcWal, { force: true });
  if (existsSync(srcShm)) rmSync(srcShm, { force: true });

  const result: TimeTravelResult = {
    repo: repoPath,
    head,
    events_total: allEvents.length,
    events_evaluated: sampled.length,
    files_predicted: filesPredicted,
    tp,
    fp,
    fn,
    flagged_count: tp + fp,
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    excluded_signals: [...excludeSignals],
  };
  if (returnDebugEvents) result.debug_events = debug;
  return result;
}
