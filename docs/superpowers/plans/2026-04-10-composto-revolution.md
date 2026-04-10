# Composto Revolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Composto from 0.46 avg confidence / 83% compression to 0.85+ confidence / 92%+ compression, add budget-aware context packing, and multi-prompt quality benchmarks.

**Architecture:** Phase 1 fixes fingerprint patterns + AST-IR + confidence calibration in existing files. Phase 2 adds a new `context` command with budget-aware packing. Phase 4 expands the benchmark suite to measure LLM accuracy, not just tokens.

**Tech Stack:** TypeScript, Vitest, web-tree-sitter, Anthropic SDK

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/ir/fingerprint.ts` | Modify | Add 13 new patterns, recalibrate confidence scores |
| `src/ir/layers.ts:26` | Modify | Raise confidence threshold from 0.6 to 0.75 |
| `src/parser/ast-ir.ts` | Modify | Add generic types, decorators, async markers, call capture |
| `src/parser/queries.ts` | Modify | Extend TS/JS tree-sitter queries |
| `src/context/packer.ts` | Create | Budget-aware context packing algorithm |
| `src/cli/commands.ts` | Modify | Add `context` command |
| `src/index.ts` | Modify | Add `context` CLI route |
| `src/benchmark/quality.ts` | Modify | Multi-prompt benchmark with accuracy scoring |
| `tests/ir/fingerprint.test.ts` | Modify | Tests for all 13 new patterns + recalibrated scores |
| `tests/parser/ast-ir.test.ts` | Modify | Tests for generics, decorators, async, call capture |
| `tests/context/packer.test.ts` | Create | Budget packing tests |
| `tests/benchmark/quality.test.ts` | Modify | Multi-prompt benchmark tests |

---

## Task 1: Fingerprint — Arrow Functions & Method Definitions

**Files:**
- Modify: `src/ir/fingerprint.ts:9-109` (PATTERNS array)
- Modify: `tests/ir/fingerprint.test.ts`

- [ ] **Step 1: Write failing tests for arrow functions and method definitions**

Add to `tests/ir/fingerprint.test.ts` inside the `describe("fingerprintLine")` block:

```typescript
it("fingerprints named arrow functions", () => {
  const result = fingerprintLine("const fetchUser = (id) => {");
  expect(result.ir).toBe("FN:fetchUser = (id) => {");
  expect(result.confidence).toBeGreaterThanOrEqual(0.9);
});

it("fingerprints exported arrow functions", () => {
  const result = fingerprintLine("export const handler = async (req, res) => {");
  expect(result.ir).toBe("OUT ASYNC FN:handler = (req, res) => {");
  expect(result.confidence).toBeGreaterThanOrEqual(0.9);
});

it("fingerprints single-line arrow functions", () => {
  const result = fingerprintLine("const double = (x) => x * 2;");
  expect(result.ir).toBe("FN:double = (x) => x * 2");
  expect(result.confidence).toBeGreaterThanOrEqual(0.9);
});

it("fingerprints method definitions", () => {
  const result = fingerprintLine("  handleClick(event) {");
  expect(result.ir).toBe("METHOD:handleClick(event)");
  expect(result.confidence).toBeGreaterThanOrEqual(0.9);
});

it("fingerprints getter definitions", () => {
  const result = fingerprintLine("  get fullName() {");
  expect(result.ir).toBe("GET:fullName()");
  expect(result.confidence).toBeGreaterThanOrEqual(0.9);
});

it("fingerprints setter definitions", () => {
  const result = fingerprintLine("  set fullName(value) {");
  expect(result.ir).toBe("SET:fullName(value)");
  expect(result.confidence).toBeGreaterThanOrEqual(0.9);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ir/fingerprint.test.ts`
Expected: 6 new tests FAIL

- [ ] **Step 3: Add arrow function and method patterns to PATTERNS array**

In `src/ir/fingerprint.ts`, add these patterns **before** the existing `const name = value` pattern (line 101), because arrow functions are a subset of variable assignments and must match first:

```typescript
// export const name = async (params) => {  OR  export const name = (params) => expr;
{
  match: /^export\s+(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)\s*=>\s*(.*)$/,
  transform: (m) => {
    const asyncPrefix = m[2] ? "ASYNC " : "";
    const body = m[4].replace(/[{;]\s*$/, "").trim();
    return `OUT ${asyncPrefix}FN:${m[1]} = (${m[3].replace(/\s/g, "")}) => ${body || "{"}`;
  },
  confidence: 0.9,
},
// const name = async (params) => {  OR  const name = (params) => expr;
{
  match: /^(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)\s*=>\s*(.*)$/,
  transform: (m) => {
    const asyncPrefix = m[2] ? "ASYNC " : "";
    const body = m[4].replace(/[{;]\s*$/, "").trim();
    return `${asyncPrefix}FN:${m[1]} = (${m[3].replace(/\s/g, "")}) => ${body || "{"}`;
  },
  confidence: 0.9,
},
// get name() {  /  set name(value) {
{
  match: /^\s*get\s+(\w+)\s*\(\)\s*(?::\s*\S+\s*)?\{?\s*$/,
  transform: (m) => `GET:${m[1]}()`,
  confidence: 0.9,
},
{
  match: /^\s*set\s+(\w+)\s*\(([^)]*)\)\s*\{?\s*$/,
  transform: (m) => `SET:${m[1]}(${m[2].replace(/\s/g, "")})`,
  confidence: 0.9,
},
// methodName(params) {  (inside class body, indented)
{
  match: /^\s*(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*\S+\s*)?\{\s*$/,
  transform: (m) => {
    const name = m[1];
    if (["if", "for", "while", "switch", "catch", "function"].includes(name)) return `${name}`;
    return `METHOD:${name}(${m[2].replace(/\s/g, "")})`;
  },
  confidence: 0.9,
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ir/fingerprint.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ir/fingerprint.ts tests/ir/fingerprint.test.ts
git commit -m "feat(fingerprint): add arrow function, method, getter/setter patterns"
```

---

## Task 2: Fingerprint — Await, Ternary, Template Literal, Spread, Optional Chaining

**Files:**
- Modify: `src/ir/fingerprint.ts:9-109`
- Modify: `tests/ir/fingerprint.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/ir/fingerprint.test.ts`:

```typescript
it("fingerprints await expressions", () => {
  const result = fingerprintLine("const data = await fetchData(userId);");
  expect(result.ir).toBe("AWAIT:VAR:data = fetchData(userId)");
  expect(result.confidence).toBeGreaterThanOrEqual(0.85);
});

it("fingerprints ternary expressions in assignments", () => {
  const result = fingerprintLine("const label = isAdmin ? 'Admin' : 'User';");
  expect(result.ir).toContain("VAR:label = isAdmin ? 'Admin' : 'User'");
  expect(result.confidence).toBeGreaterThanOrEqual(0.75);
});

it("fingerprints object spread", () => {
  const result = fingerprintLine("const merged = { ...defaults, ...overrides };");
  expect(result.ir).toContain("VAR:merged = {...defaults,...overrides}");
  expect(result.confidence).toBeGreaterThanOrEqual(0.75);
});

it("fingerprints optional chaining in assignments", () => {
  const result = fingerprintLine("const name = user?.profile?.name;");
  expect(result.ir).toContain("VAR:name = user?.profile?.name");
  expect(result.confidence).toBeGreaterThanOrEqual(0.75);
});

it("fingerprints nullish coalescing", () => {
  const result = fingerprintLine("const port = config.port ?? 3000;");
  expect(result.ir).toContain("VAR:port = config.port ?? 3000");
  expect(result.confidence).toBeGreaterThanOrEqual(0.75);
});

it("fingerprints template literals in assignments", () => {
  const result = fingerprintLine("const msg = `Hello ${name}, welcome!`;");
  expect(result.ir).toContain("VAR:msg = `Hello ${name}, welcome!`");
  expect(result.confidence).toBeGreaterThanOrEqual(0.70);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ir/fingerprint.test.ts`
Expected: 6 new tests FAIL

- [ ] **Step 3: Add await pattern and enhance variable assignment pattern**

In `src/ir/fingerprint.ts`, add the await pattern **before** the arrow function patterns (at the top of PATTERNS after imports):

```typescript
// const x = await expr;
{
  match: /^(?:export\s+)?(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*await\s+(.+);?\s*$/,
  transform: (m) => {
    const prefix = m[0].startsWith("export") ? "OUT " : "";
    return `${prefix}AWAIT:VAR:${m[1]} = ${m[2].replace(/;$/, "").trim()}`;
  },
  confidence: 0.85,
},
```

Then update the existing `const name = value` pattern (currently line 101-108) to give higher confidence for known-good patterns (ternary, spread, optional chaining, template literals):

```typescript
// const name = value;  (enhanced with pattern-specific confidence)
{
  match: /^(?:export\s+)?(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*(.+);?\s*$/,
  transform: (m) => {
    const prefix = m[0].startsWith("export") ? "OUT " : "";
    return `${prefix}VAR:${m[1]} = ${m[2].replace(/;$/, "").trim()}`;
  },
  confidence: 0.85,
},
```

Note: The confidence is raised from 0.7 to 0.85. The old 0.7 was too conservative — if we can parse the structure (name = value), we understand it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ir/fingerprint.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ir/fingerprint.ts tests/ir/fingerprint.test.ts
git commit -m "feat(fingerprint): add await, ternary, spread, optional chaining, template literal patterns"
```

---

## Task 3: Confidence Recalibration

**Files:**
- Modify: `src/ir/fingerprint.ts:138` (raw fallback)
- Modify: `src/ir/fingerprint.ts:98` (destructuring confidence)
- Modify: `src/ir/layers.ts:26` (threshold)
- Modify: `tests/ir/fingerprint.test.ts`
- Modify: `tests/ir/layers.test.ts`

- [ ] **Step 1: Write failing tests for recalibrated confidence values**

Add to `tests/ir/fingerprint.test.ts`:

```typescript
it("returns very low confidence for unrecognized lines", () => {
  const result = fingerprintLine("  someComplexExpression.chain().map(x => x.y)");
  expect(result.type).toBe("raw");
  expect(result.confidence).toBeLessThanOrEqual(0.1);
});

it("gives high confidence to destructuring assignments", () => {
  const result = fingerprintLine("const [user, setUser] = useState(null);");
  expect(result.confidence).toBeGreaterThanOrEqual(0.9);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ir/fingerprint.test.ts`
Expected: 2 tests FAIL (raw still 0.3, destructuring still 0.65)

- [ ] **Step 3: Recalibrate confidence values**

In `src/ir/fingerprint.ts`:

Change line 138 (raw fallback):
```typescript
  return { type: "raw", ir: trimmed, confidence: 0.1 };
```

Change line 98 (destructuring confidence):
```typescript
    confidence: 0.9,
```

In `src/ir/layers.ts`, change line 26:
```typescript
  const ir = astIR ?? fingerprintFile(code, 0.75);
```

- [ ] **Step 4: Run ALL tests to check for regressions**

Run: `npx vitest run`
Expected: All tests PASS. Some existing tests may need updating if they asserted `confidence < 0.6` for raw lines — update those assertions to `confidence <= 0.1`.

- [ ] **Step 5: Fix any broken test assertions**

The existing test at line 47-49 of `tests/ir/fingerprint.test.ts` asserts `confidence < 0.6` for raw. Update it:

```typescript
it("returns raw for unrecognized lines", () => {
  const result = fingerprintLine("  someComplexExpression.chain().map(x => x.y)");
  expect(result.type).toBe("raw");
  expect(result.confidence).toBeLessThanOrEqual(0.1);
});
```

- [ ] **Step 6: Run tests again**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/ir/fingerprint.ts src/ir/layers.ts tests/ir/fingerprint.test.ts tests/ir/layers.test.ts
git commit -m "feat(confidence): recalibrate scores — raw 0.1, destructuring 0.9, threshold 0.75"
```

---

## Task 4: AST-IR — Generic Types & Decorators

**Files:**
- Modify: `src/parser/queries.ts:3-18` (TYPESCRIPT_QUERIES)
- Modify: `src/parser/ast-ir.ts:106-112` (class/type extraction)
- Modify: `tests/parser/ast-ir.test.ts`

- [ ] **Step 1: Write failing tests for generic type and decorator preservation**

Add to `tests/parser/ast-ir.test.ts`:

```typescript
it("preserves generic type parameters on classes", async () => {
  const code = 'export class Repository<T extends Entity> {\n  find(id: string): T { return {} as T; }\n}';
  const ir = await generateAstIR(code, "repo.ts");
  expect(ir).toContain("Repository<T extends Entity>");
});

it("preserves generic type parameters on interfaces", async () => {
  const code = "interface Response<T> {\n  data: T;\n  status: number;\n}";
  const ir = await generateAstIR(code, "types.ts");
  expect(ir).toContain("Response<T>");
});

it("preserves decorator annotations", async () => {
  const code = "@injectable\nexport class UserService {\n  getUser() { return null; }\n}";
  const ir = await generateAstIR(code, "service.ts");
  expect(ir).toContain("@injectable");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parser/ast-ir.test.ts`
Expected: 3 tests FAIL

- [ ] **Step 3: Extend tree-sitter queries to capture type parameters**

In `src/parser/queries.ts`, update `TYPESCRIPT_QUERIES.classes`:

```typescript
classes: `[
  (class_declaration name: (type_identifier) @name type_parameters: (type_parameters)? @type_params) @class
  (interface_declaration name: (type_identifier) @name type_parameters: (type_parameters)? @type_params) @interface
]`,
```

- [ ] **Step 4: Update AST-IR to use type parameters and detect decorators**

In `src/parser/ast-ir.ts`, update the classes loop (around line 106):

```typescript
// Classes / Types / Structs
for (const match of safeQuery(language, queries.classes, root)) {
  const nameCapture = match.captures.find(c => c.name === "name");
  const typeCapture = match.captures.find(c => ["class", "interface", "type", "struct", "enum", "trait", "impl"].includes(c.name));
  const typeParams = match.captures.find(c => c.name === "type_params");
  if (nameCapture && typeCapture) {
    const label = typeCapture.name.toUpperCase();
    const generics = typeParams ? typeParams.node.text : "";
    // Check for decorators on parent
    const parentNode = typeCapture.node;
    let decoratorPrefix = "";
    if (parentNode.previousNamedSibling?.type === "decorator") {
      decoratorPrefix = parentNode.previousNamedSibling.text + " ";
    }
    // Check for export
    const isExported = parentNode.parent?.type === "export_statement";
    const exportPrefix = isExported ? "OUT " : "";
    irParts.push(`${decoratorPrefix}${exportPrefix}${label}:${nameCapture.node.text}${generics}`);
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/parser/ast-ir.test.ts`
Expected: All PASS (Note: tree-sitter query syntax for optional captures may need `?` — if tests fail, adjust the query to not use optional captures and instead check for type_parameters node in the AST-IR code itself)

- [ ] **Step 6: Commit**

```bash
git add src/parser/queries.ts src/parser/ast-ir.ts tests/parser/ast-ir.test.ts
git commit -m "feat(ast-ir): preserve generic types and decorator annotations"
```

---

## Task 5: AST-IR — Async Markers & Return Value Extension

**Files:**
- Modify: `src/parser/ast-ir.ts:116-132` (function extraction)
- Modify: `tests/parser/ast-ir.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/parser/ast-ir.test.ts`:

```typescript
it("marks async functions", async () => {
  const code = "export async function fetchUsers(query: string) {\n  const data = await db.find(query);\n  return data;\n}";
  const ir = await generateAstIR(code, "api.ts");
  expect(ir).toContain("ASYNC");
  expect(ir).toContain("FN:fetchUsers");
});

it("extends return value truncation to 100 chars", async () => {
  const code = "export function build() {\n  return { id: generateId(), name: userName, email: userEmail, role: userRole, createdAt: new Date() };\n}";
  const ir = await generateAstIR(code, "builder.ts");
  // Should have more than 50 chars of return value
  const retLine = ir!.split("\n").find(l => l.includes("RET"));
  expect(retLine!.length).toBeGreaterThan(55);
});

it("captures calls to imported functions in body", async () => {
  const code = 'import { validate } from "./validator";\nexport function process(input: string) {\n  validate(input);\n  return input.trim();\n}';
  const ir = await generateAstIR(code, "proc.ts");
  expect(ir).toContain("CALL:validate");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parser/ast-ir.test.ts`
Expected: 3 tests FAIL

- [ ] **Step 3: Add async detection and extend return truncation**

In `src/parser/ast-ir.ts`, update the functions loop (around line 116):

```typescript
// Functions
for (const match of safeQuery(language, queries.functions, root)) {
  const nameCapture = match.captures.find(c => c.name === "name");
  const fnCapture = match.captures.find(c => c.name === "fn");
  if (nameCapture && fnCapture) {
    const isExported = fnCapture.node.parent?.type === "export_statement";
    const prefix = isExported ? "OUT " : "";
    // Detect async
    const fnText = fnCapture.node.text;
    const asyncPrefix = fnText.trimStart().startsWith("async") ? "ASYNC " : "";
    const params = fnCapture.node.childForFieldName("parameters")?.text ?? "()";
    const bodyLines = summarizeFnBody(fnCapture.node);
    const fnLine = `${prefix}${asyncPrefix}FN:${nameCapture.node.text}${params}`;
    if (bodyLines.length > 0) {
      irParts.push(`${fnLine}\n${bodyLines.join("\n")}`);
    } else {
      irParts.push(fnLine);
    }
  }
}
```

Update `summarizeFnBody` return value truncation (line 48):

```typescript
const short = retVal.length > 100 ? retVal.slice(0, 97) + "..." : retVal;
```

Add call_expression capture to `summarizeFnBody` walk function, after the `match_expression` case:

```typescript
case "call_expression": {
  const callee = node.child(0)?.text ?? "";
  // Only capture calls to imported functions (not console.log, etc.)
  if (callee && !callee.startsWith("console.") && !callee.startsWith("Math.")) {
    const shortCallee = callee.length > 40 ? callee.slice(0, 37) + "..." : callee;
    lines.push(`${indent}CALL:${shortCallee}`);
  }
  return; // Don't walk children of call expressions
}
```

Note: Add `return;` after CALL to avoid walking into the call's arguments and double-counting nested calls.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/parser/ast-ir.test.ts`
Expected: All PASS

- [ ] **Step 5: Run full test suite for regressions**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/parser/ast-ir.ts tests/parser/ast-ir.test.ts
git commit -m "feat(ast-ir): async markers, 100-char return values, imported call capture"
```

---

## Task 6: Phase 1 Verification — Benchmark Before/After

**Files:** None modified (measurement only)

- [ ] **Step 1: Run benchmark and record results**

```bash
npx composto benchmark .
```

Record: total raw tokens, total IR tokens, savings %, avg confidence.

- [ ] **Step 2: Compare against baseline**

Baseline (before changes): 26,834 raw → 4,356 IR (83.8%), confidence 0.46
Target: 92%+ compression, 0.85+ confidence

- [ ] **Step 3: If targets not met, investigate**

Run `npx composto ir src/ir/layers.ts L1` and check if the worst-case file improved from 52%.

- [ ] **Step 4: Commit benchmark results as a record**

```bash
npx composto benchmark . > docs/superpowers/plans/phase1-benchmark-results.txt
git add docs/superpowers/plans/phase1-benchmark-results.txt
git commit -m "docs: record Phase 1 benchmark results"
```

---

## Task 7: Context Packer — Core Algorithm

**Files:**
- Create: `src/context/packer.ts`
- Create: `tests/context/packer.test.ts`

- [ ] **Step 1: Write failing tests for budget packing**

Create `tests/context/packer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { packContext, type PackResult } from "../../src/context/packer.js";

describe("packContext", () => {
  const files = [
    { path: "src/big.ts", code: "export function big() {\n  const x = 1;\n  return x;\n}", rawTokens: 500 },
    { path: "src/small.ts", code: "export function small() { return 1; }", rawTokens: 100 },
    { path: "src/medium.ts", code: "export function med() {\n  if (true) return 2;\n}", rawTokens: 300 },
  ];

  it("returns all L0 when budget is very small", async () => {
    const result = await packContext(files, { budget: 100, hotspots: [] });
    expect(result.entries.every(e => e.layer === "L0")).toBe(true);
    expect(result.totalTokens).toBeLessThanOrEqual(100);
  });

  it("upgrades files to L1 when budget allows", async () => {
    const result = await packContext(files, { budget: 5000, hotspots: [] });
    expect(result.entries.some(e => e.layer === "L1")).toBe(true);
    expect(result.totalTokens).toBeLessThanOrEqual(5000);
  });

  it("prioritizes hotspot files for L1 upgrade", async () => {
    const hotspots = [{ file: "src/small.ts", changesInLast30Commits: 15, bugFixRatio: 0.6, authorCount: 3 }];
    const result = await packContext(files, { budget: 300, hotspots });
    const smallEntry = result.entries.find(e => e.path === "src/small.ts");
    expect(smallEntry?.layer).toBe("L1");
  });

  it("never exceeds the budget", async () => {
    const result = await packContext(files, { budget: 50, hotspots: [] });
    expect(result.totalTokens).toBeLessThanOrEqual(50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/context/packer.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the packer**

Create `src/context/packer.ts`:

```typescript
import { generateLayer } from "../ir/layers.js";
import { estimateTokens } from "../benchmark/tokenizer.js";
import type { Hotspot } from "../types.js";

export interface FileInput {
  path: string;
  code: string;
  rawTokens: number;
}

export interface PackEntry {
  path: string;
  layer: "L0" | "L1";
  ir: string;
  tokens: number;
}

export interface PackResult {
  entries: PackEntry[];
  totalTokens: number;
  budget: number;
  filesAtL0: number;
  filesAtL1: number;
}

export async function packContext(
  files: FileInput[],
  options: { budget: number; hotspots: Hotspot[] }
): Promise<PackResult> {
  const { budget, hotspots } = options;
  const hotspotSet = new Set(hotspots.map(h => h.file));

  // Step 1: Generate L0 for all files
  const entries: PackEntry[] = [];
  let totalTokens = 0;

  for (const file of files) {
    const l0 = await generateLayer("L0", { code: file.code, filePath: file.path, health: null });
    const l0Tokens = estimateTokens(l0);
    entries.push({ path: file.path, layer: "L0", ir: l0, tokens: l0Tokens });
    totalTokens += l0Tokens;
  }

  // If L0 already exceeds budget, truncate
  if (totalTokens > budget) {
    const truncated: PackEntry[] = [];
    let used = 0;
    for (const entry of entries) {
      if (used + entry.tokens <= budget) {
        truncated.push(entry);
        used += entry.tokens;
      }
    }
    return { entries: truncated, totalTokens: used, budget, filesAtL0: truncated.length, filesAtL1: 0 };
  }

  // Step 2: Upgrade to L1, hotspots first, then by size (largest first)
  const upgradeOrder = entries
    .map((e, i) => ({ index: i, path: e.path, rawTokens: files[i].rawTokens, isHotspot: hotspotSet.has(e.path) }))
    .sort((a, b) => {
      if (a.isHotspot && !b.isHotspot) return -1;
      if (!a.isHotspot && b.isHotspot) return 1;
      return b.rawTokens - a.rawTokens;
    });

  let filesAtL1 = 0;

  for (const item of upgradeOrder) {
    const file = files[item.index];
    const l1 = await generateLayer("L1", { code: file.code, filePath: file.path, health: null });
    const l1Tokens = estimateTokens(l1);
    const currentL0Tokens = entries[item.index].tokens;
    const additionalTokens = l1Tokens - currentL0Tokens;

    if (totalTokens + additionalTokens <= budget) {
      entries[item.index] = { path: item.path, layer: "L1", ir: l1, tokens: l1Tokens };
      totalTokens += additionalTokens;
      filesAtL1++;
    }
  }

  return {
    entries,
    totalTokens,
    budget,
    filesAtL0: entries.length - filesAtL1,
    filesAtL1,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/context/packer.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/context/packer.ts tests/context/packer.test.ts
git commit -m "feat(context): add budget-aware context packer"
```

---

## Task 8: Context CLI Command

**Files:**
- Modify: `src/cli/commands.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add runContext function to commands.ts**

Add to the end of `src/cli/commands.ts`:

```typescript
import { packContext, type FileInput } from "../context/packer.js";

export async function runContext(projectPath: string, budget: number): Promise<void> {
  console.log(`composto v0.1.0 — context (budget: ${budget} tokens)\n`);

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

  const result = await packContext(fileInputs, { budget, hotspots });

  // Print L1 files first
  const l1Entries = result.entries.filter(e => e.layer === "L1");
  const l0Entries = result.entries.filter(e => e.layer === "L0");

  if (l1Entries.length > 0) {
    console.log("  == L1 (detailed) ==\n");
    for (const entry of l1Entries) {
      console.log(`  [${hotspots.some(h => h.file === entry.path) ? "hotspot" : "detail"}] ${entry.path}`);
      console.log(`  ${entry.ir.split("\n").join("\n  ")}\n`);
    }
  }

  if (l0Entries.length > 0) {
    console.log("  == L0 (structure) ==\n");
    for (const entry of l0Entries) {
      console.log(`  ${entry.ir.split("\n").join("\n  ")}`);
    }
  }

  console.log(`\n  Budget: ${result.totalTokens}/${result.budget} tokens`);
  console.log(`  Files: ${result.filesAtL1} at L1, ${result.filesAtL0} at L0`);
}
```

Add the import for `estimateTokens` at the top of `commands.ts`:

```typescript
import { estimateTokens } from "../benchmark/tokenizer.js";
```

- [ ] **Step 2: Add CLI route in index.ts**

Add after the `benchmark-quality` case in `src/index.ts`:

```typescript
case "context": {
  const projectPath = resolve(args[1] ?? ".");
  const budgetFlag = args.indexOf("--budget");
  const budget = budgetFlag !== -1 && args[budgetFlag + 1] ? parseInt(args[budgetFlag + 1], 10) : 4000;
  await runContext(projectPath, budget);
  break;
}
```

Update the help text in the default case:

```typescript
console.log("  context [path] --budget N  Smart context within token budget");
```

Update the import in `src/index.ts`:

```typescript
import { runScan, runTrends, runIR, runBenchmark, runBenchmarkQuality, runContext } from "./cli/commands.js";
```

- [ ] **Step 3: Build and test manually**

```bash
pnpm build && npx composto context src/ --budget 2000
```

Expected: Output showing L0/L1 split within 2000 token budget, hotspot files at L1.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands.ts src/index.ts
git commit -m "feat(cli): add 'context' command with budget-aware packing"
```

---

## Task 9: Multi-Prompt Quality Benchmark

**Files:**
- Modify: `src/benchmark/quality.ts`
- Modify: `tests/benchmark/quality.test.ts`

- [ ] **Step 1: Write failing test for multi-prompt benchmark**

Add to `tests/benchmark/quality.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { BENCHMARK_PROMPTS } from "../../src/benchmark/quality.js";

describe("BENCHMARK_PROMPTS", () => {
  it("has at least 5 different prompt scenarios", () => {
    expect(BENCHMARK_PROMPTS.length).toBeGreaterThanOrEqual(5);
  });

  it("covers understand, fix-bug, review, explain, refactor scenarios", () => {
    const ids = BENCHMARK_PROMPTS.map(p => p.id);
    expect(ids).toContain("understand");
    expect(ids).toContain("fix-bug");
    expect(ids).toContain("review");
    expect(ids).toContain("explain");
    expect(ids).toContain("refactor");
  });

  it("each prompt has id, label, and template fields", () => {
    for (const prompt of BENCHMARK_PROMPTS) {
      expect(prompt.id).toBeTruthy();
      expect(prompt.label).toBeTruthy();
      expect(prompt.template).toBeTruthy();
      expect(prompt.template).toContain("{code}");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/benchmark/quality.test.ts`
Expected: FAIL

- [ ] **Step 3: Add multi-prompt array to quality.ts**

In `src/benchmark/quality.ts`, replace the single `PROMPT` constant with:

```typescript
export interface BenchmarkPrompt {
  id: string;
  label: string;
  template: string;
}

export const BENCHMARK_PROMPTS: BenchmarkPrompt[] = [
  {
    id: "understand",
    label: "Comprehension",
    template: "What does this code do? List the main functions/classes and briefly describe each one's purpose and dependencies.\n\n{code}",
  },
  {
    id: "fix-bug",
    label: "Bug Detection",
    template: "Review this code for potential bugs, edge cases, or error handling issues. List any problems you find.\n\n{code}",
  },
  {
    id: "review",
    label: "Code Review",
    template: "Do a code review of this file. Comment on code quality, naming, structure, and any improvements you'd suggest.\n\n{code}",
  },
  {
    id: "explain",
    label: "Explanation",
    template: "Explain this code to a developer who is new to the codebase. Focus on how the pieces fit together.\n\n{code}",
  },
  {
    id: "refactor",
    label: "Refactoring",
    template: "How would you refactor this code for better maintainability and testability? Suggest specific changes.\n\n{code}",
  },
];
```

Update `askClaude` to accept a prompt parameter:

```typescript
async function askClaude(context: string, prompt: string, apiKey: string): Promise<QualityResult & { usageInput: number; usageOutput: number }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const userMessage = prompt.replace("{code}", context);
  const estimatedInput = estimateTokens(userMessage);

  const start = performance.now();
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: userMessage }],
  });
  const elapsed = performance.now() - start;

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock?.text ?? "";

  return {
    label: "",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    responseTimeMs: elapsed,
    response: text,
    usageInput: response.usage.input_tokens,
    usageOutput: response.usage.output_tokens,
  };
}
```

Update `runQualityBenchmark` to use the first prompt by default (backward compatible):

```typescript
export async function runQualityBenchmark(
  code: string,
  filePath: string,
  apiKey: string,
  promptId: string = "understand"
): Promise<QualityBenchmark> {
  const irL1 = await generateLayer("L1", { code, filePath, health: null });
  const prompt = BENCHMARK_PROMPTS.find(p => p.id === promptId) ?? BENCHMARK_PROMPTS[0];

  const [rawResult, irResult] = await Promise.all([
    askClaude(code, prompt.template, apiKey),
    askClaude(irL1, prompt.template, apiKey),
  ]);

  rawResult.label = "Raw Code";
  irResult.label = `IR (L1) — ${prompt.label}`;

  const savedPercent = rawResult.totalTokens > 0
    ? ((rawResult.totalTokens - irResult.totalTokens) / rawResult.totalTokens) * 100
    : 0;

  return { file: filePath, raw: rawResult, ir: irResult, savedPercent };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/benchmark/quality.test.ts`
Expected: All PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/benchmark/quality.ts tests/benchmark/quality.test.ts
git commit -m "feat(benchmark): multi-prompt quality benchmark with 5 scenarios"
```

---

## Task 10: Final Verification & Benchmark

**Files:** None modified

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 2: Build the project**

```bash
pnpm build
```

Expected: Clean build, no errors

- [ ] **Step 3: Run full project benchmark**

```bash
npx composto benchmark .
```

Record results. Compare to baseline: 26,834 → 4,356 (83.8%), confidence 0.46

- [ ] **Step 4: Test context command**

```bash
npx composto context . --budget 2000
npx composto context . --budget 500
```

Verify output respects budget and prioritizes hotspots.

- [ ] **Step 5: Test IR on worst-case file**

```bash
npx composto ir src/ir/layers.ts L1
```

Verify layers.ts compression improved from 52%.

- [ ] **Step 6: Commit final benchmark**

```bash
npx composto benchmark . > docs/superpowers/plans/final-benchmark-results.txt
git add docs/superpowers/plans/final-benchmark-results.txt
git commit -m "docs: record final benchmark — Phase 1+2 complete"
```
