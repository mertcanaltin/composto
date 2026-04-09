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
