import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { generateLayer } from "../ir/layers.js";
import { computeHealthFromTrends } from "../ir/health.js";
import { getGitLog } from "../trends/git-log-parser.js";
import { detectHotspots } from "../trends/hotspot.js";
import { detectDecay } from "../trends/decay.js";
import { detectInconsistencies } from "../trends/inconsistency.js";
import { loadConfig } from "../config/loader.js";
import { benchmarkFile, summarize } from "../benchmark/runner.js";
import { packContext, type FileInput } from "../context/packer.js";
import { runDetector } from "../watcher/detector.js";
import { estimateTokens } from "../benchmark/tokenizer.js";
import type { TrendAnalysis } from "../types.js";

const ALL_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs"];

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

const server = new McpServer({
  name: "composto",
  version: "0.1.2",
});

// Tool 1: composto_ir — Generate IR for a file
server.tool(
  "composto_ir",
  "Generate compressed IR (Intermediate Representation) for a source file. Uses AST parsing to keep function signatures, control flow, and dependencies while dropping 89% of noise tokens. Use this instead of reading raw files when you need to understand what a file does.",
  {
    file: z.string().describe("Path to the source file"),
    layer: z.enum(["L0", "L1", "L2", "L3"]).default("L1").describe("L0=structure only, L1=full IR (default), L2=delta context, L3=raw source"),
  },
  async ({ file, layer }) => {
    const filePath = resolve(file);
    const code = readFileSync(filePath, "utf-8");
    const projectPath = resolve(".");
    const relPath = relative(projectPath, filePath);
    const config = loadConfig(projectPath);
    const entries = getGitLog(projectPath, 100);
    const trends: TrendAnalysis = {
      hotspots: detectHotspots(entries, { threshold: config.trends.hotspotThreshold, fixRatioThreshold: config.trends.bugFixRatioThreshold }),
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
    const rawTokens = estimateTokens(code);
    const irTokens = estimateTokens(result);
    const saved = rawTokens > 0 ? ((rawTokens - irTokens) / rawTokens * 100).toFixed(1) : "0";
    return {
      content: [{ type: "text" as const, text: `[${relPath} | ${irLayer} | ${irTokens} tokens, ${saved}% saved]\n\n${result}` }],
    };
  }
);

// Tool 2: composto_benchmark — Benchmark token savings
server.tool(
  "composto_benchmark",
  "Benchmark how much Composto saves across a directory. Shows per-file token savings comparing raw code vs compressed IR.",
  {
    path: z.string().default(".").describe("Directory to benchmark"),
  },
  async ({ path }) => {
    const projectPath = resolve(path);
    const files = collectFiles(projectPath, ALL_EXTENSIONS);
    const results = [];
    for (const file of files) {
      const code = readFileSync(file, "utf-8");
      const relPath = relative(projectPath, file);
      results.push(await benchmarkFile(code, relPath));
    }
    results.sort((a, b) => b.savedPercent - a.savedPercent);
    const summary = summarize(results);
    const lines = [`Composto Benchmark — ${files.length} files\n`];
    lines.push("File | Raw | L1 | Saved | Engine");
    lines.push("-----|-----|-----|-------|-------");
    for (const r of results) {
      lines.push(`${r.file} | ${r.rawTokens} | ${r.irL1Tokens} | ${r.savedPercent.toFixed(1)}% | ${r.engine}`);
    }
    lines.push("");
    lines.push(`Total: ${summary.totalRaw} → ${summary.totalIRL1} tokens (${summary.totalSavedPercent.toFixed(1)}% saved)`);
    lines.push(`Engine: ${summary.astCount} AST, ${summary.fpCount} FP`);
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// Tool 3: composto_context — Smart context within token budget
server.tool(
  "composto_context",
  "Pack maximum code context into a token budget. Hotspot files get detailed IR (L1), remaining files get structure only (L0). Use this when you need to understand a large codebase without exceeding context limits.",
  {
    path: z.string().default(".").describe("Directory to pack"),
    budget: z.number().default(4000).describe("Maximum tokens to use"),
  },
  async ({ path, budget }) => {
    const projectPath = resolve(path);
    const files = collectFiles(projectPath, ALL_EXTENSIONS);
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
    const result = await packContext(fileInputs, { budget, hotspots });
    const lines = [`Composto Context — ${result.totalTokens}/${result.budget} tokens\n`];
    const l1 = result.entries.filter(e => e.layer === "L1");
    const l0 = result.entries.filter(e => e.layer === "L0");
    if (l1.length > 0) {
      lines.push("== L1 (detailed) ==\n");
      for (const entry of l1) {
        const label = hotspots.some(h => h.file === entry.path) ? "hotspot" : "detail";
        lines.push(`[${label}] ${entry.path}`);
        lines.push(entry.ir);
        lines.push("");
      }
    }
    if (l0.length > 0) {
      lines.push("== L0 (structure) ==\n");
      for (const entry of l0) {
        lines.push(entry.ir);
      }
    }
    lines.push(`\nFiles: ${result.filesAtL1} at L1, ${result.filesAtL0} at L0`);
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// Tool 4: composto_scan — Scan for security issues
server.tool(
  "composto_scan",
  "Scan codebase for security issues (hardcoded secrets, API keys) and debug artifacts (console.log). Zero token cost — pure local analysis.",
  {
    path: z.string().default(".").describe("Directory to scan"),
  },
  async ({ path }) => {
    const projectPath = resolve(path);
    const config = loadConfig(projectPath);
    const files = collectFiles(projectPath, [".ts", ".tsx", ".js", ".jsx"]);
    const allFindings = [];
    for (const file of files) {
      const code = readFileSync(file, "utf-8");
      const relPath = relative(projectPath, file);
      const findings = runDetector(code, relPath, config.watchers);
      allFindings.push(...findings);
    }
    if (allFindings.length === 0) {
      return { content: [{ type: "text" as const, text: "No issues found." }] };
    }
    const lines = [`Found ${allFindings.length} issues:\n`];
    for (const f of allFindings) {
      const icon = f.severity === "critical" ? "!!" : f.severity === "warning" ? " !" : "  ";
      const loc = f.line ? `:${f.line}` : "";
      lines.push(`${icon} [${f.severity.toUpperCase()}] ${f.file}${loc}`);
      lines.push(`   ${f.message}`);
    }
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[composto-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
