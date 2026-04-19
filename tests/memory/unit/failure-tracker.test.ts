// tests/memory/unit/failure-tracker.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFailureTracker } from "../../../src/memory/failure-tracker.js";

describe("FailureTracker", () => {
  let dir = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("disables after 3 consecutive failures of the same class within 5 minutes", () => {
    dir = mkdtempSync(join(tmpdir(), "composto-ft-"));
    const ft = createFailureTracker(dir);
    expect(ft.isDisabled()).toBe(false);
    ft.recordFailure("sqlite_corrupt");
    ft.recordFailure("sqlite_corrupt");
    expect(ft.isDisabled()).toBe(false);
    ft.recordFailure("sqlite_corrupt");
    expect(ft.isDisabled()).toBe(true);
  });

  it("recordSuccess clears the failure streak", () => {
    dir = mkdtempSync(join(tmpdir(), "composto-ft-"));
    const ft = createFailureTracker(dir);
    ft.recordFailure("sqlite_corrupt");
    ft.recordFailure("sqlite_corrupt");
    ft.recordSuccess();
    ft.recordFailure("sqlite_corrupt");
    expect(ft.isDisabled()).toBe(false);
  });

  it("counts different failure classes separately", () => {
    dir = mkdtempSync(join(tmpdir(), "composto-ft-"));
    const ft = createFailureTracker(dir);
    ft.recordFailure("sqlite_corrupt");
    ft.recordFailure("worker_crash");
    ft.recordFailure("sqlite_corrupt");
    expect(ft.isDisabled()).toBe(false);
  });
});
