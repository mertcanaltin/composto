// Phase 1 P1.4 — hook invocation telemetry.
//
// recordInvocation  writes one row to hook_invocations. MUST be best-effort:
//                   every SQLite failure is swallowed. A telemetry write
//                   must never propagate an error that could break a hook
//                   call — the agent would hang.
//
// recentSummary    reads rows in a time window (default: last 7d) and
//                   aggregates total count, verdict buckets, platform
//                   buckets, p50/p95 latency, cache-hit rate.
//
// Opt-out contract: if `.composto/telemetry-disabled` exists next to the
// DB file, recordInvocation silently no-ops. `composto stats --disable`
// creates that marker. This is the documented privacy opt-out.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DB } from "../db.js";

export interface HookInvocationRecord {
  timestamp: number;           // unix seconds
  platform: string;            // 'claude-code' | 'cursor' | 'gemini-cli'
  event: string;               // 'pretooluse' | 'beforetool'
  filePath: string | null;
  verdict: string | null;      // null if passthrough or error
  score: number | null;
  confidence: number | null;
  latencyMs: number;
  cacheHit: boolean;
}

export interface SummaryOpts {
  since?: number;              // unix seconds; defaults to now - 7d
  now?: number;                // unix seconds; defaults to Date.now()/1000
}

export interface Summary {
  windowStart: number;
  windowEnd: number;
  total: number;
  byVerdict: Record<string, number>;   // includes 'passthrough' for null verdicts
  byPlatform: Record<string, number>;
  latencyP50: number;
  latencyP95: number;
  cacheHitRate: number;                // 0..1
}

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;
const DISABLE_MARKER_NAME = "telemetry-disabled";

/**
 * Given a DB handle, figure out the path to the `.composto/` directory
 * containing its file. Returns null if the DB is in-memory (no file).
 * Uses better-sqlite3's `.name` property which exposes the original path.
 */
function dbDirectory(db: DB): string | null {
  // better-sqlite3 Database has a `.name` getter with the open path.
  const name = (db as unknown as { name?: string }).name;
  if (typeof name !== "string" || name.length === 0 || name === ":memory:") {
    return null;
  }
  return dirname(name);
}

export function isTelemetryDisabled(db: DB): boolean {
  const dir = dbDirectory(db);
  if (!dir) return false;
  try {
    return existsSync(join(dir, DISABLE_MARKER_NAME));
  } catch {
    return false;
  }
}

export function recordInvocation(db: DB, record: HookInvocationRecord): void {
  try {
    if (isTelemetryDisabled(db)) return;
    const stmt = db.prepare(
      `INSERT INTO hook_invocations
         (timestamp, platform, event, file_path, verdict, score, confidence, latency_ms, cache_hit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      record.timestamp,
      record.platform,
      record.event,
      record.filePath,
      record.verdict,
      record.score,
      record.confidence,
      record.latencyMs,
      record.cacheHit ? 1 : 0,
    );
  } catch {
    // best-effort: telemetry must never break the hook.
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  // nearest-rank — simple and stable for small samples.
  const rank = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[rank];
}

export function recentSummary(db: DB, opts: SummaryOpts = {}): Summary {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const since = opts.since ?? now - SEVEN_DAYS_SEC;

  const empty: Summary = {
    windowStart: since,
    windowEnd: now,
    total: 0,
    byVerdict: {},
    byPlatform: {},
    latencyP50: 0,
    latencyP95: 0,
    cacheHitRate: 0,
  };

  let rows: Array<{
    platform: string;
    verdict: string | null;
    latency_ms: number;
    cache_hit: number;
  }>;
  try {
    rows = db
      .prepare(
        `SELECT platform, verdict, latency_ms, cache_hit
         FROM hook_invocations
         WHERE timestamp >= ? AND timestamp <= ?`,
      )
      .all(since, now) as typeof rows;
  } catch {
    return empty;
  }

  if (rows.length === 0) return empty;

  const byVerdict: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  const latencies: number[] = [];
  let cacheHits = 0;

  for (const r of rows) {
    const v = r.verdict == null || r.verdict === "" ? "passthrough" : r.verdict;
    byVerdict[v] = (byVerdict[v] ?? 0) + 1;
    byPlatform[r.platform] = (byPlatform[r.platform] ?? 0) + 1;
    latencies.push(r.latency_ms);
    if (r.cache_hit === 1) cacheHits++;
  }

  latencies.sort((a, b) => a - b);

  return {
    windowStart: since,
    windowEnd: now,
    total: rows.length,
    byVerdict,
    byPlatform,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    cacheHitRate: rows.length > 0 ? cacheHits / rows.length : 0,
  };
}
