import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { getCalibration } from "../../../src/memory/signals/calibration-lookup.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "composto-calib-"));
  const db = openDatabase(join(dir, "memory.db"));
  runMigrations(db);
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("getCalibration", () => {
  it("returns heuristic fallback when no row exists", () => {
    const { db, cleanup } = setup();
    const r = getCalibration(db, "hotspot", 0.3);
    expect(r.precision).toBe(0.3);
    expect(r.sampleSize).toBe(0);
    expect(r.source).toBe("heuristic");
    cleanup();
  });

  it("returns calibrated values when row exists", () => {
    const { db, cleanup } = setup();
    db.prepare(`
      INSERT INTO signal_calibration (signal_type, precision, sample_size, last_computed_sha, computed_at)
      VALUES ('hotspot', 0.72, 45, 'abc', 1700000000)
    `).run();
    const r = getCalibration(db, "hotspot", 0.3);
    expect(r.precision).toBeCloseTo(0.72, 3);
    expect(r.sampleSize).toBe(45);
    expect(r.source).toBe("repo-calibrated");
    cleanup();
  });
});
