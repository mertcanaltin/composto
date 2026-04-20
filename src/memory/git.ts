// src/memory/git.ts
// Thin wrappers around child_process for the git commands
// the memory subsystem needs. All throw on failure — callers
// handle degraded modes.

import { execSync } from "node:child_process";

function run(cwd: string, cmd: string, timeoutMs = 10000): string {
  return execSync(cmd, { cwd, encoding: "utf-8", timeout: timeoutMs }).trim();
}

export function revParseHead(cwd: string): string {
  return run(cwd, "git rev-parse HEAD");
}

export function isShallowRepo(cwd: string): boolean {
  return run(cwd, "git rev-parse --is-shallow-repository") === "true";
}

export function revListCount(cwd: string, from: string, to: string): number {
  if (from === to) return 0;
  const out = run(cwd, `git rev-list --count ${from}..${to}`);
  return parseInt(out, 10);
}

export function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  try {
    execSync(`git merge-base --is-ancestor ${ancestor} ${descendant}`, {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function countCommits(cwd: string): number {
  const out = run(cwd, "git rev-list --count HEAD");
  return parseInt(out, 10);
}

// resolveSinceBoundary maps a YYYY-MM-DD date string to the SHA of the
// latest commit at or before that date. Returned SHA is meant to be used
// as the `from` boundary of an IngestRange so the indexer walks only
// commits AFTER that point. Returns null if no commit exists before the
// date (the date is older than the repo's first commit).
export function resolveSinceBoundary(cwd: string, since: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error(`--since must be YYYY-MM-DD (got "${since}")`);
  }
  const out = run(cwd, `git rev-list -n 1 --before='${since}T23:59:59' HEAD`);
  return out || null;
}

// logRange returns raw NUL-delimited git log output for parsing
// in Task 5 (Tier 1 ingest). The format captures everything
// tier1 needs: SHA, parent, author, timestamp, subject, body, numstat.
export function logRange(
  cwd: string,
  from: string | null,
  to: string,
  timeoutMs = 60000
): string {
  const range = from ? `${from}..${to}` : to;
  const fmt = "--format=%x1e%H%x00%P%x00%an%x00%at%x00%s%x00%b%x1f";
  const cmd = `git log ${fmt} --numstat --no-renames ${range}`;
  return execSync(cmd, { cwd, encoding: "utf-8", timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
}
