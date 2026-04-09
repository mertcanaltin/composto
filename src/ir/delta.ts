import { execSync } from "node:child_process";
import type { DeltaContext } from "../types.js";
import { fingerprintLine } from "./fingerprint.js";

export interface ParsedHunk {
  startLine: number;
  endLine: number;
  added: string[];
  removed: string[];
  context: string[];
}

export function parseDiffOutput(diff: string): ParsedHunk[] {
  if (!diff.trim()) return [];

  const hunks: ParsedHunk[] = [];
  const lines = diff.split("\n");
  let currentHunk: ParsedHunk | null = null;

  for (const line of lines) {
    const hunkHeader = line.match(/^@@ -\d+,?\d* \+(\d+),?\d* @@/);
    if (hunkHeader) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        startLine: parseInt(hunkHeader[1], 10),
        endLine: parseInt(hunkHeader[1], 10),
        added: [],
        removed: [],
        context: [],
      };
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.added.push(line.slice(1));
      currentHunk.endLine++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.removed.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      currentHunk.context.push(line.slice(1));
      currentHunk.endLine++;
    }
  }

  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

export function buildDeltaContext(file: string, hunks: ParsedHunk[]): DeltaContext {
  return {
    file,
    hunks: hunks.map((h) => ({
      startLine: h.startLine,
      endLine: h.endLine,
      changed: [...h.added, ...h.removed],
      surroundingIR: h.context.map((l) => fingerprintLine(l).ir).filter(Boolean).join("\n"),
      functionScope: null,
      blame: null,
    })),
  };
}

export function getFileDelta(repoPath: string, file: string): DeltaContext {
  try {
    const diff = execSync(`git diff HEAD -- "${file}"`, {
      cwd: repoPath, encoding: "utf-8", timeout: 5000,
    });
    const hunks = parseDiffOutput(diff);
    return buildDeltaContext(file, hunks);
  } catch {
    return { file, hunks: [] };
  }
}
