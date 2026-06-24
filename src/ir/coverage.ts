import { relative } from "node:path";
import { collectFiles } from "../utils/collectFiles.js";
import { ALL_EXTENSIONS } from "./extensions.js";
import { GENERIC_EXTENSIONS } from "./generic.js";

// Code-ish extensions Composto might encounter. The point is not to parse these
// (most aren't supported yet) but to NOTICE them, so the navigation map can tell
// the truth about what it cannot see instead of silently shrinking to whatever
// few languages are supported — the failure mode the `ada` (C++) repo exposed.
const CODE_UNIVERSE = [
  ...ALL_EXTENSIONS,       // Tier 1: deep tree-sitter IR
  ...GENERIC_EXTENSIONS,   // Tier 2: grammar-free structural IR
  ".rb", ".lua", ".ex", ".exs", ".sol", ".sh", ".bash", // still unsupported — surfaced honestly
];

// Anything we attempt to index (deep or structural) counts as covered; the
// warning is reserved for code we genuinely can't represent at all.
const SUPPORTED = new Set([...ALL_EXTENSIONS, ...GENERIC_EXTENSIONS]);

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(i);
}

export interface Coverage {
  indexed: number;
  /** Code files present but in a language Composto can't index yet. */
  unsupported: number;
  /** Per-extension counts of unsupported files, biggest first. */
  byExtension: { ext: string; count: number }[];
}

/**
 * Scan the project for code files and partition them into "indexed" (a language
 * we support) vs "unsupported". Used to stamp an honest coverage line on the
 * navigation map so an agent never mistakes a partial map for a complete one.
 */
export function analyzeCoverage(projectPath: string): Coverage {
  const all = collectFiles(projectPath, CODE_UNIVERSE);
  const counts = new Map<string, number>();
  let indexed = 0;
  let unsupported = 0;

  for (const file of all) {
    const ext = extOf(relative(projectPath, file));
    if (SUPPORTED.has(ext)) {
      indexed++;
    } else {
      unsupported++;
      counts.set(ext, (counts.get(ext) ?? 0) + 1);
    }
  }

  const byExtension = [...counts.entries()]
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count);

  return { indexed, unsupported, byExtension };
}

/**
 * A one-line coverage warning for the map header, or "" when coverage is total.
 * Honest by construction: names the unsupported extensions and their counts.
 */
export function coverageWarning(cov: Coverage): string {
  if (cov.unsupported === 0) return "";
  const total = cov.indexed + cov.unsupported;
  const pct = Math.round((cov.indexed / total) * 100);
  const top = cov.byExtension.slice(0, 6).map(e => `${e.ext} (${e.count})`).join(", ");
  return (
    `\n⚠ COVERAGE: indexed ${cov.indexed}/${total} code files (${pct}%). ` +
    `Composto does not yet parse ${cov.unsupported} files in unsupported languages: ${top}.\n` +
    `These files are INVISIBLE to this map — do NOT assume the repo is fully represented here; ` +
    `search them directly.\n`
  );
}
