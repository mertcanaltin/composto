#!/usr/bin/env tsx
// Per-signal diagnostic for Plan 5b.
//
// The proof v2 says: with revert_match excluded, recall collapses to ~3%
// (composto) or ~32% (picomatch). That tells us the four non-revert
// signals barely fire pre-break — but it doesn't tell us *why*. This
// script answers: for each signal, on each fix_file at pre-break SHA,
// what strength did it return? What's its sample_size? When does it stay
// dark?
//
// We re-walk the same per-event ingest pattern as time-travel.ts but
// don't go through scoring — we record raw signal output per file.
//
// Usage:
//   pnpm exec tsx scripts/backtest/diagnose-signals.ts <repoPath> [--max-events N]

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import Database from "better-sqlite3";
import { openDatabase } from "../../src/memory/db.js";
import { runMigrations } from "../../src/memory/schema.js";
import { ingestRange } from "../../src/memory/ingest/tier1.js";
import { collectSignals } from "../../src/memory/signals/index.js";
import type { Signal, SignalType } from "../../src/memory/types.js";

const SIGNAL_TYPES: SignalType[] = [
  "revert_match",
  "hotspot",
  "fix_ratio",
  "author_churn",
];

function parseArgs() {
  const args = process.argv.slice(2);
  let repoPath: string | null = null;
  let maxEvents = 40;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--max-events") {
      maxEvents = Number(args[++i]);
    } else if (!args[i].startsWith("--")) {
      repoPath = args[i];
    }
  }
  if (!repoPath) throw new Error("repoPath required");
  return { repoPath, maxEvents };
}

function ingestToSha(repoPath: string, dbPath: string, sha: string): void {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true });
  for (const ext of ["-wal", "-shm"]) {
    if (existsSync(dbPath + ext)) rmSync(dbPath + ext, { force: true });
  }
  const db = openDatabase(dbPath);
  try {
    runMigrations(db);
    ingestRange(db, repoPath, { from: null, to: sha });
  } finally {
    db.close();
  }
}

interface Row {
  suspected_break_sha: string;
  fix_commit_sha: string;
}

interface SignalRecord {
  event_idx: number;
  break_sha: string;
  file: string;
  signals: Record<SignalType, { strength: number; precision: number; sample_size: number }>;
}

interface AggregatedStats {
  signal: SignalType;
  total_observations: number;
  fired_count: number;            // strength > 0
  fire_rate: number;              // fired / total
  median_strength_when_fired: number;
  p90_strength_when_fired: number;
  median_sample_size_overall: number;
  median_sample_size_when_fired: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function p90(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.9)];
}

function aggregate(records: SignalRecord[]): AggregatedStats[] {
  return SIGNAL_TYPES.map((type) => {
    const all = records.map((r) => r.signals[type]);
    const fired = all.filter((s) => s.strength > 0);
    return {
      signal: type,
      total_observations: all.length,
      fired_count: fired.length,
      fire_rate: all.length === 0 ? 0 : fired.length / all.length,
      median_strength_when_fired: median(fired.map((s) => s.strength)),
      p90_strength_when_fired: p90(fired.map((s) => s.strength)),
      median_sample_size_overall: median(all.map((s) => s.sample_size)),
      median_sample_size_when_fired: median(fired.map((s) => s.sample_size)),
    };
  });
}

function asRecord(signals: Signal[]): SignalRecord["signals"] {
  const out = {} as SignalRecord["signals"];
  for (const t of SIGNAL_TYPES) {
    const s = signals.find((sig) => sig.type === t);
    out[t] = s
      ? { strength: s.strength, precision: s.precision, sample_size: s.sample_size }
      : { strength: 0, precision: 0, sample_size: 0 };
  }
  return out;
}

async function main() {
  const { repoPath, maxEvents } = parseArgs();
  const repoName = basename(repoPath);
  const workDir = mkdtempSync(join(tmpdir(), `composto-diag-${repoName}-`));
  console.error(`[diagnose] repo: ${repoPath}`);
  console.error(`[diagnose] workDir: ${workDir}`);

  try {
    // Step 1: full ingest as ground-truth source.
    const sourceDbPath = join(workDir, "source.db");
    ingestToSha(repoPath, sourceDbPath, execSync("git rev-parse HEAD", { cwd: repoPath, encoding: "utf-8" }).trim());

    const db = new Database(sourceDbPath, { readonly: true });
    const events = db
      .prepare(`
        SELECT fl.suspected_break_sha,
               fl.fix_commit_sha
          FROM fix_links fl
          JOIN commits c_break ON c_break.sha = fl.suspected_break_sha
         WHERE fl.evidence_type IN ('revert_marker', 'short_followup_fix')
           AND c_break.parent_sha IS NOT NULL
         ORDER BY c_break.timestamp ASC
         LIMIT ?
      `)
      .all(maxEvents) as Row[];

    const fixFilesByEvent = events.map((ev) => ({
      ev,
      files: (db
        .prepare(`SELECT file_path FROM file_touches WHERE commit_sha = ?`)
        .all(ev.fix_commit_sha) as Array<{ file_path: string }>).map((r) => r.file_path),
    }));
    db.close();

    // Step 2: per-event time-travel + signal collection.
    const records: SignalRecord[] = [];
    for (let i = 0; i < fixFilesByEvent.length; i++) {
      const { ev, files } = fixFilesByEvent[i];
      if (files.length === 0) continue;
      if (i % 5 === 0) console.error(`[diagnose] event ${i}/${fixFilesByEvent.length}`);

      const eventDbPath = join(workDir, `event-${i}.db`);
      ingestToSha(repoPath, eventDbPath, ev.suspected_break_sha);

      const queryDb = openDatabase(eventDbPath);
      try {
        runMigrations(queryDb);
        for (const file of files) {
          const signals = collectSignals(queryDb, repoPath, file);
          records.push({
            event_idx: i,
            break_sha: ev.suspected_break_sha,
            file,
            signals: asRecord(signals),
          });
        }
      } finally {
        queryDb.close();
      }
      rmSync(eventDbPath, { force: true });
      for (const ext of ["-wal", "-shm"]) {
        if (existsSync(eventDbPath + ext)) rmSync(eventDbPath + ext, { force: true });
      }
    }

    // Step 3: aggregate and report.
    const stats = aggregate(records);
    const report = {
      repo: repoName,
      events: fixFilesByEvent.length,
      observations: records.length,
      per_signal: stats,
    };
    console.log(JSON.stringify(report, null, 2));

    // Step 4: dump raw records for follow-up analysis.
    const outDir = join(process.cwd(), "scripts/backtest/out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, `diagnose-${repoName}.json`),
      JSON.stringify({ report, records }, null, 2)
    );
    console.error(`[diagnose] raw records: scripts/backtest/out/diagnose-${repoName}.json`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
