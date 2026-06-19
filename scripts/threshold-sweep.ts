#!/usr/bin/env tsx
// Run the honest time-travel backtest ONCE per repo, collect every scored
// sample (score, confidence, positive, cochange), then analyze OFFLINE:
//   1. Discrimination power (AUC) of the current `score` vs the prototype
//      `cochange` signal — does co-change separate fix-files from controls
//      better than the current per-file activity score?
//   2. Whether adding a cochange GATE on top of the current firing rule
//      (score>=0.3 AND conf>=0.3) raises precision toward the 0.60 ship gate
//      while keeping recall above 0.40.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTimeTravelBacktest } from "./backtest/time-travel.js";

const CONF_GATE = 0.3;
const SCORE_GATE = 0.3;

type Sample = { score: number; confidence: number; positive: boolean; cochange: number };

// AUC = P(value(positive) > value(negative)) over all pos/neg pairs; 0.5 = no
// discrimination, 1.0 = perfect. Ties count as 0.5.
function auc(samples: Sample[], pick: (s: Sample) => number): number {
  const pos = samples.filter((s) => s.positive).map(pick);
  const neg = samples.filter((s) => !s.positive).map(pick);
  if (pos.length === 0 || neg.length === 0) return 0.5;
  let win = 0;
  for (const p of pos) for (const n of neg) win += p > n ? 1 : p === n ? 0.5 : 0;
  return win / (pos.length * neg.length);
}

function pr(samples: Sample[], flag: (s: Sample) => boolean) {
  const pos = samples.filter((s) => s.positive).length;
  let tp = 0, fp = 0;
  for (const s of samples) {
    if (!flag(s)) continue;
    if (s.positive) tp++; else fp++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = pos === 0 ? 0 : tp / pos;
  return { precision, recall, tp, fp };
}

async function sweepRepo(repoPath: string, maxEvents: number) {
  const workDir = mkdtempSync(join(tmpdir(), "composto-sweep-"));
  try {
    const res = await runTimeTravelBacktest({
      repoPath, workDir, maxEvents, excludeSignals: [],
      onProgress: (d, t) => { if (d % 20 === 0) console.error(`[sweep] ${repoPath} ${d}/${t}`); },
    });
    const samples = (res.scored_samples ?? []) as Sample[];
    const base = (s: Sample) => s.confidence >= CONF_GATE && s.score >= SCORE_GATE;

    console.log(`\n=== ${repoPath}  (events=${res.events_evaluated}, samples=${samples.length}) ===`);
    console.log(`  AUC score   = ${auc(samples, (s) => s.score).toFixed(3)}   (current activity signal)`);
    console.log(`  AUC cochange= ${auc(samples, (s) => s.cochange).toFixed(3)}   (prototype co-change signal)`);

    const b = pr(samples, base);
    console.log(`  baseline (score>=.3):              P=${b.precision.toFixed(3)} R=${b.recall.toFixed(3)} tp=${b.tp} fp=${b.fp}`);
    for (const K of [1, 2, 3, 5, 10]) {
      const r = pr(samples, (s) => base(s) && s.cochange >= K);
      const gate = r.precision >= 0.6 && r.recall >= 0.4 ? " PASS" : "";
      console.log(`  + raw cochange>=${String(K).padStart(2)} gate:          P=${r.precision.toFixed(3)} R=${r.recall.toFixed(3)} tp=${r.tp} fp=${r.fp}${gate}`);
    }
    // Normalized: gate on cochange's percentile WITHIN this repo, so the
    // threshold is comparable across repos of different size/age.
    const sorted = [...samples].map((s) => s.cochange).sort((a, b2) => a - b2);
    const quantile = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    for (const P of [0.4, 0.5, 0.6, 0.7]) {
      const cut = quantile(P);
      const r = pr(samples, (s) => base(s) && s.cochange >= cut);
      const gate = r.precision >= 0.6 && r.recall >= 0.4 ? " PASS" : "";
      console.log(`  + cochange pctl>=${P.toFixed(1)} (cut=${cut}): P=${r.precision.toFixed(3)} R=${r.recall.toFixed(3)} tp=${r.tp} fp=${r.fp}${gate}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const repos = process.argv.slice(2);
  const maxEvents = Number(process.env.MAX_EVENTS ?? "80");
  if (repos.length === 0) { console.error("usage: threshold-sweep <repo> [repo...]"); process.exit(1); }
  for (const repo of repos) await sweepRepo(repo, maxEvents);
}

main();
