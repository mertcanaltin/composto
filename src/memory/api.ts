// src/memory/api.ts
// Main-thread orchestration with full degraded-mode handling (spec §6.5 §8.2).

import { openDatabase, type DB } from "./db.js";
import { runMigrations } from "./schema.js";
import { ensureFresh } from "./freshness.js";
import { collectSignals } from "./signals/index.js";
import { computeScoreAndConfidence } from "./confidence.js";
import { buildEnvelope } from "./envelope.js";
import { WorkerPool } from "./pool.js";
import { countCommits, isShallowRepo, revParseHead } from "./git.js";
import { detectSquashed } from "./detectors.js";
import { createFailureTracker, type FailureTracker } from "./failure-tracker.js";
import { createLogger, type Logger } from "./log.js";
import { dirname } from "node:path";
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
  private readonly compostoDir: string;
  private readonly log: Logger;
  private readonly failures: FailureTracker;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(opts: MemoryAPIOptions) {
    this.dbPath = opts.dbPath;
    this.repoPath = opts.repoPath;
    this.compostoDir = dirname(opts.dbPath);
    this.log = createLogger(this.compostoDir);
    this.failures = createFailureTracker(this.compostoDir);
    this.db = openDatabase(opts.dbPath);
    runMigrations(this.db);
    this.pool = new WorkerPool({ size: opts.workerPoolSize ?? 1 });
    this.log.info("api_open", { dbPath: opts.dbPath });
  }

  async bootstrapIfNeeded(): Promise<void> {
    if (this.bootstrapPromise) return this.bootstrapPromise;

    const fresh = ensureFresh(this.db, this.repoPath);
    if (fresh.tazelik === "fresh" || !fresh.delta) return;

    this.bootstrapPromise = this.pool
      .runIngest({ dbPath: this.dbPath, repoPath: this.repoPath, range: fresh.delta })
      .then(() => {
        this.log.info("bootstrap_done", { through: fresh.delta?.to });
      })
      .catch((err: Error) => {
        this.log.error("bootstrap_failed", { message: err.message });
        this.failures.recordFailure("ingest_failure");
        throw err;
      })
      .finally(() => {
        this.bootstrapPromise = null;
      });
    return this.bootstrapPromise;
  }

  // bootstrapFromBoundary indexes only commits between fromSha and HEAD.
  // Used by `composto index --since=YYYY-MM-DD` to bound work on huge repos.
  // Pass fromSha=null to index the full history (same as bootstrapIfNeeded).
  async bootstrapFromBoundary(fromSha: string | null): Promise<void> {
    if (this.bootstrapPromise) return this.bootstrapPromise;
    const head = revParseHead(this.repoPath);
    const range = { from: fromSha, to: head };

    this.bootstrapPromise = this.pool
      .runIngest({ dbPath: this.dbPath, repoPath: this.repoPath, range })
      .then(() => {
        this.log.info("bootstrap_done", { through: range.to, from: range.from });
      })
      .catch((err: Error) => {
        this.log.error("bootstrap_failed", { message: err.message });
        this.failures.recordFailure("ingest_failure");
        throw err;
      })
      .finally(() => {
        this.bootstrapPromise = null;
      });
    return this.bootstrapPromise;
  }

  async blastradius(input: BlastRadiusInput): Promise<BlastRadiusResponse> {
    const start = Date.now();

    // Disabled check first
    if (this.failures.isDisabled()) {
      this.log.warn("call_on_disabled", { file: input.file });
      return buildEnvelope({
        status: "disabled",
        signals: [],
        score: 0,
        confidence: 0,
        tazelik: "fresh",
        indexedThrough: "",
        indexedTotal: 0,
        queryMs: Date.now() - start,
        reason: "tool disabled after repeated failures; clear .composto/failures.json to re-enable",
      });
    }

    try {
      return await this.runQuery(input, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error("internal_error", { file: input.file, message });
      this.failures.recordFailure("internal_error");
      return buildEnvelope({
        status: "internal_error",
        signals: [],
        score: 0,
        confidence: 0,
        tazelik: "fresh",
        indexedThrough: "",
        indexedTotal: 0,
        queryMs: Date.now() - start,
        reason: `internal error: ${message}; see .composto/index.log`,
      });
    }
  }

  private async runQuery(input: BlastRadiusInput, start: number): Promise<BlastRadiusResponse> {
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
        reason: "shallow clone detected; run `git fetch --unshallow` or `composto index --deepen`",
      });
    }

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

    const fresh = ensureFresh(this.db, this.repoPath);
    let status: DegradedStatus = "ok";

    if (fresh.rewritten) {
      status = "reindexing";
      this.log.warn("history_rewritten", { last_indexed: fresh.head });
    }

    if (fresh.tazelik === "bootstrapping") {
      await this.bootstrapIfNeeded();
    } else if (fresh.tazelik === "catching_up" && fresh.delta) {
      this.pool
        .runIngest({ dbPath: this.dbPath, repoPath: this.repoPath, range: fresh.delta })
        .catch((err: Error) => {
          this.log.error("delta_ingest_failed", { message: err.message });
        });
    }

    if (status === "ok" && detectSquashed(this.db)) {
      status = "squashed_history";
    }

    const indexedTotalRow = this.db
      .prepare("SELECT value FROM index_state WHERE key='indexed_commits_total'")
      .get() as { value: string } | undefined;
    const indexedTotal = indexedTotalRow ? parseInt(indexedTotalRow.value, 10) : 0;
    const indexedThrough = (this.db
      .prepare("SELECT value FROM index_state WHERE key='last_indexed_sha'")
      .get() as { value: string } | undefined)?.value ?? "";

    const signals = collectSignals(this.db, this.repoPath, input.file);
    const tazelik: Tazelik = fresh.tazelik === "bootstrapping" ? "fresh" : fresh.tazelik;
    const { score, confidence } = computeScoreAndConfidence(signals, {
      tazelik,
      partial: false,
      totalCommits: indexedTotal,
    });

    const response = buildEnvelope({
      status,
      signals,
      score,
      confidence,
      tazelik,
      indexedThrough,
      indexedTotal,
      queryMs: Date.now() - start,
    });

    this.log.info("query", {
      file: input.file,
      status: response.status,
      verdict: response.verdict,
      confidence: response.confidence,
      query_ms: response.metadata.query_ms,
    });
    this.failures.recordSuccess();
    return response;
  }

  async close(): Promise<void> {
    this.log.info("api_close", {});
    this.log.close();
    this.db.close();
    await this.pool.close();
  }
}
