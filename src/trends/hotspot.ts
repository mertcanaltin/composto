import type { GitLogEntry, Hotspot } from "../types.js";
import { isBugFixCommit } from "./git-log-parser.js";

export interface HotspotOptions {
  threshold: number;
  fixRatioThreshold: number;
}

export function detectHotspots(entries: GitLogEntry[], options: HotspotOptions): Hotspot[] {
  const fileStats = new Map<string, { changes: number; fixes: number; authors: Set<string> }>();

  for (const entry of entries) {
    const isFix = isBugFixCommit(entry.message);
    for (const file of entry.files) {
      const stats = fileStats.get(file) ?? { changes: 0, fixes: 0, authors: new Set() };
      stats.changes++;
      if (isFix) stats.fixes++;
      stats.authors.add(entry.author);
      fileStats.set(file, stats);
    }
  }

  const hotspots: Hotspot[] = [];
  for (const [file, stats] of fileStats) {
    const fixRatio = stats.changes > 0 ? stats.fixes / stats.changes : 0;
    if (stats.changes >= options.threshold && fixRatio >= options.fixRatioThreshold) {
      hotspots.push({
        file,
        changesInLast30Commits: stats.changes,
        bugFixRatio: fixRatio,
        authorCount: stats.authors.size,
      });
    }
  }

  return hotspots.sort((a, b) => b.changesInLast30Commits - a.changesInLast30Commits);
}
