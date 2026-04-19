# BlastRadius — Quality Proof (v1)

**Date:** 2026-04-19
**Scope:** One repo (composto itself), post-ingest ground-truth confusion matrix against the `medium|high` verdict band.
**Harness:** `scripts/blastradius-backtest.ts`

---

## Ship gate

Spec §9.3 defines the ship gate as **precision > 60% and recall > 40%** on the `medium|high` verdict band across at least three public repos. This v1 runs against one repo only; Plan 5b will extend to `vitest` and one more public project.

## Results on the composto repository

Run: `pnpm exec tsx scripts/blastradius-backtest.ts .`

```json
{
  "repo": "composto",
  "total_files": 108,
  "scanned": 108,
  "ground_truth_files": 74,
  "verdicts": {
    "high":    0,
    "medium": 49,
    "low":    58,
    "unknown": 1
  },
  "confusion_matrix_medium_high_band": {
    "tp": 46,
    "fp":  3,
    "fn":  0,
    "tn": 59
  },
  "precision": 0.939,
  "recall":    1.000,
  "ship_gate": {
    "precision_target": 0.6,
    "recall_target":    0.4,
    "passed_precision": true,
    "passed_recall":    true
  }
}
```

**Ship gate status: PASSED for this single repo.**

- Precision: **93.9%** (46 TP / 49 medium-or-high). Of the files blastradius flagged as risky, 94% actually have a fix_link tied to them in the history.
- Recall: **100%** (46 TP / 46 files-with-ground-truth-still-in-the-filesystem). No file that still exists and has fix_link history slipped through as "low".
- Three false positives: files flagged medium|high without fix_links attached — candidate cases where the signal fires on *predictive* rather than *verified-historical* risk.

## Caveats on the v1 number

This is a **post-hoc confusion matrix**, not a true time-travel backtest. Two honest qualifications:

1. **Partial signal–ground-truth correlation.** One of the five signals (`revert_match`) reads directly from `fix_links`, which is also the ground-truth source. Some of the measured precision is therefore tautological: if revert_match were the only signal, the question reduces to "does revert_match fire iff a fix_link exists on the file?" — trivially correlated. The four other signals (`hotspot`, `fix_ratio`, `coverage_decline`, `author_churn`) are independent of fix_links and drove the verdict jointly; that said, v1 doesn't break the confusion matrix down by signal, so a pure non-revert-match precision cannot be reported here.
2. **Recall is scoped to the current working tree.** 74 files appear in `fix_links` history; only 46 of those still exist in HEAD's filesystem. The remaining 28 are deleted / renamed — v1 doesn't try to score them. Under the harsher "recall against all ground-truth including deleted files" interpretation, recall is 46/74 ≈ **62%**, which still clears the 40% gate but is meaningfully below 100%.

## What a stricter backtest (Plan 5b) should add

- **Time-travel queries.** For each historical fix commit `F`, rewind the effective DB state to `F^` and ask blastradius what verdict it would have returned for the files `F` touched. Only count true positives where the signal was available *before* the fix landed.
- **Signal attribution.** Break down precision/recall per signal: a version where `revert_match` is excluded would confirm whether the independent signals carry enough weight on their own.
- **Multi-repo coverage.** Run on `vitest` and at least one additional public OSS repo of moderate scale (2k–15k commits). Ship-gate wording in spec §9.3 requires three repos.
- **Calibration lock.** v1 runs with repo-calibrated precision written by Plan 2's `refreshCalibration`. Plan 5b should record those per-repo precision values to the proof doc so future runs can compare against a fixed reference.

## Reproducibility

```bash
# fresh clone
git clone https://github.com/mertcanaltin/composto.git
cd composto
pnpm install
pnpm build

# run the harness
pnpm exec tsx scripts/blastradius-backtest.ts .
```

Expected wall-clock: under 30 seconds on a ~100-file, ~20-commit repo. Memory footprint: under 50 MB (SQLite DB at `.composto/memory.db` is ~100 KB for this repo).

## Conclusion

The wedge-level claim from §1 of the design spec — "Composto becomes the causal oracle for coding agents" — clears its first numerical bar on its own codebase. The v1 backtest doesn't prove the claim at spec strength (single repo, partial signal independence, no time travel), but it does show the signals aren't noise: they cluster reliably on files with real fix history and stay out of the way on files without one. Plan 5b will tighten this into a three-repo, signal-attributed, time-travel evaluation.
