// src/memory/pool.ts
// Main-thread worker pool. Plan 1 uses size=1 by default; parallelism
// is added in Plan 2 when bootstrap ranges get partitioned.

import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { IngestRange } from "./types.js";

export interface IngestResult {
  status: "done";
  commits: number;
}

interface PendingJob {
  resolve: (r: IngestResult) => void;
  reject: (err: Error) => void;
}

function resolveWorkerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // When this code runs as dist/memory/pool.js or dist/memory/api.js,
  // worker.js is a sibling in the same directory.
  // When inlined into dist/index.js, worker.js is in the memory/ sub-dir.
  if (here.endsWith("/memory") || here.endsWith("\\memory")) {
    return join(here, "worker.js");
  }
  return join(here, "memory", "worker.js");
}

export class WorkerPool {
  private workers: Worker[] = [];
  private nextJobId = 1;
  private pending = new Map<number, PendingJob>();

  constructor(opts: { size?: number } = {}) {
    const size = Math.max(1, opts.size ?? 1);
    for (let i = 0; i < size; i++) this.spawn();
  }

  private spawn(): void {
    const worker = new Worker(resolveWorkerPath());
    worker.on("message", (msg: any) => {
      const job = this.pending.get(msg.jobId);
      if (!job) return;
      this.pending.delete(msg.jobId);
      if (msg.type === "ingest_done") {
        job.resolve({ status: "done", commits: msg.commits });
      } else if (msg.type === "ingest_error") {
        job.reject(new Error(msg.message));
      }
    });
    worker.on("error", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const job of this.pending.values()) job.reject(error);
      this.pending.clear();
    });
    this.workers.push(worker);
  }

  runIngest(args: { dbPath: string; repoPath: string; range: IngestRange }): Promise<IngestResult> {
    const jobId = this.nextJobId++;
    const worker = this.workers[jobId % this.workers.length];
    return new Promise((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject });
      worker.postMessage({ type: "ingest", jobId, ...args });
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.pending.clear();
  }
}
