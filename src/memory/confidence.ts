// Implements spec §6.1–6.3: score and confidence math.

import type { Signal, Tazelik } from "./types.js";

export interface ConfidenceContext {
  tazelik: Tazelik;
  partial: boolean;
  totalCommits: number;
}

export interface ScoreAndConfidence {
  score: number;
  confidence: number;
}

const USABLE_SAMPLE_THRESHOLD = 20;

function coverageFactor(signals: Signal[]): number {
  const usable = signals.filter(
    (s) => s.strength > 0 && s.sample_size >= USABLE_SAMPLE_THRESHOLD
  ).length;
  return Math.min(1.0, usable / 3);
}

function calibrationFactor(signals: Signal[]): number {
  const firing = signals.filter((s) => s.strength > 0);
  if (firing.length === 0) return 1.0;
  const avg = firing.reduce((acc, s) => acc + s.sample_size, 0) / firing.length;
  if (avg < 20) return 0.3;
  if (avg < 100) return 0.6;
  return 1.0;
}

function freshnessFactor(ctx: ConfidenceContext): number {
  if (ctx.partial) return 0.4;
  switch (ctx.tazelik) {
    case "fresh":         return 1.0;
    case "catching_up":   return 0.8;
    case "partial":       return 0.4;
    case "bootstrapping": return 0.2;
  }
}

function historyFactor(totalCommits: number): number {
  if (totalCommits < 50) return 0.2;
  if (totalCommits < 200) return 0.5;
  if (totalCommits < 1000) return 0.8;
  return 1.0;
}

// Co-change can be applied CONJUNCTIVELY (a multiplicative gate): a factor in
// [FLOOR, 1] pulls down the score of files with weak fix-coupling, so a file
// must be BOTH risky AND a coupling hub to keep a high score. A weighted
// average (disjunctive) cannot express this, which is why adding co-change to
// the average did nothing (measured).
//
// HONEST STATUS: a 4-repo backtest (fastify, express, got, flask) showed the
// gate is NOT a reliable global win. It lifts precision past the 0.60 gate on
// fastify but NOT on the other three, and on flask co-change is actually
// anti-discriminative (AUC 0.48), so the gate hurts recall there for no
// precision gain. There is no global FLOOR that helps across repos. So the
// gate ships DISABLED by default (FLOOR=1 → factor is always 1, a no-op) and
// is left as an env-tunable opt-in for repos where it is known to help. The
// real precision fix needs a fundamentally stronger discriminator than
// co-change; tuning FLOOR cannot get there.
const DEFAULT_COCHANGE_FLOOR = 1.0;

// Read at call time (not module load) so it is tunable per run/process.
function cochangeFloor(): number {
  const v = Number(process.env.COMPOSTO_COCHANGE_FLOOR);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_COCHANGE_FLOOR;
}

export function computeScoreAndConfidence(
  signals: Signal[],
  ctx: ConfidenceContext
): ScoreAndConfidence {
  // Co-change gates the final score; every other signal feeds the average.
  const cochange = signals.find((s) => s.type === "cochange");
  const averaged = signals.filter((s) => s.type !== "cochange");

  let num = 0;
  let den = 0;
  for (const s of averaged) {
    if (s.strength <= 0 || s.precision <= 0) continue;
    num += s.strength * s.precision;
    den += s.precision;
  }
  let score = den === 0 ? 0 : num / den;

  if (cochange) {
    const floor = cochangeFloor();
    score *= floor + (1 - floor) * cochange.strength;
  }

  const confidence = Math.min(
    coverageFactor(averaged),
    calibrationFactor(averaged),
    freshnessFactor(ctx),
    historyFactor(ctx.totalCommits)
  );

  return { score, confidence };
}
