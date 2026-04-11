# Tree-sitter AST-based IR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace regex-based IR fingerprinting with tree-sitter AST parsing for dramatically better compression and multi-language support (TS, JS, Python, Go, Rust).

**Architecture:** `web-tree-sitter` (WASM) parses source files into ASTs. Per-language tree-sitter queries extract functions, classes, imports, branches, and loops. An AST-to-IR transformer converts query results into the compact IR format. The existing regex fingerprinter becomes the fallback for unsupported languages.

**Tech Stack:** web-tree-sitter, tree-sitter-wasms (vendored WASM grammars), vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/parser/init.ts` | Create | Parser singleton, WASM init, grammar cache |
| `src/parser/languages.ts` | Create | File extension → language mapping, grammar loading |
| `src/parser/ast-ir.ts` | Create | AST → IR conversion using tree-sitter queries |
| `src/parser/queries.ts` | Create | Tree-sitter S-expression queries per language |
| `src/ir/fingerprint.ts` | Modify | Export `fingerprintFile` as fallback (no changes to logic) |
| `src/ir/layers.ts` | Modify | L1 generation uses AST-IR with regex fallback |
| `src/cli/commands.ts` | Modify | `collectFiles` supports new extensions (.py, .go, .rs) |
| `package.json` | Modify | Add dependencies, include grammars in files |
| `tsup.config.ts` | Modify | Copy WASM files to dist |
| `tests/parser/init.test.ts` | Create | Parser init tests |
| `tests/parser/ast-ir.test.ts` | Create | AST-IR generation tests per language |
| `tests/parser/languages.test.ts` | Create | Language detection tests |

---

### Task 1: Install Dependencies and Setup WASM Grammars

**Files:**
- Modify: `package.json`
- Modify: `tsup.config.ts`

- [ ] **Step 1: Install web-tree-sitter and tree-sitter-wasms**

Run: `pnpm add web-tree-sitter tree-sitter-wasms`

- [ ] **Step 2: Update tsup.config.ts to copy WASM files**

Replace `tsup.config.ts` with:

```typescript
import { defineConfig } from "tsup";
import { cpSync, mkdirSync } from "node:fs";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  onSuccess: async () => {
    mkdirSync("dist/grammars", { recursive: true });
    const langs = ["typescript", "javascript", "python", "go", "rust"];
    for (const lang of langs) {
      cpSync(
        `node_modules/tree-sitter-wasms/out/tree-sitter-${lang}.wasm`,
        `dist/grammars/tree-sitter-${lang}.wasm`
      );
    }
  },
});
```

- [ ] **Step 3: Update package.json files field**

Add `"dist/grammars"` to the `files` array:

```json
"files": [
  "dist",
  "README.md"
],
```

(dist already includes grammars subdirectory via the copy step)

- [ ] **Step 4: Build to verify WASM copy works**

Run: `npx tsup && ls dist/grammars/`
Expected: Five `.wasm` files listed

- [ ] **Step 5: Commit**

```bash
git add package.json tsup.config.ts pnpm-lock.yaml
git commit -m "feat: add web-tree-sitter and WASM grammar dependencies"
```

---

### Task 2: Parser Init and Language Detection

**Files:**
- Create: `src/parser/init.ts`
- Create: `src/parser/languages.ts`
- Test: `tests/parser/init.test.ts`
- Test: `tests/parser/languages.test.ts`

- [ ] **Step 1: Write failing test for language detection**

```typescript
// tests/parser/languages.test.ts
import { describe, it, expect } from "vitest";
import { detectLanguage, SUPPORTED_EXTENSIONS } from "../../src/parser/languages.js";

describe("detectLanguage", () => {
  it("detects TypeScript", () => {
    expect(detectLanguage("app.ts")).toBe("typescript");
    expect(detectLanguage("component.tsx")).toBe("typescript");
  });

  it("detects JavaScript", () => {
    expect(detectLanguage("index.js")).toBe("javascript");
    expect(detectLanguage("app.jsx")).toBe("javascript");
  });

  it("detects Python", () => {
    expect(detectLanguage("main.py")).toBe("python");
  });

  it("detects Go", () => {
    expect(detectLanguage("main.go")).toBe("go");
  });

  it("detects Rust", () => {
    expect(detectLanguage("lib.rs")).toBe("rust");
  });

  it("returns null for unsupported extensions", () => {
    expect(detectLanguage("style.css")).toBeNull();
    expect(detectLanguage("data.json")).toBeNull();
  });
});

describe("SUPPORTED_EXTENSIONS", () => {
  it("includes all supported file extensions", () => {
    expect(SUPPORTED_EXTENSIONS).toContain(".ts");
    expect(SUPPORTED_EXTENSIONS).toContain(".py");
    expect(SUPPORTED_EXTENSIONS).toContain(".go");
    expect(SUPPORTED_EXTENSIONS).toContain(".rs");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/parser/languages.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement language detection**

```typescript
// src/parser/languages.ts
import { extname } from "node:path";

export type Language = "typescript" | "javascript" | "python" | "go" | "rust";

const EXT_MAP: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXT_MAP);

export function detectLanguage(filePath: string): Language | null {
  const ext = extname(filePath);
  return EXT_MAP[ext] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/parser/languages.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for parser init**

```typescript
// tests/parser/init.test.ts
import { describe, it, expect } from "vitest";
import { getParser } from "../../src/parser/init.js";

describe("getParser", () => {
  it("returns a parser for typescript", async () => {
    const parser = await getParser("typescript");
    expect(parser).toBeDefined();
    expect(parser.getLanguage()).toBeDefined();
  });

  it("returns a parser for python", async () => {
    const parser = await getParser("python");
    expect(parser).toBeDefined();
  });

  it("returns a parser for go", async () => {
    const parser = await getParser("go");
    expect(parser).toBeDefined();
  });

  it("returns a parser for rust", async () => {
    const parser = await getParser("rust");
    expect(parser).toBeDefined();
  });

  it("reuses cached parser for same language", async () => {
    const p1 = await getParser("typescript");
    const p2 = await getParser("typescript");
    expect(p1).toBe(p2);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/parser/init.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement parser init**

```typescript
// src/parser/init.ts
import Parser from "web-tree-sitter";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Language } from "./languages.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let initialized = false;
const parserCache = new Map<Language, Parser>();

function grammarPath(lang: Language): string {
  // In dist: dist/grammars/tree-sitter-<lang>.wasm
  // In dev/test: node_modules/tree-sitter-wasms/out/tree-sitter-<lang>.wasm
  const distPath = resolve(__dirname, "grammars", `tree-sitter-${lang}.wasm`);
  const devPath = resolve(__dirname, "../../node_modules/tree-sitter-wasms/out", `tree-sitter-${lang}.wasm`);

  try {
    require.resolve(distPath);
    return distPath;
  } catch {
    return devPath;
  }
}

export async function getParser(lang: Language): Promise<Parser> {
  if (!initialized) {
    await Parser.init();
    initialized = true;
  }

  const cached = parserCache.get(lang);
  if (cached) return cached;

  const parser = new Parser();
  const langWasm = await Parser.Language.load(grammarPath(lang));
  parser.setLanguage(langWasm);
  parserCache.set(lang, parser);

  return parser;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/parser/init.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/parser/init.ts src/parser/languages.ts tests/parser/init.test.ts tests/parser/languages.test.ts
git commit -m "feat: add tree-sitter parser init and language detection"
```

---

### Task 3: Tree-sitter Queries

**Files:**
- Create: `src/parser/queries.ts`

- [ ] **Step 1: Create queries file**

```typescript
// src/parser/queries.ts
import type { Language } from "./languages.js";

// Tree-sitter S-expression queries to extract structural nodes
// Each language has queries for: functions, classes/types, imports

const TYPESCRIPT_QUERIES = {
  functions: `[
    (function_declaration name: (identifier) @name parameters: (formal_parameters) @params) @fn
    (method_definition name: (property_identifier) @name parameters: (formal_parameters) @params) @fn
    (arrow_function) @fn
    (export_statement declaration: (function_declaration name: (identifier) @name)) @export_fn
  ]`,
  classes: `[
    (class_declaration name: (type_identifier) @name) @class
    (interface_declaration name: (type_identifier) @name) @interface
    (type_alias_declaration name: (type_identifier) @name) @type
  ]`,
  imports: `(import_statement source: (string) @source) @import`,
  control: `[
    (if_statement) @if
    (for_statement) @for
    (for_in_statement) @for_in
    (while_statement) @while
    (switch_statement) @switch
    (try_statement) @try
    (return_statement) @return
  ]`,
};

const PYTHON_QUERIES = {
  functions: `[
    (function_definition name: (identifier) @name parameters: (parameters) @params) @fn
    (decorated_definition definition: (function_definition name: (identifier) @name)) @decorated_fn
  ]`,
  classes: `(class_definition name: (identifier) @name) @class`,
  imports: `[
    (import_statement) @import
    (import_from_statement module_name: (dotted_name) @source) @import
  ]`,
  control: `[
    (if_statement) @if
    (for_statement) @for
    (while_statement) @while
    (try_statement) @try
    (return_statement) @return
  ]`,
};

const GO_QUERIES = {
  functions: `[
    (function_declaration name: (identifier) @name parameters: (parameter_list) @params) @fn
    (method_declaration name: (field_identifier) @name parameters: (parameter_list) @params) @fn
  ]`,
  classes: `[
    (type_declaration (type_spec name: (type_identifier) @name)) @type
  ]`,
  imports: `(import_declaration) @import`,
  control: `[
    (if_statement) @if
    (for_statement) @for
    (return_statement) @return
  ]`,
};

const RUST_QUERIES = {
  functions: `[
    (function_item name: (identifier) @name parameters: (parameters) @params) @fn
  ]`,
  classes: `[
    (struct_item name: (type_identifier) @name) @struct
    (enum_item name: (type_identifier) @name) @enum
    (trait_item name: (type_identifier) @name) @trait
    (impl_item type: (type_identifier) @name) @impl
  ]`,
  imports: `(use_declaration) @import`,
  control: `[
    (if_expression) @if
    (for_expression) @for
    (loop_expression) @loop
    (match_expression) @match
    (return_expression) @return
  ]`,
};

const JAVASCRIPT_QUERIES = TYPESCRIPT_QUERIES;

export type QuerySet = {
  functions: string;
  classes: string;
  imports: string;
  control: string;
};

const QUERY_MAP: Record<Language, QuerySet> = {
  typescript: TYPESCRIPT_QUERIES,
  javascript: JAVASCRIPT_QUERIES,
  python: PYTHON_QUERIES,
  go: GO_QUERIES,
  rust: RUST_QUERIES,
};

export function getQueries(lang: Language): QuerySet {
  return QUERY_MAP[lang];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/parser/queries.ts
git commit -m "feat: add tree-sitter queries for TS, JS, Python, Go, Rust"
```

---

### Task 4: AST-to-IR Transformer

**Files:**
- Create: `src/parser/ast-ir.ts`
- Test: `tests/parser/ast-ir.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/parser/ast-ir.test.ts
import { describe, it, expect } from "vitest";
import { generateAstIR } from "../../src/parser/ast-ir.js";

describe("generateAstIR", () => {
  it("generates IR for TypeScript code", async () => {
    const code = `
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Config {
  name: string;
  enabled: boolean;
}

export function loadConfig(path: string): Config {
  const data = readFileSync(path, "utf-8");
  if (!data) return { name: "", enabled: false };
  return JSON.parse(data);
}

function validate(config: Config): boolean {
  if (!config.name) return false;
  return config.enabled;
}
`.trim();

    const ir = await generateAstIR(code, "config.ts");
    expect(ir).toContain("USE:");
    expect(ir).toContain("FN:loadConfig");
    expect(ir).toContain("FN:validate");
    expect(ir).toContain("IF:");
    expect(ir).toContain("RET");
    // IR should be significantly shorter than raw code
    expect(ir.length).toBeLessThan(code.length * 0.6);
  });

  it("generates IR for Python code", async () => {
    const code = `
import os
from pathlib import Path

class FileProcessor:
    def __init__(self, root: str):
        self.root = Path(root)

    def process(self, name: str) -> bool:
        path = self.root / name
        if not path.exists():
            return False
        return True

def main():
    processor = FileProcessor("/tmp")
    processor.process("test.txt")
`.trim();

    const ir = await generateAstIR(code, "processor.py");
    expect(ir).toContain("USE:");
    expect(ir).toContain("CLASS:FileProcessor");
    expect(ir).toContain("FN:process");
    expect(ir).toContain("FN:main");
    expect(ir.length).toBeLessThan(code.length * 0.6);
  });

  it("generates IR for Go code", async () => {
    const code = `
package main

import (
    "fmt"
    "os"
)

type Server struct {
    Port int
    Host string
}

func NewServer(host string, port int) *Server {
    return &Server{Host: host, Port: port}
}

func (s *Server) Start() error {
    if s.Port <= 0 {
        return fmt.Errorf("invalid port")
    }
    fmt.Printf("Starting on %s:%d", s.Host, s.Port)
    return nil
}
`.trim();

    const ir = await generateAstIR(code, "server.go");
    expect(ir).toContain("TYPE:Server");
    expect(ir).toContain("FN:NewServer");
    expect(ir).toContain("FN:Start");
    expect(ir.length).toBeLessThan(code.length * 0.6);
  });

  it("generates IR for Rust code", async () => {
    const code = `
use std::fs;
use std::path::Path;

pub struct Config {
    pub name: String,
    pub debug: bool,
}

impl Config {
    pub fn load(path: &Path) -> Result<Self, String> {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        if content.is_empty() {
            return Err("empty config".to_string());
        }
        Ok(Config { name: content, debug: false })
    }
}
`.trim();

    const ir = await generateAstIR(code, "config.rs");
    expect(ir).toContain("USE:");
    expect(ir).toContain("STRUCT:Config");
    expect(ir).toContain("IMPL:Config");
    expect(ir).toContain("FN:load");
    expect(ir.length).toBeLessThan(code.length * 0.6);
  });

  it("returns null for unsupported languages", async () => {
    const ir = await generateAstIR("body { color: red; }", "style.css");
    expect(ir).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/parser/ast-ir.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement AST-to-IR transformer**

```typescript
// src/parser/ast-ir.ts
import { getParser } from "./init.js";
import { detectLanguage } from "./languages.js";
import { getQueries } from "./queries.js";
import type Parser from "web-tree-sitter";

function nodeToIR(node: Parser.SyntaxNode, captureName: string, lang: string): string {
  const row = node.startPosition.row + 1;
  const indent = "  ".repeat(Math.floor(node.startPosition.column / 2));

  switch (captureName) {
    case "import":
      return `${indent}USE:${node.text.replace(/\n/g, " ").slice(0, 80)}`;
    case "fn":
    case "export_fn":
    case "decorated_fn": {
      const name = node.descendantsOfType("identifier")[0]?.text
        ?? node.descendantsOfType("field_identifier")[0]?.text
        ?? "anonymous";
      const params = node.descendantsOfType("formal_parameters")[0]?.text
        ?? node.descendantsOfType("parameters")[0]?.text
        ?? node.descendantsOfType("parameter_list")[0]?.text
        ?? "()";
      const prefix = captureName === "export_fn" ? "OUT " : "";
      const body = summarizeBody(node, lang);
      return `${indent}${prefix}FN:${name}${params}\n${body}`;
    }
    case "class":
    case "interface":
    case "type":
    case "struct":
    case "enum":
    case "trait":
    case "impl": {
      const typeName = node.descendantsOfType("type_identifier")[0]?.text
        ?? node.descendantsOfType("identifier")[0]?.text
        ?? "unknown";
      const label = captureName.toUpperCase();
      return `${indent}${label}:${typeName}`;
    }
    case "if":
      return `${indent}  IF:${extractCondition(node)}`;
    case "for":
    case "for_in":
    case "loop":
      return `${indent}  LOOP`;
    case "while":
      return `${indent}  WHILE:${extractCondition(node)}`;
    case "switch":
    case "match":
      return `${indent}  MATCH`;
    case "try":
      return `${indent}  TRY`;
    case "return": {
      const retVal = node.childCount > 1 ? node.child(1)?.text ?? "" : "";
      const short = retVal.length > 50 ? retVal.slice(0, 47) + "..." : retVal;
      return `${indent}  RET ${short}`.trimEnd();
    }
    default:
      return "";
  }
}

function extractCondition(node: Parser.SyntaxNode): string {
  // First child after keyword is usually the condition
  const cond = node.child(1);
  if (!cond) return "...";
  const text = cond.text.replace(/[()]/g, "").trim();
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}

function summarizeBody(fnNode: Parser.SyntaxNode, lang: string): string {
  const lines: string[] = [];
  const body = fnNode.descendantsOfType("statement_block")[0]
    ?? fnNode.descendantsOfType("block")[0]
    ?? fnNode;

  function walk(node: Parser.SyntaxNode) {
    const type = node.type;
    const indent = "  " + "  ".repeat(Math.max(0, Math.floor((node.startPosition.column - fnNode.startPosition.column) / 2)));

    if (type === "if_statement" || type === "if_expression") {
      lines.push(`${indent}IF:${extractCondition(node)}`);
    } else if (type === "for_statement" || type === "for_in_statement" || type === "for_expression") {
      lines.push(`${indent}LOOP`);
    } else if (type === "return_statement" || type === "return_expression") {
      const retVal = node.childCount > 1 ? node.child(1)?.text ?? "" : "";
      const short = retVal.length > 50 ? retVal.slice(0, 47) + "..." : retVal;
      lines.push(`${indent}RET ${short}`.trimEnd());
    } else if (type === "try_statement") {
      lines.push(`${indent}TRY`);
    }

    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i)!);
    }
  }

  walk(body);
  return lines.join("\n");
}

export async function generateAstIR(code: string, filePath: string): Promise<string | null> {
  const lang = detectLanguage(filePath);
  if (!lang) return null;

  const parser = await getParser(lang);
  const tree = parser.parse(code);
  const queries = getQueries(lang);
  const language = parser.getLanguage();

  const irParts: string[] = [];

  // Process imports
  try {
    const importQuery = language.query(queries.imports);
    const importMatches = importQuery.matches(tree.rootNode);
    for (const match of importMatches) {
      for (const capture of match.captures) {
        if (capture.name === "import" || capture.name === "source") {
          const ir = nodeToIR(capture.node, "import", lang);
          if (ir) irParts.push(ir);
          break;
        }
      }
    }
  } catch { /* query may not match */ }

  // Process classes/types
  try {
    const classQuery = language.query(queries.classes);
    const classMatches = classQuery.matches(tree.rootNode);
    for (const match of classMatches) {
      for (const capture of match.captures) {
        if (["class", "interface", "type", "struct", "enum", "trait", "impl"].includes(capture.name)) {
          const ir = nodeToIR(capture.node, capture.name, lang);
          if (ir) irParts.push(ir);
          break;
        }
      }
    }
  } catch { /* query may not match */ }

  // Process functions
  try {
    const fnQuery = language.query(queries.functions);
    const fnMatches = fnQuery.matches(tree.rootNode);
    for (const match of fnMatches) {
      for (const capture of match.captures) {
        if (["fn", "export_fn", "decorated_fn"].includes(capture.name)) {
          const ir = nodeToIR(capture.node, capture.name, lang);
          if (ir) irParts.push(ir);
          break;
        }
      }
    }
  } catch { /* query may not match */ }

  if (irParts.length === 0) return null;

  return irParts.filter(Boolean).join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/parser/ast-ir.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/parser/ast-ir.ts tests/parser/ast-ir.test.ts
git commit -m "feat: add AST-to-IR transformer for 5 languages"
```

---

### Task 5: Integrate AST-IR into Layer Generation

**Files:**
- Modify: `src/ir/layers.ts`
- Modify: `src/cli/commands.ts`

- [ ] **Step 1: Update L1 generation in layers.ts**

Add import at top of `src/ir/layers.ts`:

```typescript
import { generateAstIR } from "../parser/ast-ir.js";
```

Replace `generateL1`:

```typescript
export async function generateL1(code: string, filePath: string, health: HealthAnnotation | null): Promise<string> {
  // Try AST-based IR first, fall back to regex fingerprint
  const astIR = await generateAstIR(code, filePath);
  const ir = astIR ?? fingerprintFile(code, 0.6);
  if (health) {
    return annotateIR(ir, health);
  }
  return ir;
}
```

Update `generateLayer` to be async and pass filePath to L1:

```typescript
export async function generateLayer(
  layer: IRLayer,
  options: {
    code: string;
    filePath: string;
    health: HealthAnnotation | null;
    delta?: DeltaContext;
    lineRange?: { start: number; end: number };
  }
): Promise<string> {
  switch (layer) {
    case "L0":
      return generateL0(options.code, options.filePath);
    case "L1":
      return generateL1(options.code, options.filePath, options.health);
    case "L2":
      if (!options.delta) return generateL1(options.code, options.filePath, options.health);
      return generateL2(options.delta, options.health);
    case "L3":
      if (options.lineRange) {
        return generateL3(options.code, options.lineRange.start, options.lineRange.end);
      }
      return options.code;
  }
}
```

- [ ] **Step 2: Update callers to await generateLayer**

In `src/cli/commands.ts`, update `runIR`:

```typescript
export async function runIR(projectPath: string, filePath: string, layer: string): Promise<void> {
  // ... existing code ...
  const result = await generateLayer(irLayer, {
    code,
    filePath: relPath,
    health: health.churn > 0 ? health : null,
  });
  console.log(result);
}
```

Update `runBenchmark` — the `benchmarkFile` function in `src/benchmark/runner.ts` needs to become async:

In `src/benchmark/runner.ts`:

```typescript
export async function benchmarkFile(code: string, filePath: string): Promise<FileResult> {
  const rawTokens = estimateTokens(code);

  const irL0 = await generateLayer("L0", { code, filePath, health: null });
  const irL1 = await generateLayer("L1", { code, filePath, health: null });
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
```

In `src/cli/commands.ts`, update `runBenchmark`:

```typescript
export async function runBenchmark(projectPath: string): Promise<void> {
  // ... existing header code ...

  const results: FileResult[] = [];
  for (const file of files) {
    const code = readFileSync(file, "utf-8");
    const relPath = relative(projectPath, file);
    results.push(await benchmarkFile(code, relPath));
  }

  // ... rest unchanged ...
}
```

- [ ] **Step 3: Update index.ts to handle async commands**

In `src/index.ts`, update scan/trends/ir/benchmark cases to use await (wrap switch in async IIFE or top-level await):

```typescript
import { runScan, runTrends, runIR, runBenchmark, runBenchmarkQuality } from "./cli/commands.js";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "scan": {
    const projectPath = resolve(args[1] ?? ".");
    runScan(projectPath);
    break;
  }
  case "trends": {
    const projectPath = resolve(args[1] ?? ".");
    runTrends(projectPath);
    break;
  }
  case "ir": {
    const filePath = args[1];
    const layer = args[2] ?? "L1";
    if (!filePath) {
      console.error("Usage: composto ir <file> [L0|L1|L2|L3]");
      process.exit(1);
    }
    await runIR(resolve("."), resolve(filePath), layer);
    break;
  }
  case "benchmark": {
    const projectPath = resolve(args[1] ?? ".");
    await runBenchmark(projectPath);
    break;
  }
  case "benchmark-quality": {
    const filePath = args[1];
    if (!filePath) {
      console.error("Usage: composto benchmark-quality <file>");
      process.exit(1);
    }
    await runBenchmarkQuality(resolve("."), resolve(filePath));
    break;
  }
  case "version":
    console.log("composto v0.1.0");
    break;
  default:
    console.log("composto v0.1.0 — less tokens, more insight\n");
    console.log("Commands:");
    console.log("  scan [path]          Scan codebase for issues");
    console.log("  trends [path]        Analyze codebase health trends");
    console.log("  ir <file> [layer]    Generate IR for a file (L0|L1|L2|L3)");
    console.log("  benchmark [path]     Benchmark IR token savings");
    console.log("  benchmark-quality <file>  Compare AI responses: raw vs IR");
    console.log("  version              Show version");
    break;
}
```

- [ ] **Step 4: Update collectFiles to support new extensions**

In `src/cli/commands.ts`, update the scan and benchmark calls to include new extensions:

```typescript
const ALL_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs"];
```

Use `ALL_EXTENSIONS` in `runScan` and `runBenchmark` instead of the hardcoded array.

- [ ] **Step 5: Fix existing tests**

Update `tests/ir/layers.test.ts` — `generateLayer` is now async, so all calls need `await`:

Search and replace all `generateLayer(` with `await generateLayer(` and make test callbacks async.

Similarly update `tests/benchmark/runner.test.ts` — `benchmarkFile` is now async.

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Build and test benchmark**

Run: `npx tsup && node dist/index.js benchmark .`
Expected: Significantly higher L1 savings (target: >50% for source files)

- [ ] **Step 8: Commit**

```bash
git add src/ir/layers.ts src/cli/commands.ts src/benchmark/runner.ts src/index.ts tests/
git commit -m "feat: integrate AST-IR into layer generation with regex fallback"
```

---

### Task 6: Full Verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Build and benchmark**

Run: `npx tsup && node dist/index.js benchmark .`
Expected: L1 savings significantly improved

- [ ] **Step 3: Test IR on different languages**

Run:
```bash
node dist/index.js ir src/ir/fingerprint.ts L1
node dist/index.js ir src/parser/queries.ts L1
```
Expected: Clean, compact AST-based IR output

- [ ] **Step 4: Final commit if needed**
