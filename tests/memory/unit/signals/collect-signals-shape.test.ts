import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../../src/memory/db.js";
import { runMigrations } from "../../../../src/memory/schema.js";
import { collectSignals } from "../../../../src/memory/signals/index.js";

describe("collectSignals — signal inventory after coverage_decline retirement", () => {
  it("returns exactly 4 signals in the canonical order", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-shape-"));
    const db = openDatabase(join(dir, "m.db"));
    try {
      runMigrations(db);
      const out = collectSignals(db, dir, "x.ts");
      const types = out.map((s) => s.type);
      expect(types).toEqual([
        "revert_match",
        "hotspot",
        "fix_ratio",
        "author_churn",
      ]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
