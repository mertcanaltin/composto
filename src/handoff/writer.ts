import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { buildHandoff, type Handoff } from "./builder.js";

export interface HandoffCache {
  /** True if the stable prefix is byte-identical to the last saved handoff. */
  prefixReused: boolean;
  /** True if the delta is byte-identical to the last saved handoff. */
  deltaReused: boolean;
}

export interface SavedHandoff extends Handoff {
  cache: HandoffCache;
}

export function handoffPath(projectPath: string): string {
  return join(projectPath, ".composto", "handoff.json");
}

function readPrevious(outPath: string): Handoff | null {
  if (!existsSync(outPath)) return null;
  try { return JSON.parse(readFileSync(outPath, "utf-8")) as Handoff; } catch { return null; }
}

export interface WriteHandoffOptions {
  /** Build/return only — do not persist artifacts. */
  noSave?: boolean;
  /** Injected for deterministic tests; defaults to Date.now() at call time. */
  now?: number;
}

/**
 * Build the handoff, diff it against the last saved one for cache-reuse signal,
 * and (unless noSave) persist .composto/handoff.json plus an append-only
 * metrics line. The artifact itself is timestamp-free so it stays deterministic
 * — only the metrics log carries wall-clock.
 */
export async function writeHandoff(
  projectPath: string,
  opts: WriteHandoffOptions = {},
): Promise<SavedHandoff> {
  const outPath = handoffPath(projectPath);
  const prev = readPrevious(outPath);
  const handoff = await buildHandoff(projectPath);

  const cache: HandoffCache = {
    prefixReused: prev?.prefixHash === handoff.prefixHash,
    deltaReused: prev?.deltaHash === handoff.deltaHash,
  };
  const saved: SavedHandoff = { ...handoff, cache };

  if (!opts.noSave) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(saved, null, 2));
    const metric = {
      ts: opts.now ?? Date.now(),
      sha: handoff.generatedAtSha,
      prefixHash: handoff.prefixHash,
      deltaHash: handoff.deltaHash,
      combinedHash: handoff.combinedHash,
      prefixReused: cache.prefixReused,
      deltaReused: cache.deltaReused,
      changedFiles: handoff.delta.changedFiles.length,
    };
    appendFileSync(join(dirname(outPath), "handoff.metrics.log"), JSON.stringify(metric) + "\n");
  }

  return saved;
}

/** Human-readable one-screen summary of a handoff for the terminal. */
export function formatHandoff(h: SavedHandoff): string {
  const lines: string[] = [];
  lines.push(`composto handoff — @ ${h.generatedAtSha}, ${h.prefix.fileCount} files`);
  lines.push(`  prefix ${h.prefixHash}${h.cache.prefixReused ? " (reused)" : ""}  delta ${h.deltaHash}${h.cache.deltaReused ? " (reused)" : ""}`);

  const changed = h.delta.changedFiles;
  if (changed.length === 0) {
    lines.push("  no changed source files vs HEAD");
  } else {
    const tokens = changed.reduce((s, f) => s + f.tokens, 0);
    lines.push(`\n  Changed (${changed.length}, ~${tokens} tok of IR):`);
    for (const f of changed) {
      const risk = h.delta.riskFiles.includes(f.path) ? "  ⚠ hotspot" : "";
      lines.push(`    ${f.status.padEnd(8)} ${f.path}${risk}`);
    }
  }

  if (h.prefix.hotspots.length > 0) {
    lines.push(`\n  Risk hotspots: ${h.prefix.hotspots.slice(0, 5).map(s => s.file).join(", ")}`);
  }
  return lines.join("\n");
}

/** Read the last saved handoff artifact, or null if none exists. */
export function readLatestHandoff(projectPath: string): SavedHandoff | null {
  const outPath = handoffPath(projectPath);
  if (!existsSync(outPath)) return null;
  try { return JSON.parse(readFileSync(outPath, "utf-8")) as SavedHandoff; } catch { return null; }
}
