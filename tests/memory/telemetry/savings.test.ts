import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSavings, recordSavings } from "../../../src/memory/telemetry/savings.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "composto-savings-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("savings counter", () => {
  it("returns an empty state when no file exists", () => {
    const s = readSavings(dir);
    expect(s).toEqual({ totalSavedTokens: 0, compressedReads: 0, firstTs: null });
  });

  it("accumulates savings across calls and stamps firstTs once", () => {
    recordSavings(dir, 100, 1000);
    const s = recordSavings(dir, 250, 2000);
    expect(s.totalSavedTokens).toBe(350);
    expect(s.compressedReads).toBe(2);
    expect(s.firstTs).toBe(1000); // stamped on first, not overwritten
    expect(readSavings(dir).totalSavedTokens).toBe(350);
  });

  it("ignores non-positive or non-finite savings", () => {
    recordSavings(dir, 0, 1000);
    recordSavings(dir, -5, 1000);
    recordSavings(dir, NaN, 1000);
    expect(readSavings(dir).compressedReads).toBe(0);
  });
});
