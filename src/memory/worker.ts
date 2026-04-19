// src/memory/worker.ts
// Worker thread entry. Accepts {type: 'ingest'} messages and runs tier1 ingest.
// Uses its own DB connection; main thread's DB is separate.

import { parentPort } from "node:worker_threads";
import { openDatabase } from "./db.js";
import { runMigrations } from "./schema.js";
import { ingestRange } from "./ingest/tier1.js";
import type { IngestRange } from "./types.js";

type InMessage =
  | { type: "ingest"; jobId: number; dbPath: string; repoPath: string; range: IngestRange };

type OutMessage =
  | { type: "ingest_done"; jobId: number; commits: number }
  | { type: "ingest_error"; jobId: number; message: string };

if (!parentPort) {
  throw new Error("memory/worker.ts must run inside a Worker");
}

parentPort.on("message", (msg: InMessage) => {
  if (msg.type === "ingest") {
    try {
      const db = openDatabase(msg.dbPath);
      runMigrations(db);
      const n = ingestRange(db, msg.repoPath, msg.range);
      db.close();
      const out: OutMessage = { type: "ingest_done", jobId: msg.jobId, commits: n };
      parentPort!.postMessage(out);
    } catch (err) {
      const out: OutMessage = {
        type: "ingest_error",
        jobId: msg.jobId,
        message: err instanceof Error ? err.message : String(err),
      };
      parentPort!.postMessage(out);
    }
  }
});
