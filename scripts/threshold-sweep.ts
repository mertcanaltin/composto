#!/usr/bin/env tsx
// Threshold sweep: run the honest time-travel backtest ONCE per repo, collect
// every scored sample, then compute precision/recall at a range of firing
// thresholds offline. The production flag rule is `confidence >= 0.3 AND
// score >= T` (T=0.3 today, the medium boundary). We sweep T to find where
// precision crosses the 0.60 ship gate while recall stays above 0.40.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTimeTravelBacktest } from "./backtest/time-travel.js";

const CONF_GATE = 0.3;
const THRESHOLDS = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60];

async function sweepRepo(repoPath: string, maxEvents: number) {
  const workDir = mkdtempSync(join(tmpdir(), "composto-sweep-"));
  try {
    const res = await runTimeTravelBacktest({
      repoPath,
      workDir,
      maxEvents,
      excludeSignals: [],
      onProgress: (d, t) => { if (d % 20 === 0) console.error(`[sweep] ${repoPath} ${d}/${t}`); },
    });
    const samples = res.scored_samples ?? [];
    const pos = samples.filter((s) => s.positive).length;
    const rows = THRESHOLDS.map((T) => {
      let tp = 0, fp = 0;
      for (const s of samples) {
        const flagged = s.confidence >= CONF_GATE && s.score >= T;
        if (!flagged) continue;
        if (s.positive) tp++; else fp++;
      }
      const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
      const recall = pos === 0 ? 0 : tp / pos;
      return { T, tp, fp, precision, recall };
    });
    return { repoPath, events: res.events_evaluated, positives: pos, samples: samples.length, rows };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const repos = process.argv.slice(2);
  const maxEvents = Number(process.env.MAX_EVENTS ?? "80");
  if (repos.length === 0) { console.error("usage: threshold-sweep <repo> [repo...]"); process.exit(1); }
  for (const repo of repos) {
    const r = await sweepRepo(repo, maxEvents);
    console.log(`\n=== ${r.repoPath}  (events=${r.events}, positives=${r.positives}, samples=${r.samples}) ===`);
    console.log("  T     precision  recall   tp   fp   gate(P>=.6,R>=.4)");
    for (const row of r.rows) {
      const gate = row.precision >= 0.6 && row.recall >= 0.4 ? "PASS" : "";
      console.log(
        `  ${row.T.toFixed(2)}   ${row.precision.toFixed(3)}     ${row.recall.toFixed(3)}   ${String(row.tp).padStart(3)}  ${String(row.fp).padStart(3)}   ${gate}`
      );
    }
  }
}

main();
