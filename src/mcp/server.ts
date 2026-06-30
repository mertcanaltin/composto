import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, relative, join, dirname } from "node:path";
import { generateLayer } from "../ir/layers.js";
import { computeHealthFromTrends } from "../ir/health.js";
import { getGitLog } from "../trends/git-log-parser.js";
import { detectHotspots } from "../trends/hotspot.js";
import { detectDecay } from "../trends/decay.js";
import { detectInconsistencies } from "../trends/inconsistency.js";
import { loadConfig } from "../config/loader.js";
import { benchmarkFile, summarize } from "../benchmark/runner.js";
import { packContext, type FileInput } from "../context/packer.js";
import { estimateTokens } from "../benchmark/tokenizer.js";
import { collectFiles } from "../utils/collectFiles.js";
import type { TrendAnalysis } from "../types.js";

const ALL_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs"];

const PKG_VERSION = (() => {
  try {
    const pkgPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "package.json",
    );
    return (JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
})();

const server = new McpServer({
  name: "composto",
  version: PKG_VERSION,
});

// Tool 1: composto_ir — Generate IR for a file
server.tool(
  "composto_ir",
  "Compressed AST-based IR for a file. ~89% fewer tokens than raw read.",
  {
    file: z.string().optional().describe("Path to the source file"),
    // Some clients send `path` instead of `file`; accept both for compatibility.
    path: z.string().optional().describe("Alias for file path"),
    layer: z.enum(["L0", "L1", "L2", "L3"]).default("L1").describe("L0=structure only, L1=full IR (default), L2=delta context, L3=raw source"),
  },
  async ({ file, path, layer }) => {
    const inputFile = file ?? path;
    if (!inputFile) {
      return {
        content: [{
          type: "text" as const,
          text: "composto_ir requires a file path. Provide `file` (preferred) or `path`.",
        }],
      };
    }
    const filePath = resolve(inputFile);
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
  "Per-file token-savings benchmark across a directory.",
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
  "Pack code into a token budget; target raw, neighbors as IR.",
  {
    path: z.string().default(".").describe("Directory to pack"),
    budget: z.number().default(4000).describe("Maximum tokens to use"),
    target: z.string().optional().describe("Target symbol (function/class/variable name). Its file will be included as raw code for implementation tasks."),
  },
  async ({ path, budget, target }) => {
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
    const result = await packContext(fileInputs, { budget, hotspots, target });
    const lines = [`Composto Context — ${result.totalTokens}/${result.budget} tokens`];
    if (target && result.targetFile) lines.push(`Target: ${target} in ${result.targetFile}`);
    lines.push("");
    const l3 = result.entries.filter(e => e.layer === "L3");
    const l1 = result.entries.filter(e => e.layer === "L1");
    const l0 = result.entries.filter(e => e.layer === "L0");
    if (l3.length > 0) {
      lines.push("== L3 (raw — target file) ==\n");
      for (const entry of l3) {
        lines.push(`[target] ${entry.path}`);
        lines.push(entry.ir);
        lines.push("");
      }
    }
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
    const parts: string[] = [];
    if (result.filesAtL3 > 0) parts.push(`${result.filesAtL3} at L3`);
    if (result.filesAtL1 > 0) parts.push(`${result.filesAtL1} at L1`);
    if (result.filesAtL0 > 0) parts.push(`${result.filesAtL0} at L0`);
    lines.push(`\nFiles: ${parts.join(", ")}`);
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
