#!/usr/bin/env tsx
// Find the best co-change FLOOR offline. Run the time-travel backtest ONCE per
// repo with COMPOSTO_COCHANGE_FLOOR=1 (gate disabled, so the recorded `score`
// is the raw base score), then sweep the FLOOR offline by applying the
// multiplicative gate final = base * (FLOOR + (1-FLOOR)*strength), where
// strength = min(1, cochange_degree / 10) — the same math as production's
// computeScoreAndConfidence. Flag rule mirrors production: conf>=0.3 AND
// final>=0.3. Goal: a FLOOR that lifts precision to >=0.60 while recall stays
// >=0.40 on BOTH repos.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTimeTravelBacktest } from "./backtest/time-travel.js";

const CONF_GATE = 0.3;
const SCORE_GATE = 0.3;
const SATURATION_DEGREE = 10;
const FLOORS = [1.0, 0.7, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0];

type Sample = { score: number; confidence: number; positive: boolean; cochange: number };

function pr(samples: Sample[], floor: number) {
  const pos = samples.filter((s) => s.positive).length;
  let tp = 0, fp = 0;
  for (const s of samples) {
    const strength = Math.min(1, s.cochange / SATURATION_DEGREE);
    const final = s.score * (floor + (1 - floor) * strength);
    const flagged = s.confidence >= CONF_GATE && final >= SCORE_GATE;
    if (!flagged) continue;
    if (s.positive) tp++; else fp++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = pos === 0 ? 0 : tp / pos;
  return { precision, recall, tp, fp };
}

async function sweepRepo(repoPath: string, maxEvents: number) {
  const workDir = mkdtempSync(join(tmpdir(), "composto-sweep-"));
  try {
    // Gate disabled during collection so `score` is the raw base score.
    process.env.COMPOSTO_COCHANGE_FLOOR = "1";
    const res = await runTimeTravelBacktest({
      repoPath, workDir, maxEvents, excludeSignals: [],
      onProgress: (d, t) => { if (d % 20 === 0) console.error(`[sweep] ${repoPath} ${d}/${t}`); },
    });
    const samples = (res.scored_samples ?? []) as Sample[];
    console.log(`\n=== ${repoPath}  (events=${res.events_evaluated}, samples=${samples.length}) ===`);
    console.log("  FLOOR  precision  recall   tp   fp   gate(P>=.6,R>=.4)");
    for (const f of FLOORS) {
      const r = pr(samples, f);
      const tag = f === 1.0 ? " (baseline)" : "";
      const gate = r.precision >= 0.6 && r.recall >= 0.4 ? " PASS" : "";
      console.log(`  ${f.toFixed(2)}   ${r.precision.toFixed(3)}     ${r.recall.toFixed(3)}   ${String(r.tp).padStart(3)}  ${String(r.fp).padStart(3)}  ${gate}${tag}`);
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
