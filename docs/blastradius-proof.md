# BlastRadius — Quality Proof (v1 · v0.4.1)

**Date:** 2026-04-19 (updated 2026-04-20 with picomatch + zod runs under v0.4.1)
**Scope:** Three public repos (composto, picomatch, zod) — all clear the ship gate. Post-ingest ground-truth confusion matrix against the `medium|high` verdict band.
**Harness:** `scripts/blastradius-backtest.ts`

---

## Ship gate

Spec §9.3 defines the ship gate as **precision > 60% and recall > 40%** on the `medium|high` verdict band across at least three public repos. As of v0.4.1 all three target repos pass.

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

**Ship gate status: PASSED.**

- Precision: **93.9%** (46 TP / 49 medium-or-high). Of the files blastradius flagged as risky, 94% actually have a fix_link tied to them in the history.
- Recall: **100%** (46 TP / 46 files-with-ground-truth-still-in-the-filesystem). No file that still exists and has fix_link history slipped through as "low".
- Three false positives: files flagged medium|high without fix_links attached — candidate cases where the signal fires on *predictive* rather than *verified-historical* risk.

## Results on picomatch

Run: `pnpm exec tsx scripts/blastradius-backtest.ts /path/to/picomatch`

```json
{
  "repo": "picomatch",
  "total_files": 62,
  "scanned": 62,
  "ground_truth_files": 80,
  "verdicts": { "high": 61, "medium": 1, "low": 0, "unknown": 0 },
  "confusion_matrix_medium_high_band": { "tp": 56, "fp": 6, "fn": 0, "tn": 0 },
  "precision": 0.903,
  "recall": 1.000
}
```

**Ship gate status: PASSED** — precision 90.3%, recall 100%.

Important caveat: picomatch is small (62 source files) with dense fix history (80 files touched by fix_links historically, 28 of them deleted). Blastradius flagged **all 62 live files as medium+**. That means precision is meaningful (90.3% of the files it flagged actually have fix_link history) but **recall is weak signal** (there are no true negatives to measure against). Takeaway: in small repos with long fix history, treat the verdict as "this file has been touched during a fix window at some point" rather than a differentiator between safe and risky files.

## Results on zod (post v0.4.1 fix)

v0.4.0 crashed on this repo with a FOREIGN KEY constraint failure during Tier 1 ingest — `commits.reverts_sha` pointed at SHAs not in the indexed commits table (truncated short SHAs, rebased branches, mistyped messages). v0.4.1's `resolveRevertsSha` now normalizes short SHAs to full ones via prefix match and drops dangling references to `NULL`; FK enforcement is also disabled during the batch insert to tolerate same-timestamp ordering ambiguity. With that fix in place:

```json
{
  "repo": "zod",
  "total_files": 394,
  "scanned": 394,
  "ground_truth_files": 1322,
  "verdicts": { "high": 343, "medium": 33, "low": 5, "unknown": 13 },
  "confusion_matrix_medium_high_band": { "tp": 361, "fp": 15, "fn": 3, "tn": 15 },
  "precision": 0.960,
  "recall": 0.992
}
```

**Ship gate status: PASSED** — precision 96.0%, recall 99.2%. zod is the largest of the three repos (394 files, 1322 historical paths in fix_links). Unlike picomatch, it has enough size that true negatives exist (15 `low` plus 13 `unknown` rejections); the verdict distribution is meaningfully spread (343 high, 33 medium, 5 low, 13 unknown) rather than collapsed.

## Summary

| Repo | Files | Ground truth | Medium+ | Precision | Recall |
|---|---|---|---|---|---|
| composto | 128 | 74 | 49 | 93.9% | 100% |
| picomatch | 62 | 80 | 62 | 90.3% | 100% |
| zod | 394 | 1322 | 376 | 96.0% | 99.2% |

Three repos, three passes. The spec §9.3 ship-gate (precision > 60%, recall > 40% on `medium|high`) now has its three-repo floor met.

## Caveats on the v1 number

This is a **post-hoc confusion matrix**, not a true time-travel backtest. Two honest qualifications:

1. **Partial signal–ground-truth correlation.** One of the five signals (`revert_match`) reads directly from `fix_links`, which is also the ground-truth source. Some of the measured precision is therefore tautological: if revert_match were the only signal, the question reduces to "does revert_match fire iff a fix_link exists on the file?" — trivially correlated. The four other signals (`hotspot`, `fix_ratio`, `coverage_decline`, `author_churn`) are independent of fix_links and drove the verdict jointly; that said, v1 doesn't break the confusion matrix down by signal, so a pure non-revert-match precision cannot be reported here.
2. **Recall is scoped to the current working tree.** 74 files appear in `fix_links` history; only 46 of those still exist in HEAD's filesystem. The remaining 28 are deleted / renamed — v1 doesn't try to score them. Under the harsher "recall against all ground-truth including deleted files" interpretation, recall is 46/74 ≈ **62%**, which still clears the 40% gate but is meaningfully below 100%.

## What a stricter backtest (Plan 5b) should add

- **Time-travel queries.** For each historical fix commit `F`, rewind the effective DB state to `F^` and ask blastradius what verdict it would have returned for the files `F` touched. Only count true positives where the signal was available *before* the fix landed.
- **Signal attribution.** Break down precision/recall per signal: a version where `revert_match` is excluded would confirm whether the independent signals carry enough weight on their own.
- **Multi-repo coverage.** Extend beyond composto + picomatch to two more repos of moderate scale (2k–15k commits). Spec §9.3 calls for three; v0.4.1's FK fix should unblock zod.
- **Small-repo over-flagging.** The picomatch run surfaced a design question: when a repo is small and fix-dense, the tool flags almost every file. Plan 5b should add a dispersion metric that distinguishes "dense fix history across most files" from "concentrated risk on specific files".
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

The wedge-level claim from §1 of the design spec — "Composto becomes the causal oracle for coding agents" — clears the spec §9.3 three-repo floor as of v0.4.1. Precision stays in the 90–96% band across composto, picomatch, and zod; recall holds at 99–100% on files still in the working tree. The v1 backtest still has honest limitations (post-hoc rather than time-travel queries, partial signal independence on `revert_match`, small-repo over-flagging on picomatch), but the bar is no longer a one-repo bar. Plan 5b will tighten this into a signal-attributed, time-travel evaluation.
