import type { GitLogEntry, Inconsistency } from "../types.js";

export function detectInconsistencies(
  entries: GitLogEntry[],
  minAuthors: number = 3
): Inconsistency[] {
  const fileAuthors = new Map<string, Map<string, string[]>>();

  for (const entry of entries) {
    for (const file of entry.files) {
      const authors = fileAuthors.get(file) ?? new Map();
      const commits = authors.get(entry.author) ?? [];
      commits.push(entry.message);
      authors.set(entry.author, commits);
      fileAuthors.set(file, authors);
    }
  }

  const inconsistencies: Inconsistency[] = [];

  for (const [file, authors] of fileAuthors) {
    if (authors.size >= minAuthors) {
      const patterns = Array.from(authors.entries()).map(([author, commits]) => ({
        author,
        style: categorizeStyle(commits),
      }));

      inconsistencies.push({ file, patterns });
    }
  }

  return inconsistencies;
}

function categorizeStyle(commits: string[]): string {
  const types = commits.map((m) => {
    if (m.match(/^fix/i)) return "fix";
    if (m.match(/^feat/i)) return "feature";
    if (m.match(/^refactor/i)) return "refactor";
    return "other";
  });
  const primary = mode(types);
  return `primarily ${primary} (${commits.length} commits)`;
}

function mode(arr: string[]): string {
  const counts = new Map<string, number>();
  for (const item of arr) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
}
