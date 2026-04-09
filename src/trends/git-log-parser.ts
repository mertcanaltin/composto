import { execSync } from "node:child_process";
import type { GitLogEntry, BlameInfo } from "../types.js";

const BUG_FIX_PATTERNS = [
  /\bfix\b/i,
  /\bbugfix\b/i,
  /\bhotfix\b/i,
  /\bpatch\b/i,
  /\bresolve\b/i,
  /\bbug\b/i,
];

export function isBugFixCommit(message: string): boolean {
  return BUG_FIX_PATTERNS.some((p) => p.test(message));
}

export function parseGitLogOutput(output: string): GitLogEntry[] {
  const entries: GitLogEntry[] = [];
  const lines = output.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || !line.includes("|")) {
      i++;
      continue;
    }

    const [hash, author, date, ...messageParts] = line.split("|");
    const message = messageParts.join("|");
    const files: string[] = [];

    i++;
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].includes("|")) {
      const fileLine = lines[i].trim();
      if (fileLine) files.push(fileLine);
      i++;
    }

    entries.push({ hash, author, date, message, files });
  }

  return entries;
}

export function getGitLog(repoPath: string, count: number = 100): GitLogEntry[] {
  try {
    const output = execSync(
      `git log --format="%h|%an|%as|%s" --name-only -n ${count}`,
      { cwd: repoPath, encoding: "utf-8", timeout: 10000 }
    );
    return parseGitLogOutput(output);
  } catch {
    return [];
  }
}

export function parseGitBlameOutput(output: string, _targetLine: number): BlameInfo | null {
  if (!output.trim()) return null;

  const lines = output.split("\n");
  let author = "";
  let timestamp = 0;
  let summary = "";

  for (const line of lines) {
    if (line.startsWith("author ")) author = line.slice(7);
    if (line.startsWith("author-time ")) timestamp = parseInt(line.slice(12), 10);
    if (line.startsWith("summary ")) summary = line.slice(8);
  }

  if (!author) return null;

  return {
    author,
    date: new Date(timestamp * 1000).toISOString().split("T")[0],
    commitMessage: summary,
  };
}

export function getGitBlame(repoPath: string, file: string, line: number): BlameInfo | null {
  try {
    const output = execSync(
      `git blame --porcelain -L ${line},${line} -- "${file}"`,
      { cwd: repoPath, encoding: "utf-8", timeout: 5000 }
    );
    return parseGitBlameOutput(output, line);
  } catch {
    return null;
  }
}
