import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../../src/memory/db.js";
import { runMigrations } from "../../src/memory/schema.js";
import { recordInvocation } from "../../src/memory/telemetry/hook-invocations.js";
import { renderSummary, runStats } from "../../src/cli/stats.js";
import { recentSummary } from "../../src/memory/telemetry/hook-invocations.js";

const CLI = resolve(process.cwd(), "dist/index.js");

function seed(dir: string) {
  const dbPath = join(dir, ".composto", "memory.db");
  const db = openDatabase(dbPath);
  runMigrations(db);
  const ts = Math.floor(Date.now() / 1000);
  // 3 high, 2 medium, 1 low, 2 passthrough
  const shape = {
    timestamp: ts,
    platform: "claude-code",
    event: "pretooluse",
    filePath: "src/a.ts",
    score: 0.5,
    confidence: 0.6,
    latencyMs: 42,
    cacheHit: false,
  };
  for (let i = 0; i < 3; i++) recordInvocation(db, { ...shape, verdict: "high", latencyMs: 10 + i });
  for (let i = 0; i < 2; i++) recordInvocation(db, { ...shape, verdict: "medium", latencyMs: 30 + i, platform: "cursor" });
  recordInvocation(db, { ...shape, verdict: "low" });
  for (let i = 0; i < 2; i++) recordInvocation(db, { ...shape, verdict: null, filePath: null, score: null, confidence: null });
  db.close();
}

describe("runStats — unit", () => {
  it("returns a human-readable summary with verdict + latency", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-stats-u-"));
    try {
      seed(dir);
      const res = runStats({ cwd: dir });
      expect(res.action).toBe("printed");
      expect(res.output).toMatch(/hook invocations \(last 7d\):\s+8/);
      expect(res.output).toMatch(/by verdict/);
      expect(res.output).toMatch(/high/);
      expect(res.output).toMatch(/medium/);
      expect(res.output).toMatch(/passthrough/);
      expect(res.output).toMatch(/p50/);
      expect(res.output).toMatch(/p95/);
      expect(res.output).toMatch(/cache feature deferred/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--json emits machine-readable summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-stats-json-"));
    try {
      seed(dir);
      const res = runStats({ cwd: dir, json: true });
      const parsed = JSON.parse(res.output);
      expect(parsed.total).toBe(8);
      expect(parsed.byVerdict.high).toBe(3);
      expect(parsed.byVerdict.medium).toBe(2);
      expect(parsed.byVerdict.low).toBe(1);
      expect(parsed.byVerdict.passthrough).toBe(2);
      expect(parsed.byPlatform["claude-code"]).toBe(6);
      expect(parsed.byPlatform.cursor).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--disable writes the opt-out marker file", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-stats-disable-"));
    try {
      const res = runStats({ cwd: dir, disable: true });
      expect(res.action).toBe("disabled");
      expect(existsSync(join(dir, ".composto", "telemetry-disabled"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles a repo with no .composto dir gracefully", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-stats-empty-"));
    try {
      const res = runStats({ cwd: dir });
      expect(res.action).toBe("printed");
      expect(res.output).toMatch(/No \.composto\/memory\.db/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renderSummary formats zero-row summary correctly", () => {
    const out = renderSummary({
      windowStart: 0,
      windowEnd: 1,
      total: 0,
      byVerdict: {},
      byPlatform: {},
      latencyP50: 0,
      latencyP95: 0,
      cacheHitRate: 0,
    });
    expect(out).toMatch(/hook invocations \(last 7d\):\s+0/);
    expect(out).toMatch(/no hook firings recorded yet/);
  });
});

describe("composto stats CLI — shell integration", () => {
  it("emits verdict counts after seeding the DB", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-stats-cli-"));
    try {
      seed(dir);
      const out = execSync(`node ${CLI} stats`, { cwd: dir, encoding: "utf-8" });
      expect(out).toMatch(/hook invocations \(last 7d\):\s+8/);
      expect(out).toMatch(/high/);
      expect(out).toMatch(/p50/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits JSON on --json", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-stats-clijson-"));
    try {
      seed(dir);
      const out = execSync(`node ${CLI} stats --json`, { cwd: dir, encoding: "utf-8" });
      const parsed = JSON.parse(out);
      expect(parsed.total).toBe(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--disable creates the opt-out marker and subsequent hook writes no-op", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-stats-disable-cli-"));
    try {
      execSync(`node ${CLI} stats --disable`, { cwd: dir, encoding: "utf-8" });
      expect(existsSync(join(dir, ".composto", "telemetry-disabled"))).toBe(true);

      // Seed a DB and try recording — the marker should gate the write.
      const dbPath = join(dir, ".composto", "memory.db");
      const db = openDatabase(dbPath);
      runMigrations(db);
      recordInvocation(db, {
        timestamp: Math.floor(Date.now() / 1000),
        platform: "claude-code",
        event: "pretooluse",
        filePath: "x.ts",
        verdict: "high",
        score: 0.9,
        confidence: 0.6,
        latencyMs: 10,
        cacheHit: false,
      });
      const s = recentSummary(db);
      expect(s.total).toBe(0);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
