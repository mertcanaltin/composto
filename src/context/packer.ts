import { generateLayer } from "../ir/layers.js";
import { estimateTokens } from "../benchmark/tokenizer.js";
import type { Hotspot } from "../types.js";

export interface FileInput {
  path: string;
  code: string;
  rawTokens: number;
}

export interface PackEntry {
  path: string;
  layer: "L0" | "L1";
  ir: string;
  tokens: number;
}

export interface PackResult {
  entries: PackEntry[];
  totalTokens: number;
  budget: number;
  filesAtL0: number;
  filesAtL1: number;
}

export async function packContext(
  files: FileInput[],
  options: { budget: number; hotspots: Hotspot[] }
): Promise<PackResult> {
  const { budget, hotspots } = options;
  const hotspotSet = new Set(hotspots.map(h => h.file));

  // Step 1: Generate L0 for all files
  const entries: PackEntry[] = [];
  let totalTokens = 0;

  for (const file of files) {
    const l0 = await generateLayer("L0", { code: file.code, filePath: file.path, health: null });
    const l0Tokens = estimateTokens(l0);
    entries.push({ path: file.path, layer: "L0", ir: l0, tokens: l0Tokens });
    totalTokens += l0Tokens;
  }

  // If L0 already exceeds budget, truncate
  if (totalTokens > budget) {
    const truncated: PackEntry[] = [];
    let used = 0;
    for (const entry of entries) {
      if (used + entry.tokens <= budget) {
        truncated.push(entry);
        used += entry.tokens;
      }
    }
    return { entries: truncated, totalTokens: used, budget, filesAtL0: truncated.length, filesAtL1: 0 };
  }

  // Step 2: Upgrade to L1, hotspots first, then by size (largest first)
  const upgradeOrder = entries
    .map((e, i) => ({ index: i, path: e.path, rawTokens: files[i].rawTokens, isHotspot: hotspotSet.has(e.path) }))
    .sort((a, b) => {
      if (a.isHotspot && !b.isHotspot) return -1;
      if (!a.isHotspot && b.isHotspot) return 1;
      return b.rawTokens - a.rawTokens;
    });

  let filesAtL1 = 0;

  for (const item of upgradeOrder) {
    const file = files[item.index];
    const l1 = await generateLayer("L1", { code: file.code, filePath: file.path, health: null });
    const l1Tokens = estimateTokens(l1);
    const currentL0Tokens = entries[item.index].tokens;
    const additionalTokens = l1Tokens - currentL0Tokens;

    if (totalTokens + additionalTokens <= budget) {
      entries[item.index] = { path: item.path, layer: "L1", ir: l1, tokens: l1Tokens };
      totalTokens += additionalTokens;
      filesAtL1++;
    }
  }

  return {
    entries,
    totalTokens,
    budget,
    filesAtL0: entries.length - filesAtL1,
    filesAtL1,
  };
}
