import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { recordSavings } from "../../src/telemetry/savings.js";
import { runStats, renderSavings } from "../../src/cli/stats.js";

const CLI = resolve(process.cwd(), "dist/index.js");

function seed(dir: string) {
  const compostoDir = join(dir, ".composto");
  const ts = Math.floor(Date.now() / 1000);
  recordSavings(compostoDir, 1200, ts);
  recordSavings(compostoDir, 800, ts);
}

describe("runStats — unit", () => {
  it("reports cumulative compression savings", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-stats-u-"));
    try {
      seed(dir);
      const res = runStats({ cwd: dir });
      expect(res.action).toBe("printed");
      expect(res.output).toMatch(/compression hook/);
      expect(res.output).toMatch(/2,000/); // 1200 + 800 tokens saved
      expect(res.output).toMatch(/across 2 reads/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--json emits the machine-readable savings state", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-stats-json-"));
    try {
      seed(dir);
      const res = runStats({ cwd: dir, json: true });
      const parsed = JSON.parse(res.output);
      expect(parsed.totalSavedTokens).toBe(2000);
      expect(parsed.compressedReads).toBe(2);
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

  it("handles a repo with no savings recorded gracefully", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-stats-empty-"));
    try {
      const res = runStats({ cwd: dir });
      expect(res.action).toBe("printed");
      expect(res.output).toMatch(/No compression savings recorded yet/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renderSavings returns empty string for zero savings", () => {
    expect(renderSavings(0, 0)).toBe("");
  });
});

describe("composto stats CLI — shell integration", () => {
  it("emits savings after seeding the counter", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-stats-cli-"));
    try {
      seed(dir);
      const out = execSync(`node ${CLI} stats`, { cwd: dir, encoding: "utf-8" });
      expect(out).toMatch(/compression hook/);
      expect(out).toMatch(/2,000/);
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
      expect(parsed.totalSavedTokens).toBe(2000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--disable creates the opt-out marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-stats-disable-cli-"));
    try {
      execSync(`node ${CLI} stats --disable`, { cwd: dir, encoding: "utf-8" });
      expect(existsSync(join(dir, ".composto", "telemetry-disabled"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
