# BlastRadius — Per-signal diagnostic (Plan 5b follow-up)

**Date:** 2026-04-22
**Scope:** Per-signal fire-rate + strength distribution on pre-break snapshots, two repos (composto, picomatch). Companion to `docs/blastradius-proof-v2.md`.
**Harness:** `scripts/backtest/diagnose-signals.ts`
**Raw records:** `scripts/backtest/out/diagnose-{composto,picomatch}.json`

---

## Why this doc exists

Proof v2 said: with `revert_match` excluded, signal-attributed recall collapses to **2.8% on composto** and **32% on picomatch**. That tells us the four non-revert signals barely fire pre-break — but not *which* ones, *how often*, or *why*.

This doc answers those questions. It is the diagnosis that drives the Plan 2 rework scope.

## Method

For each ground-truth event in the repo (filtered to `revert_marker` + `short_followup_fix`), the harness:

1. Ingests Tier 1 fresh into a scratch DB up to and including the `suspected_break_sha`.
2. For each `file_path` the corresponding fix touched, calls `collectSignals(db, repoPath, file)` against the pre-break DB.
3. Records the raw `Signal[]` output — `strength`, `precision`, `sample_size` per signal type — without going through scoring.

Per-signal aggregates:
- **fire_rate** — fraction of observations where `strength > 0`.
- **median strength when fired** — central tendency of non-zero strengths.
- **p90 strength when fired** — upper tail.
- **median sample_size** — does the signal even have data to work with?

## Findings

### composto (143 observations across 40 events)

| Signal | Fire rate | Median strength when fired | p90 | Median sample_size |
|--------|-----------|---------------------------|-----|--------------------|
| revert_match | 13.3% | 0.700 | 0.700 | 26 |
| hotspot | **72.7%** | **0.100** | 0.200 | 81 |
| fix_ratio | 2.1% | 0.067 | 0.067 | 84 |
| coverage_decline | **0.0%** | — | — | 0 |
| author_churn | 0.7% | 0.500 | 0.500 | 10 |

### picomatch (103 observations across 33 events)

| Signal | Fire rate | Median strength when fired | p90 | Median sample_size |
|--------|-----------|---------------------------|-----|--------------------|
| revert_match | 87.4% | 0.700 | 0.700 | 31 |
| hotspot | 46.6% | **0.033** | 0.033 | 158 |
| fix_ratio | 10.7% | 0.133 | 0.200 | 158 |
| coverage_decline | **0.0%** | — | — | 0 |
| author_churn | **95.1%** | **1.000** | 1.000 | 1004 |

## Diagnosis — three signals are broken in three different ways

### 1. `coverage_decline` — structurally dead

**0% fire rate on both repos.** Median sample_size is 0 — meaning the signal has no data to work with. Either the implementation isn't reading from the graph correctly, or coverage data isn't being ingested at all.

**Hypothesis:** the signal expects a `coverage_history` or similar table that Plan 2 didn't actually populate. Plan 2 marked this signal as "real" but it may be returning zero from a code path that bypasses real computation.

**Fix scope:** investigate `src/memory/signals/coverage-decline.ts`. Either implement it against an actual data source (test runs over time, lcov ingestion) or remove from the signal set with an honest "deferred" label.

### 2. `hotspot` — fires constantly at noise-floor strength

**46-73% fire rate but median strength 0.03-0.10.** This is the worst kind of signal: it speaks loudly enough to muddy scoring (high fire rate adds weight to many files) but never strongly enough to discriminate. composto strength 0.10 means "barely above zero"; picomatch 0.03 is even closer to nothing.

**Hypothesis:** the strength formula is over-normalized. If the formula is `strength = clamp(touches_in_window / threshold, 0, 1)` and threshold is high relative to typical activity, every file ends up at the noise floor.

**Fix scope:** rewrite the strength curve. Options: (a) raise the firing threshold (fewer fires, stronger when they happen), (b) use a non-linear curve (log-scaled or quantile-mapped), (c) compare against repo's own activity distribution rather than a fixed threshold. Calibration target: median strength when fired should be ≥ 0.4, fire rate ≤ 30%.

### 3. `author_churn` — collapses to 0% on small repos, saturates to 100% on bigger ones

**composto 0.7%, picomatch 95.1%.** Same signal, two repos, opposite behaviors. composto's median sample_size when fired is 10 (tiny), suggesting the signal needs more author data than composto has. picomatch saturates at strength 1.0 (sample_size 1004), suggesting the signal floors at "any author churn whatsoever = max risk".

**Hypothesis:** the signal isn't normalized to repo size or author-base shape. It's calibrated for one repo's distribution and breaks elsewhere.

**Fix scope:** normalize against the repo's baseline author-churn distribution (e.g., ratio against repo median, or quantile within author_churn over the repo's history). Add a sample_size floor — refuse to fire when there isn't enough data.

### 4. `fix_ratio` — universally weak but not dead

2-11% fire rate, strength 0.07-0.13. This signal is alive but contributing little. Lower priority than the three broken ones — fix after diagnosing whether its low fire rate is by design (rare bug-prone files) or by miscalibration.

### 5. `revert_match` — works as designed

13-87% fire rate, consistent strength 0.7. The one signal carrying the product. Don't touch.

## Implications for Plan 2 rework

**Surgical scope (recommended):** Fix three signals, leave two alone.

| Signal | Action | Estimated effort |
|--------|--------|------------------|
| coverage_decline | Investigate; either implement against real data or remove honestly | 3-5 days |
| hotspot | Rewrite strength curve, recalibrate against repo-local distribution | 3-5 days |
| author_churn | Add normalization + sample_size floor | 2-3 days |
| fix_ratio | Audit, defer further work pending hotspot/author_churn outcome | 1 day |
| revert_match | No change | 0 days |

**Plus** validation: re-run time-travel backtest after each signal fix to confirm signal-attributed precision/recall move toward the gate.

**Total realistic estimate:** 2-3 weeks for the three fixes + validation. Matches Path A's original ~3-4 week budget with margin.

## Next decision points (for the human)

1. **Approve surgical scope** — three signal fixes, in the order above (coverage_decline first because it's the easiest to reason about: either implement or remove).
2. **Decide on coverage_decline:** is it worth implementing against a real data source (this requires a coverage ingestion pipeline, which is a separate sub-feature), or do we honestly retire it from the v1 signal set and shrink the catalogue from 5 to 4?
3. **Set the new signal-attributed gate:** if surgical scope succeeds, what's the new bar? Spec §9.3's 0.6/0.4 was set when we thought v1 numbers were honest. A defensible new gate might be precision ≥ 0.55, recall ≥ 0.40 on the medium|high band — slightly relaxed precision in exchange for honest measurement.
