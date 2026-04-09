import type { HealthAnnotation, TrendAnalysis } from "../types.js";

const CHURN_THRESHOLD = 10;
const FIX_RATIO_THRESHOLD = 0.5;

export function buildHealthTag(health: HealthAnnotation): string {
  const parts: string[] = [];
  if (health.churn > CHURN_THRESHOLD) parts.push(`HOT:${health.churn}/30`);
  if (health.fixRatio > FIX_RATIO_THRESHOLD) parts.push(`FIX:${Math.round(health.fixRatio * 100)}%`);
  if (health.coverageTrend === "down") parts.push("COV:↓");
  if (health.consistency === "low") parts.push("INCON");

  return parts.length > 0 ? `[${parts.join(" ")}]` : "";
}

export function annotateIR(ir: string, health: HealthAnnotation): string {
  const tag = buildHealthTag(health);
  if (!tag) return ir;

  const lines = ir.split("\n");
  lines[0] = `${lines[0]} ${tag}`;
  return lines.join("\n");
}

export function computeHealthFromTrends(file: string, trends: TrendAnalysis): HealthAnnotation {
  const hotspot = trends.hotspots.find((h) => h.file === file);
  const decay = trends.decaySignals.find((d) => d.file === file);
  const inconsistency = trends.inconsistencies.find((i) => i.file === file);

  return {
    churn: hotspot?.changesInLast30Commits ?? 0,
    fixRatio: hotspot?.bugFixRatio ?? 0,
    coverageTrend: decay?.trend === "declining" ? "down" : decay?.trend === "improving" ? "up" : "stable",
    staleness: "",
    authorCount: hotspot?.authorCount ?? 0,
    consistency: inconsistency ? "low" : "high",
  };
}
