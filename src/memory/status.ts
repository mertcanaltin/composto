// src/memory/status.ts
// Produces the data block rendered by `composto index --status`.

import { existsSync, statSync } from "node:fs";
import type { DB } from "./db.js";
import { openDatabase } from "./db.js";

export interface StatusReport {
  schemaVersion: number;
  bootstrapped: boolean;
  indexedCommitsThrough: string;
  indexedCommitsTotal: number;
  filesWithDeepIndex: number;
  calibrationLastRefreshedAt: number | null;
  calibrationRows: number;
  storageBytes: number;
  integrityOk: boolean;
}

export function collectStatus(dbPath: string): StatusReport {
  const db = openDatabase(dbPath);
  try {
    const schemaVersion = db.pragma("user_version", { simple: true }) as number;

    const totalRow = db.prepare(
      "SELECT value FROM index_state WHERE key='indexed_commits_total'"
    ).get() as { value: string } | undefined;
    const headRow = db.prepare(
      "SELECT value FROM index_state WHERE key='last_indexed_sha'"
    ).get() as { value: string } | undefined;
    const calRefreshRow = db.prepare(
      "SELECT value FROM index_state WHERE key='calibration_last_refreshed_at'"
    ).get() as { value: string } | undefined;

    const filesWithDeepIndex = (db
      .prepare("SELECT COUNT(*) AS n FROM file_index_state")
      .get() as { n: number }).n;
    const calibrationRows = (db
      .prepare("SELECT COUNT(*) AS n FROM signal_calibration")
      .get() as { n: number }).n;

    const storageBytes = statFileSize(dbPath) + statFileSize(dbPath + "-wal") + statFileSize(dbPath + "-shm");
    const integrityOk =
      ((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check === "ok");

    return {
      schemaVersion,
      bootstrapped: !!headRow,
      indexedCommitsThrough: headRow?.value ?? "",
      indexedCommitsTotal: totalRow ? parseInt(totalRow.value, 10) : 0,
      filesWithDeepIndex,
      calibrationLastRefreshedAt: calRefreshRow ? parseInt(calRefreshRow.value, 10) : null,
      calibrationRows,
      storageBytes,
      integrityOk,
    };
  } finally {
    db.close();
  }
}

function statFileSize(path: string): number {
  try {
    return existsSync(path) ? statSync(path).size : 0;
  } catch {
    return 0;
  }
}
