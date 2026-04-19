// src/memory/api.ts
// Main-thread orchestration: ensureFresh → collect signals → envelope.
// Ingest is delegated to the worker pool.

import { openDatabase, type DB } from "./db.js";
import { runMigrations } from "./schema.js";
import { ensureFresh } from "./freshness.js";
import { collectSignals } from "./signals/index.js";
import { computeScoreAndConfidence } from "./confidence.js";
import { buildEnvelope } from "./envelope.js";
import { WorkerPool } from "./pool.js";
import { countCommits, isShallowRepo } from "./git.js";
import type {
  BlastRadiusInput,
  BlastRadiusResponse,
  DegradedStatus,
  Tazelik,
} from "./types.js";

const EMPTY_REPO_THRESHOLD = 10;

export interface MemoryAPIOptions {
  dbPath: string;
  repoPath: string;
  workerPoolSize?: number;
}

export class MemoryAPI {
  private db: DB;
  private pool: WorkerPool;
  private readonly dbPath: string;
  private readonly repoPath: string;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(opts: MemoryAPIOptions) {
    this.dbPath = opts.dbPath;
    this.repoPath = opts.repoPath;
    this.db = openDatabase(opts.dbPath);
    runMigrations(this.db);
    this.pool = new WorkerPool({ size: opts.workerPoolSize ?? 1 });
  }

  async bootstrapIfNeeded(): Promise<void> {
    if (this.bootstrapPromise) return this.bootstrapPromise;

    const fresh = ensureFresh(this.db, this.repoPath);
    if (fresh.tazelik === "fresh" || !fresh.delta) return;

    this.bootstrapPromise = this.pool
      .runIngest({ dbPath: this.dbPath, repoPath: this.repoPath, range: fresh.delta })
      .then(() => undefined)
      .finally(() => {
        this.bootstrapPromise = null;
      });
    return this.bootstrapPromise;
  }

  async blastradius(input: BlastRadiusInput): Promise<BlastRadiusResponse> {
    const start = Date.now();

    // 1. Degraded detection: shallow clone
    if (isShallowRepo(this.repoPath)) {
      return buildEnvelope({
        status: "shallow_clone",
        signals: [],
        score: 0,
        confidence: 0,
        tazelik: "fresh",
        indexedThrough: "",
        indexedTotal: 0,
        queryMs: Date.now() - start,
        reason: "shallow clone detected; run `composto index --deepen`",
      });
    }

    // 2. Degraded detection: empty / insufficient
    const totalCommits = countCommits(this.repoPath);
    if (totalCommits < EMPTY_REPO_THRESHOLD) {
      return buildEnvelope({
        status: "empty_repo",
        signals: [],
        score: 0,
        confidence: 0,
        tazelik: "fresh",
        indexedThrough: "",
        indexedTotal: totalCommits,
        queryMs: Date.now() - start,
        reason: `repo has ${totalCommits} commits; blastradius requires >= ${EMPTY_REPO_THRESHOLD}`,
      });
    }

    // 3. Freshness + deferred delta ingest
    const fresh = ensureFresh(this.db, this.repoPath);
    let status: DegradedStatus = "ok";
    const partial = false;

    if (fresh.tazelik === "bootstrapping") {
      await this.bootstrapIfNeeded();
    } else if (fresh.tazelik === "catching_up" && fresh.delta) {
      // Fire-and-forget: main call answers from current index, delta in background.
      this.pool
        .runIngest({ dbPath: this.dbPath, repoPath: this.repoPath, range: fresh.delta })
        .catch(() => { /* Plan 3 adds logging */ });
    }

    const indexedTotalRow = this.db
      .prepare("SELECT value FROM index_state WHERE key='indexed_commits_total'")
      .get() as { value: string } | undefined;
    const indexedTotal = indexedTotalRow ? parseInt(indexedTotalRow.value, 10) : 0;
    const indexedThrough = (this.db
      .prepare("SELECT value FROM index_state WHERE key='last_indexed_sha'")
      .get() as { value: string } | undefined)?.value ?? "";

    // 4. Signals + math
    const signals = collectSignals(this.db, input.file);
    const tazelik: Tazelik = fresh.tazelik === "bootstrapping" ? "fresh" : fresh.tazelik;
    const { score, confidence } = computeScoreAndConfidence(signals, {
      tazelik,
      partial,
      totalCommits: indexedTotal,
    });

    return buildEnvelope({
      status,
      signals,
      score,
      confidence,
      tazelik,
      indexedThrough,
      indexedTotal,
      queryMs: Date.now() - start,
    });
  }

  async close(): Promise<void> {
    this.db.close();
    await this.pool.close();
  }
}
