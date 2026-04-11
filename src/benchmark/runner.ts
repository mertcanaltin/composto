import { estimateTokens } from "./tokenizer.js";
import { generateLayer } from "../ir/layers.js";
import { astWalkIR } from "../ir/ast-walker.js";

export interface FileResult {
  file: string;
  rawTokens: number;
  irL0Tokens: number;
  irL1Tokens: number;
  savedPercent: number;
  engine: "AST" | "FP";
}

export interface BenchmarkSummary {
  fileCount: number;
  totalRaw: number;
  totalIRL0: number;
  totalIRL1: number;
  totalSavedPercent: number;
  astCount: number;
  fpCount: number;
}

export async function benchmarkFile(code: string, filePath: string): Promise<FileResult> {
  const rawTokens = estimateTokens(code);

  const irL0 = await generateLayer("L0", { code, filePath, health: null });
  const irL1 = await generateLayer("L1", { code, filePath, health: null });
  const irL0Tokens = estimateTokens(irL0);
  const irL1Tokens = estimateTokens(irL1);

  const astResult = await astWalkIR(code, filePath);
  const engine: "AST" | "FP" = astResult !== null ? "AST" : "FP";

  const savedPercent = rawTokens > 0 ? ((rawTokens - irL1Tokens) / rawTokens) * 100 : 0;

  return { file: filePath, rawTokens, irL0Tokens, irL1Tokens, savedPercent, engine };
}

export function summarize(results: FileResult[]): BenchmarkSummary {
  const totalRaw = results.reduce((s, r) => s + r.rawTokens, 0);
  const totalIRL0 = results.reduce((s, r) => s + r.irL0Tokens, 0);
  const totalIRL1 = results.reduce((s, r) => s + r.irL1Tokens, 0);
  const totalSavedPercent = totalRaw > 0 ? ((totalRaw - totalIRL1) / totalRaw) * 100 : 0;
  const astCount = results.filter(r => r.engine === "AST").length;
  const fpCount = results.filter(r => r.engine === "FP").length;

  return { fileCount: results.length, totalRaw, totalIRL0, totalIRL1, totalSavedPercent, astCount, fpCount };
}
