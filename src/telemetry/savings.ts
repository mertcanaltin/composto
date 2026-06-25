// Cumulative token-savings counter for the auto-compression read hook.
//
// Deliberately a flat JSON file (.composto/savings.json), NOT a DB table:
// the hook runs in a short-lived subprocess on every Read, so the counter
// must survive process death with zero migration and zero locking risk.
// Every operation is best-effort and MUST NEVER throw — a counter write
// failing must never break the hook (the agent would hang).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SavingsState {
  totalSavedTokens: number;
  compressedReads: number;
  firstTs: number | null; // unix seconds of first recorded saving
}

const FILE_NAME = "savings.json";
const EMPTY: SavingsState = { totalSavedTokens: 0, compressedReads: 0, firstTs: null };

function filePath(compostoDir: string): string {
  return join(compostoDir, FILE_NAME);
}

export function readSavings(compostoDir: string): SavingsState {
  try {
    const p = filePath(compostoDir);
    if (!existsSync(p)) return { ...EMPTY };
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return {
      totalSavedTokens: Number(parsed.totalSavedTokens) || 0,
      compressedReads: Number(parsed.compressedReads) || 0,
      firstTs: typeof parsed.firstTs === "number" ? parsed.firstTs : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Add `savedTokens` to the cumulative counter. `nowSec` is injected so the
 * caller controls time (Date.now is unavailable in some sandboxes). Returns
 * the updated state for convenience; on any failure returns the prior state.
 */
export function recordSavings(compostoDir: string, savedTokens: number, nowSec: number): SavingsState {
  const prior = readSavings(compostoDir);
  if (!Number.isFinite(savedTokens) || savedTokens <= 0) return prior;
  const next: SavingsState = {
    totalSavedTokens: prior.totalSavedTokens + Math.round(savedTokens),
    compressedReads: prior.compressedReads + 1,
    firstTs: prior.firstTs ?? nowSec,
  };
  try {
    const dir = dirname(filePath(compostoDir));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath(compostoDir), JSON.stringify(next), "utf8");
  } catch {
    return prior;
  }
  return next;
}
