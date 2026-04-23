import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import {
  isTelemetryDisabled,
  recordInvocation,
  recentSummary,
  type HookInvocationRecord,
} from "../../../src/memory/telemetry/hook-invocations.js";

function sampleRecord(overrides: Partial<HookInvocationRecord> = {}): HookInvocationRecord {
  return {
    timestamp: 1700000000,
    platform: "claude-code",
    event: "pretooluse",
    filePath: "src/a.ts",
    verdict: "high",
    score: 0.9,
    confidence: 0.6,
    latencyMs: 42,
    cacheHit: false,
    ...overrides,
  };
}

function freshDb(label: string) {
  const dir = mkdtempSync(join(tmpdir(), `composto-hi-${label}-`));
  const dbPath = join(dir, ".composto", "memory.db");
  const db = openDatabase(dbPath);
  runMigrations(db);
  return {
    dir,
    dbPath,
    db,
    cleanup: () => {
      try { db.close(); } catch {}
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("recordInvocation", () => {
  it("appends a row; SELECT COUNT reflects it", () => {
    const { db, cleanup } = freshDb("record-one");
    try {
      recordInvocation(db, sampleRecord());
      const count = (db.prepare("SELECT COUNT(*) AS c FROM hook_invocations").get() as any).c;
      expect(count).toBe(1);
      const row = db.prepare("SELECT * FROM hook_invocations").get() as any;
      expect(row.platform).toBe("claude-code");
      expect(row.verdict).toBe("high");
      expect(row.latency_ms).toBe(42);
      expect(row.cache_hit).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("accepts null verdict / filePath / score / confidence (passthrough rows)", () => {
    const { db, cleanup } = freshDb("record-null");
    try {
      recordInvocation(
        db,
        sampleRecord({ filePath: null, verdict: null, score: null, confidence: null }),
      );
      const row = db.prepare("SELECT * FROM hook_invocations").get() as any;
      expect(row.file_path).toBeNull();
      expect(row.verdict).toBeNull();
      expect(row.score).toBeNull();
      expect(row.confidence).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("does not throw when db.prepare blows up (best-effort telemetry)", () => {
    // Simulate a broken DB by passing an object whose prepare throws.
    const brokenDb = {
      prepare() { throw new Error("db locked"); },
      name: ":memory:",
    } as any;
    expect(() => recordInvocation(brokenDb, sampleRecord())).not.toThrow();
  });

  it("silently no-ops when .composto/telemetry-disabled marker exists", () => {
    const { dir, db, cleanup } = freshDb("record-opt-out");
    try {
      writeFileSync(join(dir, ".composto", "telemetry-disabled"), "");
      expect(isTelemetryDisabled(db)).toBe(true);
      recordInvocation(db, sampleRecord());
      const count = (db.prepare("SELECT COUNT(*) AS c FROM hook_invocations").get() as any).c;
      expect(count).toBe(0);
    } finally {
      cleanup();
    }
  });
});

describe("recentSummary", () => {
  it("returns zero counts on an empty DB", () => {
    const { db, cleanup } = freshDb("summary-empty");
    try {
      const now = 1700000000;
      const s = recentSummary(db, { now });
      expect(s.total).toBe(0);
      expect(s.byVerdict).toEqual({});
      expect(s.byPlatform).toEqual({});
      expect(s.latencyP50).toBe(0);
      expect(s.latencyP95).toBe(0);
      expect(s.cacheHitRate).toBe(0);
      expect(s.windowEnd).toBe(now);
      expect(s.windowStart).toBe(now - 7 * 24 * 60 * 60);
    } finally {
      cleanup();
    }
  });

  it("aggregates verdict + platform buckets correctly, counting null as 'passthrough'", () => {
    const { db, cleanup } = freshDb("summary-mix");
    try {
      const ts = 1700000000;
      // 3 high + 2 medium + 1 low + 2 passthrough (null) = 8
      for (let i = 0; i < 3; i++)
        recordInvocation(db, sampleRecord({ timestamp: ts, verdict: "high", platform: "claude-code" }));
      for (let i = 0; i < 2; i++)
        recordInvocation(db, sampleRecord({ timestamp: ts, verdict: "medium", platform: "claude-code" }));
      recordInvocation(db, sampleRecord({ timestamp: ts, verdict: "low", platform: "cursor" }));
      for (let i = 0; i < 2; i++)
        recordInvocation(
          db,
          sampleRecord({ timestamp: ts, verdict: null, filePath: null, platform: "cursor" }),
        );

      const s = recentSummary(db, { since: ts - 10, now: ts + 10 });
      expect(s.total).toBe(8);
      expect(s.byVerdict).toEqual({ high: 3, medium: 2, low: 1, passthrough: 2 });
      expect(s.byPlatform).toEqual({ "claude-code": 5, cursor: 3 });
    } finally {
      cleanup();
    }
  });

  it("computes p50 / p95 on known latencies", () => {
    const { db, cleanup } = freshDb("summary-lat");
    try {
      const ts = 1700000000;
      // 10 samples — 10, 20, 30, 40, 50, 60, 70, 80, 90, 100.
      // nearest-rank p50 → ceil(0.5*10)=5th = 50
      // nearest-rank p95 → ceil(0.95*10)=10th = 100
      const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      for (const l of latencies) {
        recordInvocation(db, sampleRecord({ timestamp: ts, latencyMs: l }));
      }
      const s = recentSummary(db, { since: ts - 10, now: ts + 10 });
      expect(s.latencyP50).toBe(50);
      expect(s.latencyP95).toBe(100);
    } finally {
      cleanup();
    }
  });

  it("respects the `since` window — older rows are excluded", () => {
    const { db, cleanup } = freshDb("summary-since");
    try {
      const ts = 1700000000;
      recordInvocation(db, sampleRecord({ timestamp: ts - 10_000, verdict: "high" }));
      recordInvocation(db, sampleRecord({ timestamp: ts - 10, verdict: "medium" }));
      recordInvocation(db, sampleRecord({ timestamp: ts, verdict: "low" }));

      const s = recentSummary(db, { since: ts - 100, now: ts + 10 });
      expect(s.total).toBe(2);
      expect(s.byVerdict).toEqual({ medium: 1, low: 1 });
    } finally {
      cleanup();
    }
  });

  it("reports cacheHitRate when rows have cache_hit=1", () => {
    const { db, cleanup } = freshDb("summary-cache");
    try {
      const ts = 1700000000;
      recordInvocation(db, sampleRecord({ timestamp: ts, cacheHit: true }));
      recordInvocation(db, sampleRecord({ timestamp: ts, cacheHit: false }));
      recordInvocation(db, sampleRecord({ timestamp: ts, cacheHit: true }));
      const s = recentSummary(db, { since: ts - 10, now: ts + 10 });
      expect(s.total).toBe(3);
      expect(s.cacheHitRate).toBeCloseTo(2 / 3, 5);
    } finally {
      cleanup();
    }
  });
});
