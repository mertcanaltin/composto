import { estimateTokens } from "./tokenizer.js";
import { generateLayer } from "../ir/layers.js";
import { fingerprintLine } from "../ir/fingerprint.js";

export interface FileResult {
  file: string;
  rawTokens: number;
  irL0Tokens: number;
  irL1Tokens: number;
  savedPercent: number;
  avgConfidence: number;
}

export interface BenchmarkSummary {
  fileCount: number;
  totalRaw: number;
  totalIRL0: number;
  totalIRL1: number;
  totalSavedPercent: number;
  avgConfidence: number;
}

export function benchmarkFile(code: string, filePath: string): FileResult {
  const rawTokens = estimateTokens(code);

  const irL0 = generateLayer("L0", { code, filePath, health: null });
  const irL1 = generateLayer("L1", { code, filePath, health: null });
  const irL0Tokens = estimateTokens(irL0);
  const irL1Tokens = estimateTokens(irL1);

  const lines = code.split("\n");
  let totalConf = 0;
  let count = 0;
  for (const line of lines) {
    const result = fingerprintLine(line);
    if (result.ir !== "") {
      totalConf += result.confidence;
      count++;
    }
  }

  const savedPercent = rawTokens > 0 ? ((rawTokens - irL1Tokens) / rawTokens) * 100 : 0;
  const avgConfidence = count > 0 ? totalConf / count : 0;

  return { file: filePath, rawTokens, irL0Tokens, irL1Tokens, savedPercent, avgConfidence };
}

export function summarize(results: FileResult[]): BenchmarkSummary {
  const totalRaw = results.reduce((s, r) => s + r.rawTokens, 0);
  const totalIRL0 = results.reduce((s, r) => s + r.irL0Tokens, 0);
  const totalIRL1 = results.reduce((s, r) => s + r.irL1Tokens, 0);
  const totalSavedPercent = totalRaw > 0 ? ((totalRaw - totalIRL1) / totalRaw) * 100 : 0;
  const avgConfidence = results.length > 0
    ? results.reduce((s, r) => s + r.avgConfidence, 0) / results.length
    : 0;

  return { fileCount: results.length, totalRaw, totalIRL0, totalIRL1, totalSavedPercent, avgConfidence };
}
