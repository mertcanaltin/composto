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
