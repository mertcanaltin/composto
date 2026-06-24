import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHandoff, getChangedFiles } from "../../src/handoff/builder.js";
import { writeHandoff, readLatestHandoff, handoffPath } from "../../src/handoff/writer.js";

function git(dir: string, cmd: string): void {
  execSync(`git ${cmd}`, { cwd: dir, stdio: "ignore" });
}

describe("handoff", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "composto-handoff-"));
    git(dir, "init");
    git(dir, "config user.email test@test.com");
    git(dir, "config user.name test");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.ts"), "export function alpha() { return 1; }\n");
    git(dir, "add -A");
    git(dir, "commit -m init");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("captures a modified source file with its IR in the delta", async () => {
    writeFileSync(join(dir, "src", "a.ts"), "export function alpha() { return 42; }\n");
    const h = await buildHandoff(dir);

    expect(h.version).toBe(1);
    const changed = h.delta.changedFiles.find(f => f.path === "src/a.ts");
    expect(changed).toBeDefined();
    expect(changed!.status).toBe("modified");
    expect(changed!.ir.length).toBeGreaterThan(0); // compressed IR, not empty
    expect(changed!.hash).toHaveLength(12);
  });

  it("produces deterministic hashes for identical state", async () => {
    writeFileSync(join(dir, "src", "a.ts"), "export function alpha() { return 7; }\n");
    const a = await buildHandoff(dir);
    const b = await buildHandoff(dir);
    expect(a.prefixHash).toBe(b.prefixHash);
    expect(a.deltaHash).toBe(b.deltaHash);
    expect(a.combinedHash).toBe(b.combinedHash);
  });

  it("flags prefix as reused when nothing structural changed between saves", async () => {
    writeFileSync(join(dir, "src", "a.ts"), "export function alpha() { return 7; }\n");
    const first = await writeHandoff(dir, { now: 1 });
    expect(first.cache.prefixReused).toBe(false); // no previous artifact

    const second = await writeHandoff(dir, { now: 2 });
    expect(second.cache.prefixReused).toBe(true);
    expect(second.cache.deltaReused).toBe(true);
  });

  it("persists the artifact and a metrics line, honoring --no-save", async () => {
    writeFileSync(join(dir, "src", "b.ts"), "export function beta() { return 2; }\n");
    await writeHandoff(dir, { now: 1 });
    expect(existsSync(handoffPath(dir))).toBe(true);
    expect(existsSync(join(dir, ".composto", "handoff.metrics.log"))).toBe(true);

    const latest = readLatestHandoff(dir);
    expect(latest?.delta.changedFiles.some(f => f.path === "src/b.ts")).toBe(true);

    rmSync(join(dir, ".composto"), { recursive: true, force: true });
    await writeHandoff(dir, { noSave: true, now: 2 });
    expect(existsSync(handoffPath(dir))).toBe(false); // --no-save wrote nothing
  });

  it("captures brand-new files inside an untracked directory", async () => {
    mkdirSync(join(dir, "feature"));
    writeFileSync(join(dir, "feature", "new.ts"), "export const n = 1;\n");
    const h = await buildHandoff(dir);
    // Without `-uall` git collapses this to a single `feature/` entry and the
    // source file would be dropped.
    const f = h.delta.changedFiles.find(x => x.path === "feature/new.ts");
    expect(f).toBeDefined();
    expect(f!.status).toBe("added");
    expect(f!.ir.length).toBeGreaterThan(0);
  });

  it("detects added and deleted files by status", async () => {
    writeFileSync(join(dir, "src", "c.ts"), "export const c = 3;\n");
    rmSync(join(dir, "src", "a.ts"));
    const changed = getChangedFiles(dir);
    expect(changed.find(f => f.path === "src/c.ts")?.status).toBe("added");
    expect(changed.find(f => f.path === "src/a.ts")?.status).toBe("deleted");
  });
});
