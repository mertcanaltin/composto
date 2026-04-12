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
import { benchmarkFile, summarize, type FileResult } from "../benchmark/runner.js";
import { runQualityBenchmark } from "../benchmark/quality.js";
import { packContext, type FileInput } from "../context/packer.js";
import { estimateTokens } from "../benchmark/tokenizer.js";
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

  console.log("composto v0.2.3 — scanning...\n");

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

  console.log("composto v0.2.3 — trend analysis...\n");

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

export async function runIR(projectPath: string, filePath: string, layer: string): Promise<void> {
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
  const result = await generateLayer(irLayer, {
    code,
    filePath: relPath,
    health: health.churn > 0 ? health : null,
  });

  console.log(result);
}

const ALL_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs"];

export async function runBenchmark(projectPath: string): Promise<void> {
  console.log("composto v0.2.3 — benchmark\n");

  const files = collectFiles(projectPath, ALL_EXTENSIONS);
  console.log(`  ${files.length} files\n`);

  const results: FileResult[] = [];
  for (const file of files) {
    const code = readFileSync(file, "utf-8");
    const relPath = relative(projectPath, file);
    results.push(await benchmarkFile(code, relPath));
  }

  results.sort((a, b) => b.savedPercent - a.savedPercent);

  const header = "  File                                  Raw      L0      L1   Saved   Eng";
  const divider = "  " + "─".repeat(header.length - 2);

  console.log(header);
  console.log(divider);

  for (const r of results) {
    const file = r.file.length > 38 ? "…" + r.file.slice(-37) : r.file.padEnd(38);
    const raw = String(r.rawTokens).padStart(5);
    const l0 = String(r.irL0Tokens).padStart(7);
    const l1 = String(r.irL1Tokens).padStart(7);
    const saved = (r.savedPercent.toFixed(1) + "%").padStart(7);
    const eng = r.engine.padStart(5);
    console.log(`  ${file} ${raw} ${l0} ${l1} ${saved} ${eng}`);
  }

  const summary = summarize(results);
  console.log(divider);
  const totalLabel = "TOTAL".padEnd(38);
  const totalRaw = String(summary.totalRaw).padStart(5);
  const totalL0 = String(summary.totalIRL0).padStart(7);
  const totalL1 = String(summary.totalIRL1).padStart(7);
  const totalSaved = (summary.totalSavedPercent.toFixed(1) + "%").padStart(7);
  console.log(`  ${totalLabel} ${totalRaw} ${totalL0} ${totalL1} ${totalSaved}`);

  const l0Percent = summary.totalRaw > 0 ? ((summary.totalRaw - summary.totalIRL0) / summary.totalRaw) * 100 : 0;

  console.log(`\n  L0 (structure map):  ${summary.totalRaw} → ${summary.totalIRL0} tokens (${l0Percent.toFixed(1)}% reduction)`);
  console.log(`  L1 (full IR):        ${summary.totalRaw} → ${summary.totalIRL1} tokens (${summary.totalSavedPercent.toFixed(1)}% reduction)`);
  console.log(`  Files analyzed: ${summary.fileCount}`);
  console.log(`  Engine: ${summary.astCount} AST, ${summary.fpCount} FP`);
}

export async function runBenchmarkQuality(projectPath: string, filePath: string): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("  Error: ANTHROPIC_API_KEY environment variable is required.");
    process.exit(1);
  }

  const code = readFileSync(filePath, "utf-8");
  const relPath = relative(projectPath, filePath);

  console.log("composto v0.2.3 — quality benchmark\n");
  console.log(`  File: ${relPath}\n`);
  console.log("  Sending to Claude Haiku...\n");

  const result = await runQualityBenchmark(code, relPath, apiKey);

  const col1 = 20;
  const col2 = 12;
  const col3 = 12;
  const line = "  " + "─".repeat(col1 + col2 + col3 + 4);

  console.log(line);
  console.log(`  ${"".padEnd(col1)} ${"Raw Code".padStart(col2)} ${"IR (L1)".padStart(col3)}`);
  console.log(line);
  console.log(`  ${"Input tokens".padEnd(col1)} ${String(result.raw.inputTokens).padStart(col2)} ${String(result.ir.inputTokens).padStart(col3)}`);
  console.log(`  ${"Output tokens".padEnd(col1)} ${String(result.raw.outputTokens).padStart(col2)} ${String(result.ir.outputTokens).padStart(col3)}`);
  console.log(`  ${"Total tokens".padEnd(col1)} ${String(result.raw.totalTokens).padStart(col2)} ${String(result.ir.totalTokens).padStart(col3)}`);
  console.log(`  ${"Response time".padEnd(col1)} ${(result.raw.responseTimeMs / 1000).toFixed(1).padStart(col2 - 1)}s ${(result.ir.responseTimeMs / 1000).toFixed(1).padStart(col3 - 1)}s`);
  console.log(`  ${"Saved".padEnd(col1)} ${"—".padStart(col2)} ${(result.savedPercent.toFixed(1) + "%").padStart(col3)}`);
  console.log(line);

  console.log(`\n  --- Raw Code Response ---\n${result.raw.response}\n`);
  console.log(`  --- IR Response ---\n${result.ir.response}\n`);

  if (result.savedPercent > 0) {
    console.log(`  Verdict: ${result.savedPercent.toFixed(1)}% fewer tokens with IR.`);
  }
}

export async function runContext(projectPath: string, budget: number, target?: string): Promise<void> {
  const header = target
    ? `composto v0.2.3 — context (target: ${target}, budget: ${budget} tokens)\n`
    : `composto v0.2.3 — context (budget: ${budget} tokens)\n`;
  console.log(header);

  const files = collectFiles(projectPath, ALL_EXTENSIONS);
  console.log(`  ${files.length} files\n`);

  const config = loadConfig(projectPath);
  const entries = getGitLog(projectPath, 100);
  const hotspots = detectHotspots(entries, {
    threshold: config.trends.hotspotThreshold,
    fixRatioThreshold: config.trends.bugFixRatioThreshold,
  });

  const fileInputs: FileInput[] = files.map(file => {
    const code = readFileSync(file, "utf-8");
    const relPath = relative(projectPath, file);
    return { path: relPath, code, rawTokens: estimateTokens(code) };
  });

  const result = await packContext(fileInputs, { budget, hotspots, target });

  if (target && !result.targetFile) {
    console.log(`  Warning: symbol "${target}" not found in any file. Showing general context.\n`);
  } else if (result.targetFile) {
    console.log(`  Target: ${result.targetFile} (contains ${target})`);
    if (result.targetDowngraded) {
      console.log(`  Note: target file too large for raw mode — using L1 IR instead. Increase --budget for L3.`);
    }
    console.log();
  }

  const l3Entries = result.entries.filter(e => e.layer === "L3");
  const l1Entries = result.entries.filter(e => e.layer === "L1");
  const l0Entries = result.entries.filter(e => e.layer === "L0");

  if (l3Entries.length > 0) {
    console.log("  == L3 (raw — target file) ==\n");
    for (const entry of l3Entries) {
      console.log(`  [target] ${entry.path}`);
      for (const line of entry.ir.split("\n")) {
        console.log(`    ${line}`);
      }
      console.log();
    }
  }

  if (l1Entries.length > 0) {
    console.log("  == L1 (detailed) ==\n");
    for (const entry of l1Entries) {
      const label = entry.isTarget ? "target" : hotspots.some(h => h.file === entry.path) ? "hotspot" : "detail";
      console.log(`  [${label}] ${entry.path}`);
      for (const line of entry.ir.split("\n")) {
        console.log(`    ${line}`);
      }
      console.log();
    }
  }

  if (l0Entries.length > 0) {
    console.log("  == L0 (structure) ==\n");
    for (const entry of l0Entries) {
      for (const line of entry.ir.split("\n")) {
        console.log(`    ${line}`);
      }
    }
    console.log();
  }

  const parts = [];
  if (result.filesAtL3 > 0) parts.push(`${result.filesAtL3} at L3 (raw)`);
  if (result.filesAtL1 > 0) parts.push(`${result.filesAtL1} at L1`);
  if (result.filesAtL0 > 0) parts.push(`${result.filesAtL0} at L0`);

  console.log(`  Budget: ${result.totalTokens}/${result.budget} tokens`);
  console.log(`  Files: ${parts.join(", ")}`);
}
