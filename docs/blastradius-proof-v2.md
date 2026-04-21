# BlastRadius — Quality Proof v2 (Plan 5b · time-travel)

**Date:** 2026-04-20 (this run), 2026-04-21 (doc written)
**Scope:** Two public repos (composto, picomatch) evaluated against the new time-travel harness. Third repo (vitest / zod) deferred — the two-repo signal is already load-bearing for the Phase 0 ship gate decision (see §4).
**Harness:** `scripts/backtest/time-travel.ts` + `scripts/blastradius-backtest.ts --time-travel`

---

## Ship-gate decision: **NOT MET**

Spec §9.3 defines the ship gate as **precision ≥ 0.60 and recall ≥ 0.40** on the `medium|high` verdict band across at least three public repos. The signal-attributed runs (revert_match excluded) fail this threshold on both repos. The unattributed run on composto itself also fails. **Phase 0 ship gate is blocked pending Plan 2 signal revision.**

This is a material revision of the v1 proof's claim. See §5.

---

## 1. Why v2 — the v1 proof was circular

The v1 backtest (`docs/blastradius-proof.md`) queried BlastRadius against `HEAD` and compared its `medium|high` verdict to the repo's fix_links ground truth. The `revert_match` signal is derived directly from fix_links — at HEAD, every fix has already been indexed, so revert_match trivially matches ground truth. The v1 numbers (composto: precision 0.939, recall 1.000) were inflated by this circularity.

v2 rewinds the DB to the pre-fix ("suspected break") SHA for each ground-truth event and queries the signal on that snapshot. The self-audit (`fix_links_visible_pre_break == 0`) confirms the fix is not in the DB at query time. We also run with `--exclude-signal revert_match` for signal-attributed precision — so readers can see the contribution of the four non-circular signals alone.

## 2. Harness design

- **Per-event scratch DB.** For each ground-truth event (filtered to `revert_marker` and `short_followup_fix` evidence types), the harness creates a fresh SQLite and ingests Tier 1 up to and including `suspected_break_sha`. The fix commit is not in that DB.
- **Positive set.** For each event, the positive set is the file_touches of the fix commit — the files the fix ended up modifying. A "correct" flag is BlastRadius returning `medium` or `high` on one of those files pre-fix.
- **Negative set (control pass).** For each event, the harness also samples up to 5 non-fix-touched files that exist in the pre-fix DB (ordered by `last_ts DESC` so controls skew recent — representative of realistic developer activity). A `medium|high` verdict on a control counts as FP.
- **Signal exclusion.** `--exclude-signal <name>` zeros both `strength` and `precision` of the named signal before `computeScoreAndConfidence` runs, so the verdict math is identical to "signal never computed".
- **Deterministic sampling.** `sampleUniform` picks events by index, no PRNG. Same input → same output.

Full source: `scripts/backtest/time-travel.ts`.

## 3. Results

Both repos run with `--max-events 40`. composto: 40 of 48 events evaluated. picomatch: all 33 events evaluated.

### 3.1 composto (self-reference)

**Unattributed** (all signals active, including revert_match):

```json
{
  "repo": "composto",
  "events_evaluated": 40,
  "files_predicted": 145,
  "tp": 18, "fp": 34, "fn": 127,
  "precision": 0.346,
  "recall":    0.124,
  "ship_gate": { "passed_precision": false, "passed_recall": false }
}
```

**Signal-attributed** (`--exclude-signal revert_match`):

```json
{
  "repo": "composto",
  "events_evaluated": 40,
  "files_predicted": 145,
  "tp": 4, "fp": 4, "fn": 141,
  "precision": 0.500,
  "recall":    0.028,
  "ship_gate": { "passed_precision": false, "passed_recall": false }
}
```

### 3.2 picomatch

**Unattributed:**

```json
{
  "repo": "picomatch",
  "events_evaluated": 33,
  "files_predicted": 103,
  "tp": 84, "fp": 54, "fn": 19,
  "precision": 0.609,
  "recall":    0.816,
  "ship_gate": { "passed_precision": true, "passed_recall": true }
}
```

**Signal-attributed:**

```json
{
  "repo": "picomatch",
  "events_evaluated": 33,
  "files_predicted": 103,
  "tp": 33, "fp": 40, "fn": 70,
  "precision": 0.452,
  "recall":    0.320,
  "ship_gate": { "passed_precision": false, "passed_recall": false }
}
```

### 3.3 Summary

| Repo | Mode | Precision | Recall | Gate |
|------|------|-----------|--------|------|
| composto | unattributed | 0.346 | 0.124 | ❌ / ❌ |
| composto | attributed | 0.500 | 0.028 | ❌ / ❌ |
| picomatch | unattributed | 0.609 | 0.816 | ✅ / ✅ |
| picomatch | attributed | 0.452 | 0.320 | ❌ / ❌ |

## 4. What this means

**revert_match is load-bearing.** On both repos, excluding revert_match causes recall to collapse and precision to drop. The four non-circular signals (hotspot, fix_ratio, coverage_decline, author_churn) flag too few files pre-break — recall of 2.8% on composto and 32% on picomatch.

**composto fails even unattributed.** This is the most significant finding. The v1 proof reported composto at 93.9% precision and 100% recall, but that was against HEAD with revert_match inflating the signal. The honest time-travel eval is 34.6% / 12.4%. This revises the v1 claim downward by a factor of ~3 on precision and ~8 on recall.

**picomatch passes unattributed** — but only because revert_match carries it. With revert_match excluded the same repo fails precision (0.452 vs 0.6 target) and recall (0.32 vs 0.4 target). So even the one passing case doesn't establish signal quality; it establishes that revert_match works as a memorized-history signal, which we already knew.

## 5. Ship gate & next steps

The spec §9.3 ship gate is not met. Two reasonable paths:

**A. Revise signals (Plan 2 rework).** The four non-revert_match signals need calibration on real pre-break snapshots, not HEAD. This likely means:
- `hotspot` thresholds tuned against time-travel baselines
- `fix_ratio` windowed to pre-break history only (may already be, needs audit)
- `coverage_decline` — hardest to compute pre-break reliably
- `author_churn` — may be firing too conservatively

**B. Reframe the ship gate.** If the product claim is "revert_match tells you when a file has a bug history that matches the current edit", that's a narrower but honest claim. The unattributed picomatch numbers (0.609 / 0.816) support it. But this is a re-scoping of what BlastRadius promises, not a pass of the original gate.

The revolution program (Phase 0 / Phase 1 / Phase 2) depends on the answer. This doc deliberately does not decide — it surfaces the numbers for product decision.

## 6. Honest caveats

- **n=33 and n=40 events.** Small samples; confidence intervals wide. Larger repos would tighten the picture.
- **Control pass is adversarial.** Controls are "recent files" (ordered by last_ts DESC) — i.e., exactly the files a developer is likely to be editing anyway. This makes FP harder to avoid, which is the right pressure for a product that fires on every edit.
- **Ground truth is strict.** "Fix files" = file_touches of the fix commit. A bug might be in file A but fixed by editing file B (contract change). Those cases are counted as FN here, even though the signal may have been "right" in some informal sense.
- **Third repo deferred.** Originally the plan targeted composto + picomatch + vitest (or zod with its FK bug worked around). Not run: the two-repo signal is already load-bearing for the gate decision, and the finding does not improve with a third.
- **revert_match's "circularity"** is softer than the v1 proof implied. Pre-break DBs contain historical fix_links for prior bugs on the same file, so revert_match fires legitimately on files with bug history. It's not purely circular — it memorizes past bugs, which is a real signal. But the v1 HEAD-based eval conflated "memorized past bug" with "predicted future bug".

## 7. Reproducing

```bash
# Clone backtest targets
mkdir -p /tmp/composto-backtest-repos
cd /tmp/composto-backtest-repos
git clone https://github.com/micromatch/picomatch.git

# From composto worktree
cd $COMPOSTO_WORKTREE
pnpm build

# Unattributed
pnpm exec tsx scripts/blastradius-backtest.ts . --time-travel --max-events 40
pnpm exec tsx scripts/blastradius-backtest.ts /tmp/composto-backtest-repos/picomatch --time-travel --max-events 40

# Signal-attributed (exclude revert_match)
pnpm exec tsx scripts/blastradius-backtest.ts . --time-travel --max-events 40 --exclude-signal revert_match
pnpm exec tsx scripts/blastradius-backtest.ts /tmp/composto-backtest-repos/picomatch --time-travel --max-events 40 --exclude-signal revert_match
```

Harness is deterministic — same SHAs → same numbers.
