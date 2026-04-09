import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { loadConfig } from "../config/loader.js";
import { runDetector } from "../watcher/detector.js";
import { generateLayer } from "../ir/layers.js";
import { computeHealthFromTrends } from "../ir/health.js";
import { getGitLog } from "../trends/git-log-parser.js";
import { detectHotspots } from "../trends/hotspot.js";
import { detectDecay } from "../trends/decay.js";
import { detectInconsistencies } from "../trends/inconsistency.js";
import { route, DEFAULT_ROUTES } from "../router/router.js";
import { CLIAdapter } from "./adapter.js";
import { benchmarkFile, summarize } from "../benchmark/runner.js";
import type { TrendAnalysis, Finding } from "../types.js";

function collectFiles(dir: string, extensions: string[]): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
      if (entry.isDirectory()) {
        files.push(...collectFiles(fullPath, extensions));
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  } catch { /* ignore permission errors */ }
  return files;
}

export function runScan(projectPath: string): void {
  const adapter = new CLIAdapter();
  const config = loadConfig(projectPath);

  console.log("composto v0.1.0 — scanning...\n");

  const files = collectFiles(projectPath, [".ts", ".tsx", ".js", ".jsx"]);
  console.log(`  Found ${files.length} files\n`);

  const allFindings: Finding[] = [];
  for (const file of files) {
    const code = readFileSync(file, "utf-8");
    const relPath = relative(projectPath, file);
    const findings = runDetector(code, relPath, config.watchers);
    allFindings.push(...findings);
  }

  if (allFindings.length > 0) {
    console.log(`  Findings (${allFindings.length}):\n`);
    for (const finding of allFindings) {
      adapter.notify({ type: "finding", data: finding });
      const decision = route(finding, DEFAULT_ROUTES);
      console.log(`     -> Route: ${decision.agents.join(",")} @ ${decision.irLayer}\n`);
    }
  } else {
    console.log("  No issues found.\n");
  }
}

export function runTrends(projectPath: string): void {
  const adapter = new CLIAdapter();
  const config = loadConfig(projectPath);

  console.log("composto v0.1.0 — trend analysis...\n");

  const entries = getGitLog(projectPath, 100);
  if (entries.length === 0) {
    console.log("  No git history found.\n");
    return;
  }

  console.log(`  Analyzed ${entries.length} commits\n`);

  const trends: TrendAnalysis = {
    hotspots: detectHotspots(entries, {
      threshold: config.trends.hotspotThreshold,
      fixRatioThreshold: config.trends.bugFixRatioThreshold,
    }),
    decaySignals: detectDecay(entries),
    inconsistencies: detectInconsistencies(entries),
  };

  adapter.notify({ type: "trend-report", data: trends });
}

export function runIR(projectPath: string, filePath: string, layer: string): void {
  const config = loadConfig(projectPath);
  const code = readFileSync(filePath, "utf-8");
  const relPath = relative(projectPath, filePath);

  const entries = getGitLog(projectPath, 100);
  const trends: TrendAnalysis = {
    hotspots: detectHotspots(entries, {
      threshold: config.trends.hotspotThreshold,
      fixRatioThreshold: config.trends.bugFixRatioThreshold,
    }),
    decaySignals: detectDecay(entries),
    inconsistencies: detectInconsistencies(entries),
  };
  const health = computeHealthFromTrends(relPath, trends);

  const irLayer = (layer || "L1") as "L0" | "L1" | "L2" | "L3";
  const result = generateLayer(irLayer, {
    code,
    filePath: relPath,
    health: health.churn > 0 ? health : null,
  });

  console.log(result);
}

export function runBenchmark(projectPath: string): void {
  console.log("composto v0.1.0 — benchmark\n");

  const files = collectFiles(projectPath, [".ts", ".tsx", ".js", ".jsx"]);
  console.log(`  ${files.length} files\n`);

  const results = files.map((file) => {
    const code = readFileSync(file, "utf-8");
    const relPath = relative(projectPath, file);
    return benchmarkFile(code, relPath);
  });

  results.sort((a, b) => b.savedPercent - a.savedPercent);

  const header = "  File                                  Raw      L0      L1   Saved   Conf";
  const divider = "  " + "─".repeat(header.length - 2);

  console.log(header);
  console.log(divider);

  for (const r of results) {
    const file = r.file.length > 38 ? "…" + r.file.slice(-37) : r.file.padEnd(38);
    const raw = String(r.rawTokens).padStart(5);
    const l0 = String(r.irL0Tokens).padStart(7);
    const l1 = String(r.irL1Tokens).padStart(7);
    const saved = (r.savedPercent.toFixed(1) + "%").padStart(7);
    const conf = r.avgConfidence.toFixed(2).padStart(6);
    console.log(`  ${file} ${raw} ${l0} ${l1} ${saved} ${conf}`);
  }

  const summary = summarize(results);
  console.log(divider);
  const totalLabel = "TOTAL".padEnd(38);
  const totalRaw = String(summary.totalRaw).padStart(5);
  const totalL0 = String(summary.totalIRL0).padStart(7);
  const totalL1 = String(summary.totalIRL1).padStart(7);
  const totalSaved = (summary.totalSavedPercent.toFixed(1) + "%").padStart(7);
  const totalConf = summary.avgConfidence.toFixed(2).padStart(6);
  console.log(`  ${totalLabel} ${totalRaw} ${totalL0} ${totalL1} ${totalSaved} ${totalConf}`);

  const l0Percent = summary.totalRaw > 0 ? ((summary.totalRaw - summary.totalIRL0) / summary.totalRaw) * 100 : 0;

  console.log(`\n  L0 (structure map):  ${summary.totalRaw} → ${summary.totalIRL0} tokens (${l0Percent.toFixed(1)}% reduction)`);
  console.log(`  L1 (full IR):        ${summary.totalRaw} → ${summary.totalIRL1} tokens (${summary.totalSavedPercent.toFixed(1)}% reduction)`);
  console.log(`  Files analyzed: ${summary.fileCount}`);
  console.log(`  Avg confidence: ${summary.avgConfidence.toFixed(2)}`);
}
