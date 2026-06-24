import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { generateLayer } from "../ir/layers.js";
import { estimateTokens } from "../benchmark/tokenizer.js";
import { collectFiles } from "../utils/collectFiles.js";
import { ALL_EXTENSIONS } from "../cli/commands.js";
import { loadConfig } from "../config/loader.js";
import { getGitLog } from "../trends/git-log-parser.js";
import { detectHotspots } from "../trends/hotspot.js";

// A cross-agent handoff artifact. Layered so a consumer (and our own cache) can
// reuse the stable `prefix` while only the `delta` churns turn to turn. Unlike a
// raw-stub handoff, each changed file carries its L1 IR — compressed, not the
// raw diff — so handing off stays token-cheap.

export type ChangeStatus = "added" | "modified" | "deleted";

export interface HandoffDeltaFile {
  path: string;
  status: ChangeStatus;
  /** Short content hash — lets a consumer skip files it already has. */
  hash: string;
  /** Compressed cost of the file's IR, in tokens. */
  tokens: number;
  /** L1 IR of the file (empty for deletions). The compression edge. */
  ir: string;
}

export interface HandoffPrefix {
  fileCount: number;
  /** Risk-ranked files from git history — the "where it hurts" layer. */
  hotspots: { file: string; changes: number; bugFixRatio: number }[];
}

export interface HandoffDelta {
  changedFiles: HandoffDeltaFile[];
  /** Changed files that are also hotspots — review these first. */
  riskFiles: string[];
}

export interface Handoff {
  version: 1;
  generatedAtSha: string;
  prefix: HandoffPrefix;
  delta: HandoffDelta;
  prefixHash: string;
  deltaHash: string;
  combinedHash: string;
}

function git(repoPath: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: repoPath, encoding: "utf-8", timeout: 5000 }).trim();
}

function headShaOf(repoPath: string): string {
  try { return git(repoPath, "rev-parse --short HEAD"); } catch { return "unknown"; }
}

function sha12(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

/** Parse `git status --porcelain` into changed source files. */
export function getChangedFiles(repoPath: string): { path: string; status: ChangeStatus }[] {
  let out = "";
  // NOTE: must not trim — porcelain's leading status column is significant
  // (" M file" vs "M  file"), and trimming would eat the first line's space.
  try {
    // -uall expands untracked directories into individual files; without it git
    // collapses a new dir to one entry and brand-new source files get dropped.
    out = execSync("git status --porcelain -uall", { cwd: repoPath, encoding: "utf-8", timeout: 5000 });
  } catch { return []; }
  const result: { path: string; status: ChangeStatus }[] = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const code = line.slice(0, 2);
    let path = line.slice(3).trim();
    if (path.includes(" -> ")) path = path.split(" -> ")[1].trim(); // rename: take new path
    const status: ChangeStatus =
      code.includes("D") ? "deleted"
      : code.includes("A") || code === "??" ? "added"
      : "modified";
    result.push({ path, status });
  }
  return result;
}

export async function buildHandoff(projectPath: string): Promise<Handoff> {
  const sha = headShaOf(projectPath);

  // Prefix (stable): repo size + risk hotspots from history.
  const files = collectFiles(projectPath, ALL_EXTENSIONS);
  const config = loadConfig(projectPath);
  let hotspots: { file: string; changesInLast30Commits: number; bugFixRatio: number }[] = [];
  try {
    hotspots = detectHotspots(getGitLog(projectPath, 100), {
      threshold: config.trends.hotspotThreshold,
      fixRatioThreshold: config.trends.bugFixRatioThreshold,
    });
  } catch { /* no git history — fine */ }

  const prefix: HandoffPrefix = {
    fileCount: files.length,
    hotspots: hotspots.slice(0, 8).map(h => ({
      file: h.file,
      changes: h.changesInLast30Commits,
      bugFixRatio: Number(h.bugFixRatio.toFixed(2)),
    })),
  };

  // Delta (dynamic): changed source files, each compressed to L1 IR.
  const changedFiles: HandoffDeltaFile[] = [];
  for (const c of getChangedFiles(projectPath)) {
    if (!ALL_EXTENSIONS.some(ext => c.path.endsWith(ext))) continue;
    const abs = join(projectPath, c.path);
    if (c.status === "deleted" || !existsSync(abs)) {
      changedFiles.push({ path: c.path, status: c.status, hash: "", tokens: 0, ir: "" });
      continue;
    }
    const code = readFileSync(abs, "utf-8");
    const ir = await generateLayer("L1", { code, filePath: c.path, health: null });
    changedFiles.push({ path: c.path, status: c.status, hash: sha12(code), tokens: estimateTokens(ir), ir });
  }

  const hotspotSet = new Set(prefix.hotspots.map(h => h.file));
  const riskFiles = changedFiles.filter(f => hotspotSet.has(f.path)).map(f => f.path);
  const delta: HandoffDelta = { changedFiles, riskFiles };

  const prefixHash = sha12(JSON.stringify(prefix));
  const deltaHash = sha12(JSON.stringify(delta));
  const combinedHash = sha12(prefixHash + deltaHash);

  return { version: 1, generatedAtSha: sha, prefix, delta, prefixHash, deltaHash, combinedHash };
}
