#!/usr/bin/env tsx
// Run the time-travel backtest ONCE per repo with COMPOSTO_COCHANGE_FLOOR=1
// (gate disabled → recorded `score` is the raw base), then OFFLINE:
//   - compare discrimination (AUC) of co-change v1 vs v2
//   - sweep the multiplicative FLOOR for each variant:
//       final = base * (FLOOR + (1-FLOOR) * strength),  strength = min(1, deg/SAT)
//     flag = conf>=0.3 AND final>=0.3. Goal: P>=0.60 AND R>=0.40 on both repos.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTimeTravelBacktest } from "./backtest/time-travel.js";

const CONF_GATE = 0.3;
const SCORE_GATE = 0.3;
const FLOORS = [1.0, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0];

type Sample = { score: number; confidence: number; positive: boolean; cochange: number; cochange2: number };

function auc(samples: Sample[], pick: (s: Sample) => number): number {
  const pos = samples.filter((s) => s.positive).map(pick);
  const neg = samples.filter((s) => !s.positive).map(pick);
  if (pos.length === 0 || neg.length === 0) return 0.5;
  let win = 0;
  for (const p of pos) for (const n of neg) win += p > n ? 1 : p === n ? 0.5 : 0;
  return win / (pos.length * neg.length);
}

function pr(samples: Sample[], floor: number, deg: (s: Sample) => number, sat: number) {
  const pos = samples.filter((s) => s.positive).length;
  let tp = 0, fp = 0;
  for (const s of samples) {
    const strength = Math.min(1, deg(s) / sat);
    const final = s.score * (floor + (1 - floor) * strength);
    if (!(s.confidence >= CONF_GATE && final >= SCORE_GATE)) continue;
    if (s.positive) tp++; else fp++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = pos === 0 ? 0 : tp / pos;
  return { precision, recall, tp, fp };
}

function table(label: string, samples: Sample[], deg: (s: Sample) => number, sat: number) {
  console.log(`  -- ${label} (saturation=${sat}) --`);
  for (const f of FLOORS) {
    const r = pr(samples, f, deg, sat);
    const gate = r.precision >= 0.6 && r.recall >= 0.4 ? " PASS" : "";
    const tag = f === 1.0 ? " (baseline)" : "";
    console.log(`     FLOOR ${f.toFixed(2)}  P=${r.precision.toFixed(3)} R=${r.recall.toFixed(3)} tp=${String(r.tp).padStart(3)} fp=${String(r.fp).padStart(3)}${gate}${tag}`);
  }
}

async function sweepRepo(repoPath: string, maxEvents: number) {
  const workDir = mkdtempSync(join(tmpdir(), "composto-sweep-"));
  try {
    process.env.COMPOSTO_COCHANGE_FLOOR = "1";
    const res = await runTimeTravelBacktest({
      repoPath, workDir, maxEvents, excludeSignals: [],
      onProgress: (d, t) => { if (d % 20 === 0) console.error(`[sweep] ${repoPath} ${d}/${t}`); },
    });
    const samples = (res.scored_samples ?? []) as Sample[];
    console.log(`\n=== ${repoPath}  (events=${res.events_evaluated}, samples=${samples.length}) ===`);
    console.log(`  AUC cochange v1 = ${auc(samples, (s) => s.cochange).toFixed(3)}`);
    console.log(`  AUC cochange v2 = ${auc(samples, (s) => s.cochange2).toFixed(3)}  (stable >=2 coupling)`);
    table("v1 raw degree", samples, (s) => s.cochange, 10);
    table("v2 stable coupling", samples, (s) => s.cochange2, 5);
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
