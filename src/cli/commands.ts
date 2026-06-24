import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { relative, join, dirname } from "node:path";
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
import { benchmarkFile, summarize, type FileResult, type BenchmarkSummary } from "../benchmark/runner.js";
import { VERSION } from "../version.js";
import { runQualityBenchmark } from "../benchmark/quality.js";
import { packContext, type FileInput } from "../context/packer.js";
import { estimateTokens } from "../benchmark/tokenizer.js";
import { collectFiles } from "../utils/collectFiles.js";
import { dollarsFor, buildBadgeMarkdown, buildShareLine } from "./score-format.js";
import type { TrendAnalysis, Finding } from "../types.js";
import { MemoryAPI } from "../memory/api.js";

export function runScan(projectPath: string): void {
  const adapter = new CLIAdapter();
  const config = loadConfig(projectPath);

  console.log(`composto v${VERSION} — scanning...\n`);

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

  console.log(`composto v${VERSION} — trend analysis...\n`);

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

import { ALL_EXTENSIONS } from "../ir/extensions.js";
import { GENERIC_EXTENSIONS } from "../ir/generic.js";
import { analyzeCoverage, coverageWarning } from "../ir/coverage.js";
// Re-exported so existing importers (daemon, handoff) keep working.
export { ALL_EXTENSIONS };

export async function runBenchmark(projectPath: string): Promise<void> {
  console.log(`composto v${VERSION} — benchmark\n`);

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

  printSavingsCard(summary);
}

// Shareable savings card — the growth hook. The dollar figure is illustrative
// (assumption stated inline); the share line carries only the measured fact.
function printSavingsCard(summary: BenchmarkSummary): void {
  if (summary.totalRaw <= 0) return;
  const saved = summary.totalRaw - summary.totalIRL1;
  const pct = summary.totalSavedPercent.toFixed(1);

  // Claude Sonnet input pricing, $3 / Mtok. Scenario: 50 full-context loads/day.
  const SONNET_PER_MTOK = 3;
  const LOADS_PER_DAY = 50;
  const DAYS = 30;
  const rawCost = (summary.totalRaw / 1_000_000) * SONNET_PER_MTOK;
  const irCost = (summary.totalIRL1 / 1_000_000) * SONNET_PER_MTOK;
  const monthly = (rawCost - irCost) * LOADS_PER_DAY * DAYS;

  console.log("\n  ─────────────────────────────────────────────────────────────────────");
  console.log(`  💸 Every full-context load of this project: $${rawCost.toFixed(2)} raw → $${irCost.toFixed(2)} with Composto`);
  console.log(`     (Claude Sonnet input, $3/Mtok). At ${LOADS_PER_DAY} loads/day that is ~$${monthly.toFixed(0)}/month saved.`);
  console.log("\n  📋 Share your result:");
  console.log(`     Composto compressed my ${summary.fileCount}-file project ${pct}% (${summary.totalRaw.toLocaleString()} → ${summary.totalIRL1.toLocaleString()} tokens).`);
  console.log("     Try yours: npm i -g composto-ai && composto benchmark .");
  console.log("  ─────────────────────────────────────────────────────────────────────");
}

export async function runBenchmarkQuality(projectPath: string, filePath: string): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("  Error: ANTHROPIC_API_KEY environment variable is required.");
    process.exit(1);
  }

  const code = readFileSync(filePath, "utf-8");
  const relPath = relative(projectPath, filePath);

  console.log(`composto v${VERSION} — quality benchmark\n`);
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

// Current git HEAD short SHA, for the staleness stamp. "unknown" if not a repo.
function headSha(projectPath: string): string {
  try {
    const head = readFileSync(join(projectPath, ".git", "HEAD"), "utf8").trim();
    const ref = head.startsWith("ref:") ? head.slice(4).trim() : null;
    const full = ref
      ? readFileSync(join(projectPath, ".git", ref), "utf8").trim()
      : head;
    return full.slice(0, 8);
  } catch {
    return "unknown";
  }
}

/**
 * Build the project navigation map (compressed IR index of every file) and
 * write it to outPath. Self-describing header + a git-SHA staleness stamp so an
 * agent knows whether to trust it or run `composto reindex`. Returns size info.
 */
/**
 * Build the navigation map content in memory (no disk write). Shared by the
 * one-shot `reindex`/`init --with-index` path and the long-running `composto
 * start` daemon, which keeps the result warm and re-runs it on file changes.
 * When `staleHint` is "live", the header tells the agent the map is kept fresh
 * by a running daemon instead of pointing it at `composto reindex`.
 */
export async function buildProjectIndex(
  projectPath: string,
  budget: number,
  staleHint: "manual" | "live" = "manual",
): Promise<{ content: string; tokens: number; files: number; sha: string }> {
  const files = collectFiles(projectPath, [...ALL_EXTENSIONS, ...GENERIC_EXTENSIONS]);
  const fileInputs: FileInput[] = files.map(file => {
    const code = readFileSync(file, "utf-8");
    return { path: relative(projectPath, file), code, rawTokens: estimateTokens(code) };
  });

  const config = loadConfig(projectPath);
  let hotspots: { file: string }[] = [];
  try {
    hotspots = detectHotspots(getGitLog(projectPath, 100), {
      threshold: config.trends.hotspotThreshold,
      fixRatioThreshold: config.trends.bugFixRatioThreshold,
    });
  } catch { /* no git history — fine */ }

  const result = await packContext(fileInputs, { budget, hotspots: hotspots as never });
  const sha = headSha(projectPath);

  const freshness = staleHint === "live"
    ? `Kept fresh by a running \`composto start\` daemon — this map tracks your working tree.\n`
    : `If your git HEAD differs from ${sha}, this map may be stale: run \`composto reindex\`.\n`;

  // Be honest about what the map can't see — a partial map that looks complete
  // is worse than no map (see the C++ `ada` repo: 11 Python files, 0 .cpp).
  const warning = coverageWarning(analyzeCoverage(projectPath));

  const header =
    `# Composto navigation map  (generated at ${sha}, ${files.length} files, ~${result.totalTokens} tokens)\n\n` +
    `COMPRESSED MAP, not raw source. Use it to LOCATE the right files for a task,\n` +
    `then open those files directly instead of searching/reading broadly.\n` +
    freshness +
    warning;

  const body = result.entries
    .map(e => `\n## ${e.path}${e.layer === "L0" ? " (structure)" : ""}\n${e.ir}`)
    .join("\n");

  const content = header + body + "\n";
  return { content, tokens: estimateTokens(content), files: files.length, sha };
}

/**
 * Build the project navigation map (compressed IR index of every file) and
 * write it to outPath. Self-describing header + a git-SHA staleness stamp so an
 * agent knows whether to trust it or run `composto reindex`. Returns size info.
 */
export async function writeProjectIndex(
  projectPath: string,
  budget: number,
  outPath: string,
): Promise<{ tokens: number; files: number; sha: string }> {
  const r = await buildProjectIndex(projectPath, budget);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, r.content);
  return { tokens: r.tokens, files: r.files, sha: r.sha };
}

export async function runScore(projectPath: string, json?: boolean): Promise<void> {
  const files = collectFiles(projectPath, ALL_EXTENSIONS);
  const results: FileResult[] = [];
  for (const file of files) {
    const code = readFileSync(file, "utf-8");
    results.push(await benchmarkFile(code, relative(projectPath, file)));
  }
  const summary = summarize(results);

  // Health: riskiest files from git history (advisory color the model can't derive).
  const config = loadConfig(projectPath);
  let hotspots: Array<{ file: string; changesInLast30Commits: number; bugFixRatio: number }> = [];
  try {
    const entries = getGitLog(projectPath, 100);
    hotspots = detectHotspots(entries, {
      threshold: config.trends.hotspotThreshold,
      fixRatioThreshold: config.trends.bugFixRatioThreshold,
    });
  } catch {
    hotspots = [];
  }

  const rawDollars = dollarsFor(summary.totalRaw);
  const compostoDollars = dollarsFor(summary.totalIRL1);
  const topRisky = hotspots.slice(0, 3);

  if (json) {
    console.log(
      JSON.stringify({
        files: summary.fileCount,
        rawTokens: summary.totalRaw,
        compostoTokens: summary.totalIRL1,
        savedPercent: Number(summary.totalSavedPercent.toFixed(1)),
        rawCostUsd: Number(rawDollars.toFixed(4)),
        compostoCostUsd: Number(compostoDollars.toFixed(4)),
        riskyFiles: topRisky.map(h => ({ file: h.file, changes: h.changesInLast30Commits, fixRatio: Number(h.bugFixRatio.toFixed(2)) })),
        badge: buildBadgeMarkdown(summary.totalSavedPercent),
        share: buildShareLine(summary.fileCount, summary.totalRaw, summary.totalIRL1, summary.totalSavedPercent),
      }),
    );
    return;
  }

  const pct = summary.totalSavedPercent.toFixed(1);
  console.log(`\n  composto score — ${summary.fileCount} files\n`);
  console.log(`  AI context cost`);
  console.log(`    raw:       ${summary.totalRaw.toLocaleString()} tokens  ($${rawDollars.toFixed(2)}/full load)`);
  console.log(`    composto:  ${summary.totalIRL1.toLocaleString()} tokens  ($${compostoDollars.toFixed(2)}/full load)`);
  console.log(`    saved:     ${pct}%\n`);

  if (topRisky.length > 0) {
    console.log(`  Riskiest files an agent would stumble on (from git history)`);
    for (const h of topRisky) {
      console.log(`    ${h.file}  (${h.changesInLast30Commits} changes, ${Math.round(h.bugFixRatio * 100)}% fix-ratio)`);
    }
    console.log();
  }

  console.log(`  Badge (paste in your README):`);
  console.log(`    ${buildBadgeMarkdown(summary.totalSavedPercent)}\n`);
  console.log(`  Share:`);
  console.log(`    ${buildShareLine(summary.fileCount, summary.totalRaw, summary.totalIRL1, summary.totalSavedPercent)}\n`);
}

export async function runContext(
  projectPath: string,
  budget: number,
  target?: string,
  json?: boolean,
): Promise<void> {
  if (!json) {
    const header = target
      ? `composto v${VERSION} — context (target: ${target}, budget: ${budget} tokens)\n`
      : `composto v${VERSION} — context (budget: ${budget} tokens)\n`;
    console.log(header);
  }

  const files = collectFiles(projectPath, ALL_EXTENSIONS);
  if (!json) console.log(`  ${files.length} files\n`);

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

  // Machine-readable mode: clean stdout for piping into agents / scripts.
  // No decorative chrome, no indentation — just the structured context.
  if (json) {
    console.log(
      JSON.stringify({
        budget: result.budget,
        totalTokens: result.totalTokens,
        target: result.targetFile ?? null,
        coverage: result.targetMissing ? "none" : (result.targetMatchedBy ?? null),
        targetDowngraded: result.targetDowngraded ?? false,
        filesAtL3: result.filesAtL3,
        filesAtL1: result.filesAtL1,
        filesAtL0: result.filesAtL0,
        entries: result.entries.map(e => ({
          path: e.path,
          layer: e.layer,
          isTarget: e.isTarget ?? false,
          content: e.ir,
        })),
      }),
    );
    return;
  }

  if (target && !result.targetFile) {
    console.log(`  coverage: none — "${target}" not found in any file. Showing general context.`);
    console.log(`  Try a different name (symbol/file/key) or raise --budget.\n`);
  } else if (result.targetFile) {
    const conf =
      result.targetMatchedBy === "declaration" ? "high (exact symbol)" :
      result.targetMatchedBy === "filename" ? "medium (matched by filename — verify it's the intended file)" :
      "low (only found as a reference/string — the agent may need a more specific symbol)";
    console.log(`  Target: ${result.targetFile} (matched ${target})`);
    console.log(`  coverage: ${conf}`);
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

export async function runImpact(
  projectPath: string,
  file: string,
  opts: { intent?: string; level?: string } = {}
): Promise<void> {
  const dbPath = join(projectPath, ".composto", "memory.db");
  const api = new MemoryAPI({ dbPath, repoPath: projectPath });
  try {
    await api.bootstrapIfNeeded();
    const res = await api.blastradius({
      file,
      intent: opts.intent as any,
      level: opts.level as any,
    });

    if (res.status !== "ok") {
      console.log(`status:     ${res.status}`);
      if (res.reason) console.log(`reason:     ${res.reason}`);
      console.log(`verdict:    ${res.verdict}`);
      console.log(`confidence: ${res.confidence.toFixed(2)}`);
      return;
    }

    console.log(`verdict:    ${res.verdict}`);
    console.log(`score:      ${res.score.toFixed(2)}`);
    console.log(`confidence: ${res.confidence.toFixed(2)}`);
    console.log(`tazelik:    ${res.metadata.tazelik}`);
    console.log(`signals:`);
    for (const s of res.signals) {
      const bar = s.strength > 0 ? "■".repeat(Math.max(1, Math.round(s.strength * 10))) : "·";
      console.log(`  ${s.type.padEnd(18)} ${bar.padEnd(10)} strength=${s.strength.toFixed(2)} precision=${s.precision.toFixed(2)}`);
    }
  } finally {
    await api.close();
  }
}

export interface IndexOptions {
  since?: string;
}

export async function runIndex(projectPath: string, options: IndexOptions = {}): Promise<void> {
  const { resolveSinceBoundary } = await import("../memory/git.js");
  const dbPath = join(projectPath, ".composto", "memory.db");
  const api = new MemoryAPI({ dbPath, repoPath: projectPath });

  // Open a separate read-only connection for progress polling. WAL mode lets
  // this connection see batches the worker has already committed.
  const Database = (await import("better-sqlite3")).default;
  const probeDb = new Database(dbPath, { readonly: true, fileMustExist: false });

  const start = Date.now();
  let stopProgress = () => {};

  try {
    if (options.since) {
      const fromSha = resolveSinceBoundary(projectPath, options.since);
      console.log(`composto: indexing commits since ${options.since}${fromSha ? ` (boundary ${fromSha.slice(0, 8)})` : " (whole history — date predates first commit)"}...`);

      stopProgress = startProgressPoller(probeDb, start);
      await api.bootstrapFromBoundary(fromSha);
    } else {
      console.log("composto: bootstrapping memory index...");
      stopProgress = startProgressPoller(probeDb, start);
      await api.bootstrapIfNeeded();
    }

    stopProgress();
    const total = readIndexedTotal(probeDb);
    const elapsed = Date.now() - start;
    const rate = total > 0 && elapsed > 0 ? Math.round((total * 1000) / elapsed) : 0;
    console.log(`composto: index ready — ${total.toLocaleString()} commits in ${(elapsed / 1000).toFixed(1)}s (${rate.toLocaleString()} commits/sec)`);
  } finally {
    stopProgress();
    probeDb.close();
    await api.close();
  }
}

function readIndexedTotal(db: import("better-sqlite3").Database): number {
  try {
    const row = db
      .prepare("SELECT value FROM index_state WHERE key = 'indexed_commits_total'")
      .get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}

function startProgressPoller(db: import("better-sqlite3").Database, start: number): () => void {
  let last = -1;
  const interval = setInterval(() => {
    const total = readIndexedTotal(db);
    if (total === last) return;
    last = total;
    const elapsed = Date.now() - start;
    const rate = total > 0 && elapsed > 0 ? Math.round((total * 1000) / elapsed) : 0;
    process.stdout.write(`  indexed ${total.toLocaleString()} commits (${rate.toLocaleString()}/sec) [${(elapsed / 1000).toFixed(1)}s]\r`);
  }, 1500);
  return () => {
    clearInterval(interval);
    process.stdout.write("\n");
  };
}

import { collectStatus } from "../memory/status.js";

export async function runIndexStatus(projectPath: string): Promise<void> {
  const dbPath = join(projectPath, ".composto", "memory.db");
  const s = collectStatus(dbPath);

  console.log(`Composto Memory — ${projectPath}\n`);
  console.log("Index state");
  console.log(`  Schema version:           ${s.schemaVersion}`);
  console.log(`  Bootstrapped:             ${s.bootstrapped ? "yes" : "no"}`);
  console.log(`  Indexed through:          ${s.indexedCommitsThrough || "(none)"}`);
  console.log(`  Indexed commits total:    ${s.indexedCommitsTotal}`);
  console.log(`  Files w/ deep index:      ${s.filesWithDeepIndex}`);
  console.log();
  console.log("Calibration");
  if (s.calibrationLastRefreshedAt) {
    const dt = new Date(s.calibrationLastRefreshedAt * 1000).toISOString();
    console.log(`  Last refreshed:           ${dt}`);
  } else {
    console.log(`  Last refreshed:           (never)`);
  }
  console.log(`  Rows populated:           ${s.calibrationRows} / 5`);
  console.log();
  console.log("Storage");
  console.log(`  DB + WAL + SHM:           ${(s.storageBytes / 1024).toFixed(1)} KB`);
  console.log();
  console.log("Health");
  console.log(`  Integrity check:          ${s.integrityOk ? "OK" : "FAIL"}`);
}
