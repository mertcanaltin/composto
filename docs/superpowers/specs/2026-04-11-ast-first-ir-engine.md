# AST-First IR Engine — The Real Revolution

**Date:** 2026-04-11
**Author:** Mert Can Altin + Claude (Principal Engineer)
**Status:** Design approved, ready for implementation planning

---

## Problem

Composto's IR generation uses two systems:
1. **AST-IR** (`ast-ir.ts`) — tree-sitter parse, then `summarizeFnBody` which only handles 5 node types (if, for, while, return, try)
2. **Regex fingerprint** (`fingerprint.ts`) — 30+ regex patterns matching line by line, averaging 0.49 confidence

Tree-sitter parses TypeScript into 101 unique AST node types. We capture 5 of them. The other 96 are thrown away. This is why confidence is stuck at 0.49 and compression can't break past 85%.

The regex fingerprint approach has hit its ceiling. Adding more patterns gives diminishing returns because real code is irregular — chains, callbacks, nested ternaries, template literals with expressions. Regex can't handle this. AST already does.

## Solution

Replace both `ast-ir.ts` and `fingerprint.ts` as the primary IR engine with a single AST walker that classifies every node by importance tier and emits compressed IR accordingly.

Fingerprint stays as a fallback for files without a tree-sitter grammar (rare edge case).

## Architecture

### New Module: `src/ir/ast-walker.ts`

Single entry point:

```typescript
export async function astWalkIR(code: string, filePath: string): Promise<string | null>
```

Internally:
1. Detect language, get tree-sitter parser
2. Parse code into AST
3. Walk root node recursively, emitting IR based on node importance tier
4. Return compressed IR string, or null if parse fails

### Node Importance Tiers

**Tier 1 — Always Keep (structural declarations)**

These nodes define the shape of the code. Always emit a full IR line.

| Node Type | IR Output |
|-----------|-----------|
| `import_statement` | `USE:<text collapsed to 1 line, 80 char max>` |
| `export_statement` | `OUT` prefix on child declaration |
| `function_declaration` | `[OUT] [ASYNC] FN:name(params)` |
| `class_declaration` | `[OUT] CLASS:name[<type_params>]` |
| `interface_declaration` | `[OUT] INTERFACE:name[<type_params>]` |
| `type_alias_declaration` | `[OUT] TYPE:name` |
| `enum_declaration` | `[OUT] ENUM:name` |

For function/class/interface: detect `async` keyword, `export` parent, and `type_parameters` child. Collapse multiline parameter lists to single line.

**Tier 2 — Keep Compressed (control flow inside function bodies)**

These nodes show what a function does. Emit a short IR line, then selectively walk children.

| Node Type | IR Output |
|-----------|-----------|
| `if_statement` | `IF:condition (60 char max)` |
| `else_clause` | `ELSE:` |
| `for_statement` | `LOOP` |
| `for_in_statement` | `LOOP:collection` |
| `while_statement` | `WHILE:condition` |
| `switch_statement` | `SWITCH:expr` |
| `case_clause` | `CASE:value` |
| `default_clause` | `DEFAULT:` |
| `return_statement` | `RET value (100 char max)` |
| `throw_statement` | `THROW:expr (60 char max)` |
| `try_statement` | `TRY` |
| `catch_clause` | `CATCH:param` |
| `yield_expression` | `YIELD:expr` |

**Tier 3 — Keep One-Liner (valuable but compressible)**

These nodes carry information but don't need their full AST subtree. Emit one line, skip children.

| Node Type | IR Output | When |
|-----------|-----------|------|
| `lexical_declaration` | `VAR:name = <rhs summary 50 char>` | Always |
| `expression_statement` containing `call_expression` | `CALL:callee` | Only if callee is imported fn or `this.method`, skip collection methods (.push/.map/etc) |
| `expression_statement` containing `await_expression` | `AWAIT:callee` | Always |
| `expression_statement` containing `assignment_expression` | `name = <summary>` | Always |
| `arrow_function` (as variable init) | `FN:name = (params) => ...` | Handled via parent lexical_declaration |

**Tier 4 — Drop (noise)**

Everything else. String contents, number literals, operators, punctuation, comments, whitespace, type annotation internals. These are the tokens that regex fingerprint was passing through at 0.1 confidence and inflating IR output.

### Walking Strategy

```
walkNode(node, depth):
  tier = classifyNode(node)
  
  if tier == 1:
    emit IR line
    walk children (for function bodies)
  
  if tier == 2:
    emit IR line  
    walk children (for nested control flow)
  
  if tier == 3:
    emit IR line
    STOP — don't walk children
  
  if tier == 4:
    STOP — don't emit, don't walk children
  
  if tier == WALK_ONLY:
    don't emit anything
    walk children (for container nodes like program, statement_block)
```

Container nodes (`program`, `statement_block`, `class_body`, `switch_body`) are classified as `WALK_ONLY` — they don't emit IR but their children get processed.

### Indentation

Use AST depth for indentation, not source column position. This gives cleaner, more consistent output:

```
OUT FN:generateLayer(layer, options)
  SWITCH:layer
    CASE:"L0"
      RET generateL0(options.code, options.filePath)
    CASE:"L1"
      RET generateL1(...)
```

### Integration with layers.ts

```typescript
// Before:
const astIR = await generateAstIR(code, filePath);
const ir = astIR ?? fingerprintFile(code, 0.75);

// After:
const ir = await astWalkIR(code, filePath) ?? fingerprintFile(code, 0.75);
```

Single line change in `generateL1`. The old `generateAstIR` can be removed after migration.

### Benchmark Changes

The "Conf" column in benchmark output becomes "Engine":
- `AST` — astWalkIR was used (expected for all files with grammar support)
- `FP` — fingerprint fallback was used (only for unsupported languages)

Update `benchmarkFile` in `runner.ts` to report which engine was used instead of average confidence.

## Files Changed

| File | Action | What |
|------|--------|------|
| `src/ir/ast-walker.ts` | **Create** | New AST walk-and-compress engine |
| `src/ir/layers.ts` | Modify | Switch from generateAstIR to astWalkIR |
| `src/benchmark/runner.ts` | Modify | Report engine type instead of confidence |
| `src/cli/commands.ts` | Modify | Update benchmark display for engine column |
| `tests/ir/ast-walker.test.ts` | **Create** | Comprehensive tests for all tier classifications |
| `src/parser/ast-ir.ts` | Delete after migration | Old AST-IR (replaced by ast-walker) |

Files NOT changed:
- `src/ir/fingerprint.ts` — stays as fallback, unchanged
- `src/parser/queries.ts` — no longer needed for IR (was used by old ast-ir.ts)
- `src/parser/init.ts` — unchanged (still provides tree-sitter parser)

## Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| src/ files average compression | ~75% | **88%+** |
| Worst case file (layers.ts) | 50.1% | **70%+** |
| AST node types handled | 5 | **25+** |
| Engine used for .ts/.js files | AST (buggy) | **AST (comprehensive)** |
| Fingerprint fallback rate | ~0% (AST already primary) | **<1%** |
| All existing tests | 120 pass | **120+ pass** |

## Out of Scope

- New language support (Python/Go/Rust AST walker improvements)
- Importance tier configurability per-project
- Context budget changes (already implemented in Phase 2)
- Multi-prompt benchmark changes (already implemented in Phase 2)
- Removing fingerprint.ts entirely (kept as fallback)
