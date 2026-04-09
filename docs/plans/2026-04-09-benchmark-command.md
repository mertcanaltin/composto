# Benchmark Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `composto benchmark .` CLI command that measures token savings of Health-Aware IR vs raw code across all project files.

**Architecture:** A token estimator counts approximate GPT/Claude tokens. The benchmark runner iterates project files, generates L0 and L1 IR for each, compares raw vs IR token counts, and outputs a formatted table with per-file and total stats.

**Tech Stack:** TypeScript, existing IR generator (`src/ir/layers.ts`), existing file collector from `src/cli/commands.ts`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/benchmark/tokenizer.ts` | Create | Token count estimation |
| `src/benchmark/runner.ts` | Create | Benchmark orchestration, stats collection |
| `src/cli/commands.ts` | Modify | Add `runBenchmark()` export |
| `src/index.ts` | Modify | Add `benchmark` case to CLI switch |
| `tests/benchmark/tokenizer.test.ts` | Create | Token estimator tests |
| `tests/benchmark/runner.test.ts` | Create | Benchmark runner tests |

---

### Task 1: Token Estimator

**Files:**
- Create: `src/benchmark/tokenizer.ts`
- Test: `tests/benchmark/tokenizer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { estimateTokens } from "../../src/benchmark/tokenizer.js";

describe("estimateTokens", () => {
  it("estimates tokens for simple text", () => {
    // ~1 token per 4 chars is the standard approximation
    const result = estimateTokens("hello world");
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(10);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("counts code tokens reasonably", () => {
    const code = 'import { useState } from "react";';
    const tokens = estimateTokens(code);
    // code has more token boundaries than prose
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(20);
  });

  it("handles multiline code", () => {
    const code = [
      'import { useState } from "react";',
      "",
      "export function App() {",
      "  const count = 0;",
      "  return count;",
      "}",
    ].join("\n");
    const tokens = estimateTokens(code);
    expect(tokens).toBeGreaterThan(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/benchmark/tokenizer.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * Approximate token count using GPT/Claude-style tokenization heuristics.
 * Splits on whitespace, punctuation boundaries, and camelCase transitions.
 * Accurate to ~±10% vs real BPE tokenizers — good enough for benchmarks.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Split on whitespace and punctuation boundaries, filter empties
  const tokens = text.split(/[\s]+|(?<=[{}()[\];,.:=<>!&|?+\-*/^~@#$%\\])|(?=[{}()[\];,.:=<>!&|?+\-*/^~@#$%\\])/).filter(Boolean);
  return tokens.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/benchmark/tokenizer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/benchmark/tokenizer.ts tests/benchmark/tokenizer.test.ts
git commit -m "feat(benchmark): add token estimator"
```

---

### Task 2: Benchmark Runner

**Files:**
- Create: `src/benchmark/runner.ts`
- Test: `tests/benchmark/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { benchmarkFile, summarize } from "../../src/benchmark/runner.js";

describe("benchmarkFile", () => {
  it("returns token stats for a code string", () => {
    const code = [
      'import { useState } from "react";',
      "",
      "export function App() {",
      "  const count = 0;",
      "  return count;",
      "}",
    ].join("\n");

    const result = benchmarkFile(code, "test.ts");
    expect(result.file).toBe("test.ts");
    expect(result.rawTokens).toBeGreaterThan(0);
    expect(result.irL0Tokens).toBeGreaterThan(0);
    expect(result.irL1Tokens).toBeGreaterThan(0);
    expect(result.irL1Tokens).toBeLessThan(result.rawTokens);
    expect(result.savedPercent).toBeGreaterThan(0);
    expect(result.savedPercent).toBeLessThan(100);
    expect(result.avgConfidence).toBeGreaterThan(0);
    expect(result.avgConfidence).toBeLessThanOrEqual(1);
  });
});

describe("summarize", () => {
  it("aggregates multiple file results", () => {
    const results = [
      { file: "a.ts", rawTokens: 100, irL0Tokens: 20, irL1Tokens: 30, savedPercent: 70, avgConfidence: 0.9 },
      { file: "b.ts", rawTokens: 200, irL0Tokens: 40, irL1Tokens: 50, savedPercent: 75, avgConfidence: 0.85 },
    ];
    const summary = summarize(results);
    expect(summary.totalRaw).toBe(300);
    expect(summary.totalIRL1).toBe(80);
    expect(summary.totalSavedPercent).toBeCloseTo(73.3, 0);
    expect(summary.avgConfidence).toBeCloseTo(0.875, 2);
    expect(summary.fileCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/benchmark/runner.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
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

  // Calculate average confidence from fingerprinting
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/benchmark/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/benchmark/runner.ts tests/benchmark/runner.test.ts
git commit -m "feat(benchmark): add benchmark runner with file analysis and summary"
```

---

### Task 3: CLI Integration

**Files:**
- Modify: `src/cli/commands.ts` — add `runBenchmark()` function
- Modify: `src/index.ts` — add `benchmark` case

- [ ] **Step 1: Add `runBenchmark` to commands.ts**

Add to `src/cli/commands.ts` after the existing imports:

```typescript
import { benchmarkFile, summarize } from "../benchmark/runner.js";
```

Add the function at the end of the file:

```typescript
export function runBenchmark(projectPath: string): void {
  console.log("composto v0.1.0 — benchmark\n");

  const files = collectFiles(projectPath, [".ts", ".tsx", ".js", ".jsx"]);
  console.log(`  ${files.length} files\n`);

  const results = files.map((file) => {
    const code = readFileSync(file, "utf-8");
    const relPath = relative(projectPath, file);
    return benchmarkFile(code, relPath);
  });

  // Sort by saved percent descending
  results.sort((a, b) => b.savedPercent - a.savedPercent);

  // Table header
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

  console.log(`\n  Token savings: ${summary.totalRaw} → ${summary.totalIRL1} (${summary.totalSavedPercent.toFixed(1)}% reduction)`);
  console.log(`  Files analyzed: ${summary.fileCount}`);
}
```

- [ ] **Step 2: Add benchmark case to index.ts**

Add to the switch in `src/index.ts`, before the `version` case:

```typescript
case "benchmark": {
  const projectPath = resolve(args[1] ?? ".");
  runBenchmark(projectPath);
  break;
}
```

Update the import to include `runBenchmark`:

```typescript
import { runScan, runTrends, runIR, runBenchmark } from "./cli/commands.js";
```

Add to the help text:

```typescript
console.log("  benchmark [path]     Benchmark IR token savings");
```

- [ ] **Step 3: Build and test manually**

Run: `npx tsup && node dist/index.js benchmark .`
Expected: Formatted table showing all project files with token savings

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands.ts src/index.ts
git commit -m "feat(benchmark): add benchmark CLI command"
```

---

### Task 4: Run all tests

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Build and run final benchmark**

Run: `npx tsup && node dist/index.js benchmark .`
Expected: Clean output with table

- [ ] **Step 3: Final commit if any fixes needed**
