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
  layer: "L0" | "L1" | "L3";
  ir: string;
  tokens: number;
  isTarget?: boolean;
}

export interface PackResult {
  entries: PackEntry[];
  totalTokens: number;
  budget: number;
  filesAtL0: number;
  filesAtL1: number;
  filesAtL3: number;
  targetFile?: string;
  targetDowngraded?: boolean;  // true if target file was too large for L3, fell back to L1
}

export interface PackOptions {
  budget: number;
  hotspots: Hotspot[];
  target?: string;
}

// Find which file contains the target symbol
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findTargetFile(files: FileInput[], target: string): string | null {
  const t = escapeRegex(target);

  // Declaration patterns — ordered from most specific to least
  // Each pattern is tried across all files before falling back to the next
  const declarationPatterns = [
    // JS/TS declarations
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${t}\\b`),
    new RegExp(`(?:export\\s+)?class\\s+${t}\\b`),
    new RegExp(`(?:export\\s+)?interface\\s+${t}\\b`),
    new RegExp(`(?:export\\s+)?type\\s+${t}\\b`),
    new RegExp(`(?:export\\s+)?enum\\s+${t}\\b`),
    new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${t}\\b`),
    // Python
    new RegExp(`\\bdef\\s+${t}\\b`),
    // Rust
    new RegExp(`\\bfn\\s+${t}\\b`),
    new RegExp(`\\bstruct\\s+${t}\\b`),
    new RegExp(`\\btrait\\s+${t}\\b`),
    // Go
    new RegExp(`\\bfunc\\s+${t}\\b`),
    new RegExp(`\\btype\\s+${t}\\b`),
    // Object method shorthand
    new RegExp(`\\b${t}\\s*:\\s*(?:async\\s+)?function\\b`),
    new RegExp(`\\b${t}\\s*\\([^)]*\\)\\s*\\{`),
  ];

  // Try each pattern across all files before moving to the next pattern.
  // This ensures declarations beat call sites regardless of file order.
  for (const pattern of declarationPatterns) {
    const match = files.find(f => pattern.test(f.code));
    if (match) return match.path;
  }

  // Last-resort fallback: call site anywhere
  const fallback = new RegExp(`\\b${t}\\s*\\(`);
  const match = files.find(f => fallback.test(f.code));
  return match ? match.path : null;
}

// Find files that import from or are imported by the target file
function findRelatedFiles(files: FileInput[], targetPath: string): Set<string> {
  const related = new Set<string>();
  const targetFile = files.find(f => f.path === targetPath);
  if (!targetFile) return related;

  // Files imported BY the target
  const importPattern = /(?:import|require)\s*(?:\([^)]*|\{[^}]*\}|\w+)?\s*(?:from)?\s*["']([^"']+)["']/g;
  const imports = [...targetFile.code.matchAll(importPattern)].map(m => m[1]);
  for (const imp of imports) {
    const match = files.find(f => {
      const basename = f.path.replace(/\.[^.]+$/, "");
      return imp.includes(basename) || basename.endsWith(imp.replace(/^\.\.?\//, "").replace(/\.[^.]+$/, ""));
    });
    if (match) related.add(match.path);
  }

  // Files that import the target
  const targetBasename = targetPath.replace(/\.[^.]+$/, "").split("/").pop() ?? "";
  for (const file of files) {
    if (file.path === targetPath) continue;
    if (file.code.includes(targetBasename)) {
      related.add(file.path);
    }
  }

  return related;
}

export async function packContext(
  files: FileInput[],
  options: PackOptions
): Promise<PackResult> {
  const { budget, hotspots, target } = options;
  const hotspotSet = new Set(hotspots.map(h => h.file));

  // Resolve target file if specified
  let targetPath: string | null = null;
  let relatedFiles = new Set<string>();
  if (target) {
    targetPath = findTargetFile(files, target);
    if (targetPath) {
      relatedFiles = findRelatedFiles(files, targetPath);
    }
  }

  // Step 1: Handle target file first (L3 - raw code)
  const entries: PackEntry[] = [];
  let totalTokens = 0;
  let filesAtL3 = 0;
  let targetDowngraded = false;

  if (targetPath) {
    const targetFile = files.find(f => f.path === targetPath)!;
    const rawTokens = estimateTokens(targetFile.code);
    // Only use L3 if target file fits in 60% of budget
    if (rawTokens <= budget * 0.6) {
      entries.push({
        path: targetPath,
        layer: "L3",
        ir: targetFile.code,
        tokens: rawTokens,
        isTarget: true,
      });
      totalTokens += rawTokens;
      filesAtL3 = 1;
    } else {
      // Target file too large even for L3 — fall back to L1 and warn caller
      targetDowngraded = true;
      const l1 = await generateLayer("L1", { code: targetFile.code, filePath: targetFile.path, health: null });
      const l1Tokens = estimateTokens(l1);
      entries.push({
        path: targetPath,
        layer: "L1",
        ir: l1,
        tokens: l1Tokens,
        isTarget: true,
      });
      totalTokens += l1Tokens;
    }
  }

  // Step 2: Generate L0 for remaining files
  for (const file of files) {
    if (file.path === targetPath) continue;
    const l0 = await generateLayer("L0", { code: file.code, filePath: file.path, health: null });
    const l0Tokens = estimateTokens(l0);
    entries.push({ path: file.path, layer: "L0", ir: l0, tokens: l0Tokens });
    totalTokens += l0Tokens;
  }

  // If L0 + target exceeds budget, truncate
  if (totalTokens > budget) {
    const truncated = entries.filter(e => e.isTarget);
    let used = truncated.reduce((s, e) => s + e.tokens, 0);
    for (const entry of entries) {
      if (entry.isTarget) continue;
      if (used + entry.tokens <= budget) {
        truncated.push(entry);
        used += entry.tokens;
      }
    }
    return {
      entries: truncated,
      totalTokens: used,
      budget,
      filesAtL0: truncated.filter(e => e.layer === "L0").length,
      filesAtL1: truncated.filter(e => e.layer === "L1").length,
      filesAtL3,
      targetFile: targetPath ?? undefined,
      targetDowngraded,
    };
  }

  // Step 3: Upgrade to L1 — priority: related > hotspot > size
  const upgradeOrder = entries
    .map((e, i) => ({
      index: i,
      path: e.path,
      rawTokens: files.find(f => f.path === e.path)?.rawTokens ?? 0,
      isHotspot: hotspotSet.has(e.path),
      isRelated: relatedFiles.has(e.path),
      isTarget: e.isTarget ?? false,
    }))
    .filter(x => x.isTarget === false && entries[x.index].layer === "L0")
    .sort((a, b) => {
      if (a.isRelated && !b.isRelated) return -1;
      if (!a.isRelated && b.isRelated) return 1;
      if (a.isHotspot && !b.isHotspot) return -1;
      if (!a.isHotspot && b.isHotspot) return 1;
      return b.rawTokens - a.rawTokens;
    });

  let filesAtL1 = 0;

  for (const item of upgradeOrder) {
    const file = files.find(f => f.path === item.path)!;
    const l1 = await generateLayer("L1", { code: file.code, filePath: file.path, health: null });
    const l1Tokens = estimateTokens(l1);
    const currentTokens = entries[item.index].tokens;
    const additional = l1Tokens - currentTokens;

    if (totalTokens + additional <= budget) {
      entries[item.index] = {
        path: item.path,
        layer: "L1",
        ir: l1,
        tokens: l1Tokens,
      };
      totalTokens += additional;
      filesAtL1++;
    }
  }

  return {
    entries,
    totalTokens,
    budget,
    filesAtL0: entries.filter(e => e.layer === "L0").length,
    filesAtL1,
    filesAtL3,
    targetFile: targetPath ?? undefined,
    targetDowngraded,
  };
}
