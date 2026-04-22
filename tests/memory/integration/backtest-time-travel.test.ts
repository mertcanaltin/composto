// Integration tests for the time-travel backtest harness.
//
// Plan 5b scope: the v1 backtest (scripts/blastradius-backtest.ts) queries
// BlastRadius against HEAD — so revert_match, which reads directly from
// fix_links (the ground-truth source), trivially matches. The time-travel
// harness rewinds the DB to the "suspected break" commit for each
// ground-truth event, queries BlastRadius, and compares the verdict against
// whether a real fix actually followed.
//
// These tests cover the shape of the harness; the real calibration numbers
// for composto/picomatch/vitest are reported in docs/blastradius-proof-v2.md.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTimeTravelBacktest } from "../../../scripts/backtest/time-travel.js";

describe("runTimeTravelBacktest — ground-truth events on a small repo", () => {
  let repoDir: string;
  let workDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-tt-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, {
      stdio: "ignore",
    });
    workDir = mkdtempSync(join(tmpdir(), "composto-tt-work-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it("enumerates at least one time-travel event on the fixture repo", async () => {
    const result = await runTimeTravelBacktest({
      repoPath: repoDir,
      workDir,
      maxEvents: 10,
    });
    expect(result.events_total).toBeGreaterThan(0);
    expect(result.events_evaluated).toBeGreaterThan(0);
  });

  it("accepts --exclude-signal revert_match and preserves the monotonic bound", async () => {
    // Time-travel insight: at a pre-break snapshot, revert_match reads
    // fix_links filtered to the break SHA — and the self-audit (next test)
    // locks in that this count is 0 pre-break. So revert_match's strength
    // is already 0 at time-travel time, which means --exclude-signal
    // revert_match is tautological here. That's by design: the whole point
    // of time-travel eval is to neutralize the circular signal naturally.
    //
    // What we still must verify on a fixture:
    //   (a) excludeSignals option is accepted without crashing,
    //   (b) attributed.excluded_signals records the exclusion,
    //   (c) the monotonic bound holds — excluding a signal can never
    //       *increase* the flagged cohort (signals only add positive
    //       weight to medium|high verdicts).
    //
    // The "strictly less" behavior is validated on full-repo runs in
    // docs/blastradius-proof-v2.md, where signals other than revert_match
    // actually fire pre-break.
    const unattributed = await runTimeTravelBacktest({
      repoPath: repoDir,
      workDir: mkdtempSync(join(tmpdir(), "composto-tt-unattr-")),
      maxEvents: 10,
    });
    const attributed = await runTimeTravelBacktest({
      repoPath: repoDir,
      workDir: mkdtempSync(join(tmpdir(), "composto-tt-attr-")),
      maxEvents: 10,
      excludeSignals: ["revert_match"],
    });

    expect(attributed.excluded_signals).toEqual(["revert_match"]);
    expect(unattributed.excluded_signals).toEqual([]);
    expect(attributed.flagged_count).toBeLessThanOrEqual(unattributed.flagged_count);
  });

  it("rewinds the graph to pre-break state (no fix_links visible at query time)", async () => {
    // When we time-travel to the suspected_break_sha, the DB must NOT yet
    // contain the fix commit that references it. Otherwise the signal
    // revert_match would trivially see the fix and fire even pre-fix,
    // replicating the v1 circularity.
    const result = await runTimeTravelBacktest({
      repoPath: repoDir,
      workDir: mkdtempSync(join(tmpdir(), "composto-tt-rewind-")),
      maxEvents: 10,
      returnDebugEvents: true,
    });

    // Every event's per-query DB snapshot must have 0 fix_links touching
    // the suspected_break_sha. The harness records this for self-audit.
    for (const ev of result.debug_events ?? []) {
      expect(ev.fix_links_visible_pre_break).toBe(0);
    }
  });
});
