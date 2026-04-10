# Composto Revolution — From Compression Tool to Context Engine

**Date:** 2026-04-10
**Author:** Mert Can Altin + Claude (Principal Engineer)
**Status:** Design approved, ready for implementation planning

---

## Problem Statement

Composto achieves 83.8% token savings across 46 files, but:

- Average confidence is 0.46 — nearly half of code lines fall to raw fallback
- 13+ common TS/JS constructs (arrow functions, ternary, template literals, destructuring, etc.) are unrecognized by the fingerprint engine
- AST-IR drops generic types, decorators, async markers, and truncates return values at 50 chars
- The worst-case file (layers.ts) only gets 52% compression because low-quality lines leak through a permissive 0.6 threshold
- Benchmark measures only token count, not LLM response quality
- No way to control how much context budget is spent

## Goal

Transform Composto from a blind compression tool into a context engine that understands what it's compressing and how much budget it has.

**Metrics:**
- TS/JS confidence: 0.46 → 0.85+
- Overall compression: 83% → 92%+
- Worst-case file compression: 52% → 70%+
- Benchmark: token-only → token + LLM accuracy across 5 prompt types

---

## Phase 1: Foundation Fixes (TS/JS Mastery)

### 1.1 New Fingerprint Patterns

Add 13 patterns to `src/ir/fingerprint.ts` for common TS/JS constructs that currently fall to raw fallback (0.3 confidence):

| Pattern | Example | IR Output | Confidence |
|---------|---------|-----------|------------|
| Named arrow function | `const fn = (x) => x * 2` | `FN:fn = (x) => ...` | 0.90 |
| Multiline arrow function | `const fn = (x) => {` | `FN:fn = (x) => {` | 0.90 |
| Ternary expression | `const x = a ? b : c` | `VAR:x = a ? b : c` | 0.75 |
| Template literal | `` `Hello ${name}` `` | `STR_TEMPLATE:...${name}...` | 0.70 |
| Destructuring param | `function f({a, b})` | `FN:f({a, b})` | 0.90 |
| Object spread | `{...obj, key: val}` | `SPREAD:{...obj, key}` | 0.75 |
| Array spread | `[...arr, item]` | `SPREAD:[...arr, item]` | 0.75 |
| Method definition | `methodName() {` | `METHOD:methodName()` | 0.90 |
| Getter/Setter | `get name() {` | `GET:name()` / `SET:name()` | 0.90 |
| Await expression | `const x = await fetch()` | `AWAIT:fetch()` | 0.85 |
| Type assertion | `x as string` | (keep in assignment context) | 0.70 |
| Optional chaining | `obj?.prop?.val` | (keep in expression context) | 0.75 |
| Nullish coalescing | `x ?? defaultVal` | (keep in assignment context) | 0.75 |

**Implementation:** Each pattern is a `{ match: RegExp, transform: Function, confidence: number }` entry in the existing `PATTERNS` array in `fingerprint.ts`.

### 1.2 Confidence Score Recalibration

Current scores undervalue known patterns and overvalue unknown ones:

| What | Current | New | Reason |
|------|---------|-----|--------|
| Raw fallback (unrecognized line) | 0.3 | 0.1 | "I don't know" should be near-zero |
| Simple variable assignment | 0.7 | 0.85 | Well-understood construct |
| Destructuring assignment | 0.65 | 0.90 | Syntax is unambiguous |
| Confidence threshold in L1 | 0.6 | 0.75 | Stop low-quality lines from leaking into IR |

**Impact:** Raising the threshold from 0.6 to 0.75 means lines with raw fallback (0.1) and low-confidence patterns (<0.75) get excluded from L1 IR. This directly improves compression ratio.

### 1.3 AST-IR Enhancements

Changes to `src/parser/ast-ir.ts` and `src/parser/queries.ts`:

**Generic type preservation:**
- `MyClass<T>` → `CLASS:MyClass<T>` (currently loses `<T>`)
- `function parse<T extends Base>(input: T)` → `FN:parse<T extends Base>(input: T)`
- Implementation: extend tree-sitter query to capture `type_parameters` node

**Decorator preservation:**
- `@Entity class User {}` → `@Entity CLASS:User`
- `@deprecated export function old()` → `@deprecated OUT FN:old()`
- Implementation: capture `decorator` parent nodes in queries

**Async marker:**
- `async function fetchData()` → `ASYNC FN:fetchData()`
- `async () => {}` → `ASYNC FN:() => {}`
- Implementation: check `async` keyword in function declaration node

**Return value truncation:**
- Current: 50 chars → New: 100 chars
- Rationale: return shapes carry high signal about what a function does

**Function body call capture:**
- Currently: only IF/LOOP/RET/TRY captured in function body
- Add: calls to imported functions and `this` method calls (skip internal variable assignments and utility calls like `console.log`)
- Example: `CALL:db.sessions.exists(decoded.sessionId)` in function body summary
- Heuristic: capture calls where the callee was declared via `import` or is a `this.` member

### 1.4 Measurement

After Phase 1 changes, re-run:
```bash
npx composto benchmark .
```

**Success criteria:**
- Average confidence: 0.85+ (from 0.46)
- Overall compression: 90%+ (from 83.8%)
- Worst-case file: 70%+ (from 52%)
- All existing tests pass
- New tests for all 13 patterns pass

---

## Phase 2: Context Budget

### 2.1 New Command

```bash
composto context <path> --budget <max_tokens>
```

Given a token budget, produce the maximum-information IR output that fits within it.

### 2.2 Packing Algorithm

Priority-based packing:

1. **All files L0** — costs ~20 tokens/file, gives full structural map
2. **Hotspot files L1 first** — files with high churn and bug-fix ratio get L1 before others
3. **Remaining files L1 by size** — largest files first (more information per L1 upgrade)
4. **Stop when budget exhausted**

```
Budget: 2000 tokens
Step 1: 46 files × ~18 tokens = 828 tokens (L0 for everything)
Step 2: Top 5 hotspot files L1 = +600 tokens = 1428 total
Step 3: Next 3 largest files L1 = +500 tokens = 1928 total
Step 4: Budget nearly full, stop. Remaining 72 tokens buffer.
```

### 2.3 Output Format

```
# Composto Context (budget: 2000/2000 tokens)
# 46 files: 8 at L1, 38 at L0

== L1 (detailed) ==
[hotspot] src/ir/fingerprint.ts
  USE:import type { FingerprintResult } from "../types.js"
  OUT FN:fingerprintLine(line: string) ...
  OUT FN:fingerprintFile(code: string) ...

[hotspot] src/cli/commands.ts
  USE:import { readFileSync } from "node:fs" ...
  OUT FN:runScan(projectPath: string) ...

== L0 (structure) ==
src/types.ts
  INTERFACE:StructureLine, FingerprintResult, DeltaContext ...
src/config/loader.ts
  FN:loadConfig L5
...
```

### 2.4 Data Sources

- Hotspot data: `src/trends/hotspot.ts` (already exists)
- Token estimation: `src/benchmark/tokenizer.ts` (already exists)
- L0/L1 generation: `src/ir/layers.ts` (already exists)

This phase is mostly orchestration — connecting existing pieces with a budget-aware scheduler.

### 2.5 Measurement

```bash
# Compare: full L1 vs budget-constrained
npx composto benchmark .          # baseline: all L1
npx composto context . --budget 2000  # budget: smart packing
```

**Success criteria:**
- Budget output never exceeds specified token limit
- Information density (useful tokens / total tokens) higher than naive L1
- Hotspot files always get L1 treatment within reasonable budgets

---

## Phase 3: Smart IR (Deferred)

Designed after Phase 1-2 metrics are collected. Tentative direction:

- **Intent detection from conversation context** (not CLI flags)
- **Hybrid layer output** — different compression levels within a single file
- **Automatic target detection** — if user mentions a function name, that function gets L3

This phase will be specced separately based on Phase 1-2 learnings.

---

## Phase 4: Quality Benchmark (Continuous)

### 4.1 Multi-Prompt Benchmark

Replace single "list exports" prompt with 5 scenarios:

| Scenario | Prompt | What It Tests |
|----------|--------|---------------|
| Understand | "What does this module do and what are its dependencies?" | High-level comprehension from IR |
| Fix-bug | "There's a bug in function X. What could cause it?" | Can LLM reason about logic from IR? |
| Review | "Review this code for issues" | Does IR preserve enough for code review? |
| Explain | "Explain this function to a junior developer" | Semantic preservation |
| Refactor | "How would you refactor this for better testability?" | Structural understanding |

### 4.2 Quality Scoring

For each prompt, measure:
- **Token savings** (existing)
- **Response accuracy** — does the LLM's answer match what it would say with raw code?
- **Response completeness** — does the LLM miss anything important?

Scoring: run prompt with raw code (baseline), run with IR, compare responses. Score 0-1 for accuracy parity.

### 4.3 Implementation

Extend `src/benchmark/quality.ts`:
- Add prompt array (5 scenarios)
- Add response comparison (semantic similarity or keyword matching)
- Report per-scenario scores

### 4.4 Success Criteria

- Token savings: 90%+ (from Phase 1)
- Accuracy parity: 0.85+ across all 5 scenarios (IR responses ≥85% as good as raw)
- No scenario below 0.70 accuracy parity

---

## Files Changed

| File | Change |
|------|--------|
| `src/ir/fingerprint.ts` | Add 13 patterns, recalibrate scores |
| `src/ir/layers.ts` | Raise confidence threshold to 0.75 |
| `src/parser/ast-ir.ts` | Generic types, decorators, async, call capture |
| `src/parser/queries.ts` | Extended tree-sitter queries for TS/JS |
| `src/benchmark/quality.ts` | Multi-prompt benchmark, accuracy scoring |
| `src/cli/commands.ts` | Add `context` command |
| `src/context/packer.ts` | **New:** budget-aware context packing |
| `src/context/prioritizer.ts` | **New:** file priority scoring (hotspots, size) |
| `tests/ir/fingerprint.test.ts` | Tests for all 13 new patterns |
| `tests/parser/ast-ir.test.ts` | Tests for generics, decorators, async |
| `tests/context/packer.test.ts` | **New:** budget packing tests |
| `tests/benchmark/quality.test.ts` | Multi-prompt benchmark tests |

---

## Out of Scope

- New language support (Python/Go/Rust improvements deferred)
- IDE integration
- Intent detection from conversation context (Phase 3)
- Config externalization of fingerprint patterns
- Agent model selection per finding type
