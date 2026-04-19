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
  const usable = signals.filter((s) => s.strength > 0).length;
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

export function computeScoreAndConfidence(
  signals: Signal[],
  ctx: ConfidenceContext
): ScoreAndConfidence {
  let num = 0;
  let den = 0;
  for (const s of signals) {
    if (s.strength <= 0 || s.precision <= 0) continue;
    num += s.strength * s.precision;
    den += s.precision;
  }
  const score = den === 0 ? 0 : num / den;

  const confidence = Math.min(
    coverageFactor(signals),
    calibrationFactor(signals),
    freshnessFactor(ctx),
    historyFactor(ctx.totalCommits)
  );

  return { score, confidence };
}
