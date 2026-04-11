# AST-First IR Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace regex fingerprinting with a comprehensive AST walker that classifies tree-sitter nodes by importance tier, achieving 88%+ compression on TypeScript/JavaScript files.

**Architecture:** A single recursive `walkNode` function classifies each AST node into 4 tiers (keep/control/compress/drop). Tier 1-3 nodes emit compressed IR, Tier 4 nodes are dropped. This replaces the old `generateAstIR` + `summarizeFnBody` system. Regex fingerprint stays as fallback for files without tree-sitter grammar support.

**Tech Stack:** TypeScript, web-tree-sitter, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/ir/ast-walker.ts` | **Create** | AST walk-and-compress engine with tier classification |
| `src/ir/layers.ts` | Modify | Switch L1 generation from old AST-IR to new ast-walker |
| `src/benchmark/runner.ts` | Modify | Report engine type (AST/FP) instead of confidence score |
| `src/cli/commands.ts` | Modify | Update benchmark display column from Conf to Engine |
| `tests/ir/ast-walker.test.ts` | **Create** | Tests for all tier classifications and edge cases |
| `tests/benchmark/runner.test.ts` | Modify | Update assertions for new engine field |

---

## Task 1: AST Walker — Tier 1 (Structural Declarations)

**Files:**
- Create: `src/ir/ast-walker.ts`
- Create: `tests/ir/ast-walker.test.ts`

- [ ] **Step 1: Write failing tests for Tier 1 nodes**

Create `tests/ir/ast-walker.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { astWalkIR } from "../../src/ir/ast-walker.ts";

describe("astWalkIR", () => {
  describe("Tier 1 — structural declarations", () => {
    it("captures import statements", async () => {
      const code = 'import { useState, useEffect } from "react";';
      const ir = await astWalkIR(code, "app.ts");
      expect(ir).toContain("USE:");
      expect(ir).toContain("react");
    });

    it("captures import type statements", async () => {
      const code = 'import type { User } from "./types.js";';
      const ir = await astWalkIR(code, "app.ts");
      expect(ir).toContain("USE:");
    });

    it("captures exported function declarations", async () => {
      const code = "export function processData(input: string): string {\n  return input.trim();\n}";
      const ir = await astWalkIR(code, "utils.ts");
      expect(ir).toContain("OUT FN:processData");
    });

    it("captures async function declarations", async () => {
      const code = "export async function fetchUser(id: string) {\n  return await db.find(id);\n}";
      const ir = await astWalkIR(code, "api.ts");
      expect(ir).toContain("ASYNC");
      expect(ir).toContain("FN:fetchUser");
    });

    it("captures class declarations with generics", async () => {
      const code = "export class Repository<T extends Entity> {\n  find(id: string): T { return {} as T; }\n}";
      const ir = await astWalkIR(code, "repo.ts");
      expect(ir).toContain("CLASS:Repository<T extends Entity>");
    });

    it("captures interface declarations", async () => {
      const code = "export interface UserConfig {\n  name: string;\n  age: number;\n}";
      const ir = await astWalkIR(code, "types.ts");
      expect(ir).toContain("INTERFACE:UserConfig");
    });

    it("captures type alias declarations", async () => {
      const code = 'export type Status = "active" | "inactive";';
      const ir = await astWalkIR(code, "types.ts");
      expect(ir).toContain("TYPE:Status");
    });

    it("captures enum declarations", async () => {
      const code = "export enum Color {\n  Red,\n  Green,\n  Blue,\n}";
      const ir = await astWalkIR(code, "enums.ts");
      expect(ir).toContain("ENUM:Color");
    });

    it("returns null for unsupported languages", async () => {
      const ir = await astWalkIR("some code", "file.unknown");
      expect(ir).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ir/ast-walker.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement ast-walker.ts with Tier 1**

Create `src/ir/ast-walker.ts`:

```typescript
import { getParser } from "../parser/init.js";
import { detectLanguage } from "../parser/languages.js";
import type { SyntaxNode } from "web-tree-sitter";

type Tier = "T1_KEEP" | "T2_CONTROL" | "T3_COMPRESS" | "T4_DROP" | "WALK_ONLY";

const TIER_MAP: Record<string, Tier> = {
  // Tier 1 — structural declarations
  import_statement: "T1_KEEP",
  function_declaration: "T1_KEEP",
  class_declaration: "T1_KEEP",
  interface_declaration: "T1_KEEP",
  type_alias_declaration: "T1_KEEP",
  enum_declaration: "T1_KEEP",
  // export_statement is special — handled inline

  // Walk-only containers
  program: "WALK_ONLY",
  statement_block: "WALK_ONLY",
  class_body: "WALK_ONLY",
  switch_body: "WALK_ONLY",
  export_statement: "WALK_ONLY",
};

function classifyNode(node: SyntaxNode): Tier {
  return TIER_MAP[node.type] ?? "T4_DROP";
}

function collapseText(text: string, maxLen: number): string {
  const collapsed = text.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  return collapsed.length > maxLen ? collapsed.slice(0, maxLen - 3) + "..." : collapsed;
}

function getTypeParams(node: SyntaxNode): string {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === "type_parameters") return child.text;
  }
  return "";
}

function isExported(node: SyntaxNode): boolean {
  return node.parent?.type === "export_statement";
}

function isAsync(node: SyntaxNode): boolean {
  return node.text.trimStart().startsWith("async");
}

function emitTier1(node: SyntaxNode): string | null {
  const exportPrefix = isExported(node) ? "OUT " : "";

  switch (node.type) {
    case "import_statement":
      return `USE:${collapseText(node.text, 80)}`;

    case "function_declaration": {
      const name = node.childForFieldName("name")?.text ?? "anonymous";
      const rawParams = node.childForFieldName("parameters")?.text ?? "()";
      const params = collapseText(rawParams, 60);
      const asyncPrefix = isAsync(node) ? "ASYNC " : "";
      return `${exportPrefix}${asyncPrefix}FN:${name}${params}`;
    }

    case "class_declaration": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      const typeParams = getTypeParams(node);
      return `${exportPrefix}CLASS:${name}${typeParams}`;
    }

    case "interface_declaration": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      const typeParams = getTypeParams(node);
      return `${exportPrefix}INTERFACE:${name}${typeParams}`;
    }

    case "type_alias_declaration": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      return `${exportPrefix}TYPE:${name}`;
    }

    case "enum_declaration": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      return `${exportPrefix}ENUM:${name}`;
    }

    default:
      return null;
  }
}

function walkNode(node: SyntaxNode, depth: number, lines: string[]): void {
  const indent = "  ".repeat(depth);
  const tier = classifyNode(node);

  switch (tier) {
    case "T1_KEEP": {
      const line = emitTier1(node);
      if (line) lines.push(`${indent}${line}`);
      // Walk children for function/class bodies
      if (["function_declaration", "class_declaration"].includes(node.type)) {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!;
          if (child.type === "statement_block" || child.type === "class_body") {
            walkNode(child, depth + 1, lines);
          }
        }
      }
      break;
    }

    case "WALK_ONLY": {
      // Handle export_statement: emit OUT prefix for child
      if (node.type === "export_statement") {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!;
          if (child.type !== "export" && child.type !== "default") {
            walkNode(child, depth, lines);
          }
        }
      } else {
        for (let i = 0; i < node.childCount; i++) {
          walkNode(node.child(i)!, depth, lines);
        }
      }
      break;
    }

    case "T4_DROP":
    default:
      break;
  }
}

export async function astWalkIR(code: string, filePath: string): Promise<string | null> {
  const lang = detectLanguage(filePath);
  if (!lang) return null;

  const { parser } = await getParser(lang);
  const tree = parser.parse(code);
  const lines: string[] = [];

  walkNode(tree.rootNode, 0, lines);

  if (lines.length === 0) return null;
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ir/ast-walker.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/ir/ast-walker.ts tests/ir/ast-walker.test.ts
git commit -m "feat(ast-walker): implement Tier 1 — structural declarations"
```

---

## Task 2: AST Walker — Tier 2 (Control Flow)

**Files:**
- Modify: `src/ir/ast-walker.ts`
- Modify: `tests/ir/ast-walker.test.ts`

- [ ] **Step 1: Write failing tests for Tier 2 nodes**

Add to `tests/ir/ast-walker.test.ts`:

```typescript
describe("Tier 2 — control flow", () => {
  it("captures if statements with condition", async () => {
    const code = "export function check(x: number) {\n  if (x > 10) {\n    return true;\n  }\n  return false;\n}";
    const ir = await astWalkIR(code, "check.ts");
    expect(ir).toContain("IF:x > 10");
    expect(ir).toContain("RET true");
    expect(ir).toContain("RET false");
  });

  it("captures if-else chains", async () => {
    const code = "function route(x: string) {\n  if (x === 'a') {\n    return 1;\n  } else {\n    return 2;\n  }\n}";
    const ir = await astWalkIR(code, "route.ts");
    expect(ir).toContain("IF:");
    expect(ir).toContain("ELSE:");
  });

  it("captures for-of loops", async () => {
    const code = "function sum(items: number[]) {\n  for (const item of items) {\n    total += item;\n  }\n}";
    const ir = await astWalkIR(code, "sum.ts");
    expect(ir).toContain("LOOP");
  });

  it("captures switch statements", async () => {
    const code = 'function handle(cmd: string) {\n  switch (cmd) {\n    case "run":\n      return exec();\n    default:\n      return help();\n  }\n}';
    const ir = await astWalkIR(code, "handler.ts");
    expect(ir).toContain("SWITCH:cmd");
    expect(ir).toContain("CASE:");
    expect(ir).toContain("DEFAULT:");
  });

  it("captures try-catch", async () => {
    const code = "function safe() {\n  try {\n    riskyCall();\n  } catch (err) {\n    log(err);\n  }\n}";
    const ir = await astWalkIR(code, "safe.ts");
    expect(ir).toContain("TRY");
    expect(ir).toContain("CATCH:err");
  });

  it("captures return with value truncation at 100 chars", async () => {
    const longReturn = "{ id: generateId(), name: userName, email: userEmail, role: userRole, status: active, createdAt: new Date(), updatedAt: new Date() }";
    const code = `function build() {\n  return ${longReturn};\n}`;
    const ir = await astWalkIR(code, "build.ts");
    const retLine = ir!.split("\n").find(l => l.includes("RET"));
    expect(retLine).toBeTruthy();
    expect(retLine!.length).toBeLessThan(120);
  });

  it("captures throw statements", async () => {
    const code = 'function validate(x: number) {\n  if (x < 0) throw new Error("negative");\n}';
    const ir = await astWalkIR(code, "validate.ts");
    expect(ir).toContain("THROW:");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ir/ast-walker.test.ts`
Expected: New tests FAIL

- [ ] **Step 3: Add Tier 2 to TIER_MAP and implement emitTier2**

In `src/ir/ast-walker.ts`, add to `TIER_MAP`:

```typescript
// Tier 2 — control flow
if_statement: "T2_CONTROL",
else_clause: "T2_CONTROL",
for_statement: "T2_CONTROL",
for_in_statement: "T2_CONTROL",
while_statement: "T2_CONTROL",
do_statement: "T2_CONTROL",
switch_statement: "T2_CONTROL",
switch_case: "T2_CONTROL",
switch_default: "T2_CONTROL",
return_statement: "T2_CONTROL",
throw_statement: "T2_CONTROL",
try_statement: "T2_CONTROL",
catch_clause: "T2_CONTROL",
```

Add `extractCondition` helper:

```typescript
function extractCondition(node: SyntaxNode): string {
  const condNode = node.childForFieldName("condition")
    ?? node.children.find(c => c.type === "parenthesized_expression");
  if (!condNode) return "...";
  const text = condNode.text.replace(/^\(/, "").replace(/\)$/, "").trim();
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}
```

Add `emitTier2` function:

```typescript
function emitTier2(node: SyntaxNode): string | null {
  switch (node.type) {
    case "if_statement":
      return `IF:${extractCondition(node)}`;
    case "else_clause":
      return "ELSE:";
    case "for_statement":
      return "LOOP";
    case "for_in_statement":
      return "LOOP";
    case "while_statement":
      return `WHILE:${extractCondition(node)}`;
    case "do_statement":
      return "DO_WHILE";
    case "switch_statement": {
      const val = node.childForFieldName("value")?.text ?? "...";
      return `SWITCH:${val.length > 30 ? val.slice(0, 27) + "..." : val}`;
    }
    case "switch_case": {
      const caseVal = node.children.find(c => c.type !== "case" && c.type !== ":")?.text ?? "...";
      return `CASE:${caseVal.length > 30 ? caseVal.slice(0, 27) + "..." : caseVal}`;
    }
    case "switch_default":
      return "DEFAULT:";
    case "return_statement": {
      const retVal = node.childCount > 1 ? node.child(1)?.text ?? "" : "";
      const short = retVal.length > 100 ? retVal.slice(0, 97) + "..." : retVal;
      return `RET ${short}`.trimEnd();
    }
    case "throw_statement": {
      const throwVal = node.childCount > 1 ? node.child(1)?.text ?? "" : "";
      return `THROW:${throwVal.length > 60 ? throwVal.slice(0, 57) + "..." : throwVal}`;
    }
    case "try_statement":
      return "TRY";
    case "catch_clause": {
      const param = node.childForFieldName("parameter")?.text ?? "";
      return `CATCH:${param}`;
    }
    default:
      return null;
  }
}
```

Add `T2_CONTROL` case to `walkNode`:

```typescript
case "T2_CONTROL": {
  const line = emitTier2(node);
  if (line) lines.push(`${indent}${line}`);
  // Walk children for nested control flow
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    walkNode(child, depth + 1, lines);
  }
  break;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ir/ast-walker.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/ir/ast-walker.ts tests/ir/ast-walker.test.ts
git commit -m "feat(ast-walker): implement Tier 2 — control flow"
```

---

## Task 3: AST Walker — Tier 3 (Compressible Expressions)

**Files:**
- Modify: `src/ir/ast-walker.ts`
- Modify: `tests/ir/ast-walker.test.ts`

- [ ] **Step 1: Write failing tests for Tier 3 nodes**

Add to `tests/ir/ast-walker.test.ts`:

```typescript
describe("Tier 3 — compressible expressions", () => {
  it("captures variable declarations", async () => {
    const code = "function init() {\n  const config = loadConfig();\n  const port = 3000;\n}";
    const ir = await astWalkIR(code, "init.ts");
    expect(ir).toContain("VAR:config");
    expect(ir).toContain("VAR:port");
  });

  it("captures top-level call expressions (non-collection methods)", async () => {
    const code = 'import { validate } from "./validator.js";\nfunction process(input: string) {\n  validate(input);\n  return input;\n}';
    const ir = await astWalkIR(code, "proc.ts");
    expect(ir).toContain("CALL:validate");
  });

  it("skips collection method calls", async () => {
    const code = "function build() {\n  items.push(1);\n  items.sort();\n  items.map(x => x);\n  return items;\n}";
    const ir = await astWalkIR(code, "build.ts");
    expect(ir).not.toContain("CALL:items.push");
    expect(ir).not.toContain("CALL:items.sort");
    expect(ir).not.toContain("CALL:items.map");
  });

  it("captures await expressions", async () => {
    const code = "async function load() {\n  const data = await fetchData();\n  return data;\n}";
    const ir = await astWalkIR(code, "load.ts");
    expect(ir).toContain("AWAIT:");
  });

  it("drops Tier 4 noise — string contents, operators, punctuation", async () => {
    const code = 'function greet(name: string) {\n  const msg = `Hello ${name}!`;\n  console.log(msg);\n  return msg;\n}';
    const ir = await astWalkIR(code, "greet.ts");
    // Should NOT contain raw string content or template internals
    expect(ir).not.toContain("Hello");
    expect(ir).toContain("FN:greet");
    expect(ir).toContain("RET msg");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ir/ast-walker.test.ts`
Expected: New tests FAIL

- [ ] **Step 3: Add Tier 3 to TIER_MAP and implement emitTier3**

In `src/ir/ast-walker.ts`, add to `TIER_MAP`:

```typescript
// Tier 3 — compressible expressions
lexical_declaration: "T3_COMPRESS",
expression_statement: "T3_COMPRESS",
```

Add the skip list for collection methods:

```typescript
const SKIP_CALL_SUFFIXES = [".push", ".pop", ".shift", ".unshift", ".splice", ".sort", ".reverse",
  ".set", ".get", ".delete", ".add", ".clear", ".has", ".forEach", ".map", ".filter", ".reduce",
  ".find", ".some", ".every", ".join", ".split", ".trim", ".slice", ".includes", ".indexOf",
  ".toString", ".valueOf"];

const SKIP_CALL_PREFIXES = ["console.", "Math.", "Object.", "Array.", "JSON.", "String.", "Number.", "Promise."];
```

Add `emitTier3` function:

```typescript
function emitTier3(node: SyntaxNode): string | null {
  if (node.type === "lexical_declaration") {
    // const/let/var name = value
    const declarator = node.children.find(c => c.type === "variable_declarator");
    if (!declarator) return null;
    const name = declarator.childForFieldName("name")?.text ?? "?";
    const value = declarator.childForFieldName("value");

    // Check if value is an arrow function
    if (value?.type === "arrow_function") {
      const params = value.childForFieldName("parameters")?.text ?? "()";
      const asyncPrefix = value.text.trimStart().startsWith("async") ? "ASYNC " : "";
      const exportPrefix = isExported(node) ? "OUT " : "";
      return `${exportPrefix}${asyncPrefix}FN:${name} = ${collapseText(params, 40)} => ...`;
    }

    // Check if value is an await expression
    if (value?.type === "await_expression") {
      const callee = value.child(1)?.text ?? "...";
      return `AWAIT:VAR:${name} = ${collapseText(callee, 50)}`;
    }

    // Regular variable — show name and short value hint
    const valText = value ? collapseText(value.text, 50) : "...";
    return `VAR:${name} = ${valText}`;
  }

  if (node.type === "expression_statement") {
    const expr = node.child(0);
    if (!expr) return null;

    // Await expression at statement level
    if (expr.type === "await_expression") {
      const callee = expr.child(1)?.text ?? "...";
      return `AWAIT:${collapseText(callee, 50)}`;
    }

    // Call expression at statement level
    if (expr.type === "call_expression") {
      const callee = expr.child(0)?.text ?? "...";
      if (SKIP_CALL_PREFIXES.some(p => callee.startsWith(p))) return null;
      if (SKIP_CALL_SUFFIXES.some(s => callee.endsWith(s))) return null;
      return `CALL:${collapseText(callee, 40)}`;
    }

    // Assignment expression
    if (expr.type === "assignment_expression" || expr.type === "augmented_assignment_expression") {
      const left = expr.childForFieldName("left")?.text ?? "?";
      return `${left} = ...`;
    }

    return null;
  }

  return null;
}
```

Add `T3_COMPRESS` case to `walkNode`:

```typescript
case "T3_COMPRESS": {
  const line = emitTier3(node);
  if (line) lines.push(`${indent}${line}`);
  // Don't walk children — one-liner summary is enough
  break;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ir/ast-walker.test.ts`
Expected: All PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/ir/ast-walker.ts tests/ir/ast-walker.test.ts
git commit -m "feat(ast-walker): implement Tier 3 — compressible expressions"
```

---

## Task 4: Integration — Switch layers.ts to AST Walker

**Files:**
- Modify: `src/ir/layers.ts:23-31`
- Modify: `tests/ir/layers.test.ts`

- [ ] **Step 1: Write integration test**

Add to `tests/ir/layers.test.ts`:

```typescript
it("uses AST walker for TypeScript files", async () => {
  const code = 'import { x } from "y";\nexport function hello(name: string) {\n  if (name) return `Hi ${name}`;\n  return "Hi";\n}';
  const result = await generateLayer("L1", { code, filePath: "test.ts", health: null });
  expect(result).toContain("USE:");
  expect(result).toContain("FN:hello");
  expect(result).toContain("IF:");
  expect(result).toContain("RET");
});

it("falls back to fingerprint for unknown file types", async () => {
  const code = 'def hello():\n  return "world"';
  const result = await generateLayer("L1", { code, filePath: "test.rb", health: null });
  // Ruby has no tree-sitter grammar loaded, should use fingerprint
  expect(result).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify baseline**

Run: `npx vitest run tests/ir/layers.test.ts`
Expected: PASS (existing behavior)

- [ ] **Step 3: Switch layers.ts to use astWalkIR**

In `src/ir/layers.ts`, change the import:

```typescript
import { astWalkIR } from "./ast-walker.js";
```

Remove the old import:
```typescript
// Remove: import { generateAstIR } from "../parser/ast-ir.js";
```

Update `generateL1` (line 23-31):

```typescript
export async function generateL1(code: string, filePath: string, health: HealthAnnotation | null): Promise<string> {
  const ir = await astWalkIR(code, filePath) ?? fingerprintFile(code, 0.75);
  if (health) {
    return annotateIR(ir, health);
  }
  return ir;
}
```

- [ ] **Step 4: Run ALL tests**

Run: `npx vitest run`
Expected: All PASS. Some existing tests may need minor assertion updates if the IR format changed slightly.

- [ ] **Step 5: Build and run benchmark**

```bash
pnpm build
npx composto benchmark .
```

Compare compression to baseline (84.7%). Target: 88%+.

- [ ] **Step 6: Commit**

```bash
git add src/ir/layers.ts tests/ir/layers.test.ts
git commit -m "feat(layers): switch L1 generation to AST walker, fingerprint as fallback"
```

---

## Task 5: Benchmark — Engine Column Instead of Confidence

**Files:**
- Modify: `src/benchmark/runner.ts`
- Modify: `src/cli/commands.ts`
- Modify: `tests/benchmark/runner.test.ts`

- [ ] **Step 1: Update FileResult interface**

In `src/benchmark/runner.ts`, change the `FileResult` interface:

```typescript
export interface FileResult {
  file: string;
  rawTokens: number;
  irL0Tokens: number;
  irL1Tokens: number;
  savedPercent: number;
  engine: "AST" | "FP";
}
```

- [ ] **Step 2: Update benchmarkFile to detect engine**

Replace the confidence calculation in `benchmarkFile` with engine detection:

```typescript
import { astWalkIR } from "../ir/ast-walker.js";

export async function benchmarkFile(code: string, filePath: string): Promise<FileResult> {
  const rawTokens = estimateTokens(code);

  const irL0 = await generateLayer("L0", { code, filePath, health: null });
  const irL1 = await generateLayer("L1", { code, filePath, health: null });
  const irL0Tokens = estimateTokens(irL0);
  const irL1Tokens = estimateTokens(irL1);

  // Detect which engine was used
  const astResult = await astWalkIR(code, filePath);
  const engine: "AST" | "FP" = astResult !== null ? "AST" : "FP";

  const savedPercent = rawTokens > 0 ? ((rawTokens - irL1Tokens) / rawTokens) * 100 : 0;

  return { file: filePath, rawTokens, irL0Tokens, irL1Tokens, savedPercent, engine };
}
```

Remove the `fingerprintLine` import if it's no longer needed.

- [ ] **Step 3: Update BenchmarkSummary**

```typescript
export interface BenchmarkSummary {
  fileCount: number;
  totalRaw: number;
  totalIRL0: number;
  totalIRL1: number;
  totalSavedPercent: number;
  astCount: number;
  fpCount: number;
}
```

Update `summarize`:

```typescript
export function summarize(results: FileResult[]): BenchmarkSummary {
  const totalRaw = results.reduce((s, r) => s + r.rawTokens, 0);
  const totalIRL0 = results.reduce((s, r) => s + r.irL0Tokens, 0);
  const totalIRL1 = results.reduce((s, r) => s + r.irL1Tokens, 0);
  const totalSavedPercent = totalRaw > 0 ? ((totalRaw - totalIRL1) / totalRaw) * 100 : 0;
  const astCount = results.filter(r => r.engine === "AST").length;
  const fpCount = results.filter(r => r.engine === "FP").length;

  return { fileCount: results.length, totalRaw, totalIRL0, totalIRL1, totalSavedPercent, astCount, fpCount };
}
```

- [ ] **Step 4: Update CLI display in commands.ts**

In `src/cli/commands.ts`, update the `runBenchmark` function. Change the header line:

```typescript
const header = "  File                                  Raw      L0      L1   Saved   Eng";
```

Change the per-file output line — replace `conf` with `engine`:

```typescript
const eng = r.engine.padStart(5);
console.log(`  ${file} ${raw} ${l0} ${l1} ${saved} ${eng}`);
```

Change the summary lines at the bottom — replace confidence with engine counts:

```typescript
console.log(`  Engine: ${summary.astCount} AST, ${summary.fpCount} FP`);
```

Remove the `avgConfidence` line.

- [ ] **Step 5: Update test assertions**

In `tests/benchmark/runner.test.ts`, update any tests that assert on `avgConfidence` to assert on `engine` or `astCount`/`fpCount` instead.

- [ ] **Step 6: Run ALL tests**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 7: Build and verify**

```bash
pnpm build
npx composto benchmark .
```

Expected: Table now shows `AST` or `FP` in last column instead of confidence numbers.

- [ ] **Step 8: Commit**

```bash
git add src/benchmark/runner.ts src/cli/commands.ts tests/benchmark/runner.test.ts
git commit -m "feat(benchmark): replace confidence with engine column (AST/FP)"
```

---

## Task 6: Final Verification & Cleanup

**Files:** None modified (measurement + optional cleanup)

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: All PASS

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: Clean build

- [ ] **Step 3: Run full benchmark**

```bash
npx composto benchmark .
```

Record results. Target: 88%+ compression on src/ files, all files showing `AST` engine.

- [ ] **Step 4: Test worst-case file**

```bash
npx composto ir src/ir/layers.ts L1
```

Compare to baseline (50.1% savings). Target: 70%+.

- [ ] **Step 5: Test context command still works**

```bash
npx composto context . --budget 2000
```

Expected: Works correctly with new AST walker output.

- [ ] **Step 6: Commit final benchmark**

```bash
npx composto benchmark . > docs/superpowers/plans/ast-first-benchmark-results.txt
git add docs/superpowers/plans/ast-first-benchmark-results.txt
git commit -m "docs: record AST-first benchmark results"
```
