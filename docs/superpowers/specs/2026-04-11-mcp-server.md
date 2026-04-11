# Composto MCP Server

**Date:** 2026-04-11
**Author:** Mert Can Altin + Claude (Principal Engineer)
**Status:** Design approved, ready for implementation planning

---

## Problem

Composto is CLI-only. Users must open a terminal, learn commands, run them manually. This limits adoption to developers who actively seek out CLI tools. Meanwhile, MCP plugins reach users through marketplace discovery — zero friction, one-click install.

Context Mode reached 73.8K users this way. Composto has better compression (AST-based, 89% real savings vs retrieval-based) but no distribution channel.

## Solution

Ship Composto as an MCP server alongside the existing CLI. One npm package, two entry points:
- `composto` — CLI (existing)
- `composto-mcp` — MCP server (new)

## Architecture

### Entry Points

```
composto-ai (npm)
├── dist/index.js        ← CLI entry (existing, unchanged)
├── dist/mcp-server.js   ← MCP server entry (new)
├── grammars/            ← tree-sitter WASM files
└── package.json
     bin:
       composto: dist/index.js
       composto-mcp: dist/mcp-server.js
```

### MCP Server (`src/mcp/server.ts`)

Single file. Uses `@modelcontextprotocol/sdk` to create a stdio-based MCP server. Imports existing Composto modules for IR generation, benchmarking, scanning, and context packing.

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
```

### 4 Tools

**`composto_ir`** — Generate IR for a file

```
Input:  { file: string, layer?: "L0"|"L1"|"L2"|"L3" }
Output: text content with IR string
```

Reads the file, detects language, runs AST walker (or fingerprint fallback), returns compressed IR. This is the core tool — agents call this instead of `Read` when they need to understand a file without consuming full tokens.

Implementation: calls `generateLayer()` from `src/ir/layers.ts`.

**`composto_benchmark`** — Benchmark token savings

```
Input:  { path?: string }
Output: text content with benchmark table
```

Runs `benchmarkFile()` on all files in the path, returns formatted table with raw/L0/L1/savings/engine per file and totals.

Implementation: calls `benchmarkFile()` and `summarize()` from `src/benchmark/runner.ts`.

**`composto_context`** — Smart context within token budget

```
Input:  { path?: string, budget?: number }
Output: text content with packed context (L1 for hotspots, L0 for rest)
```

Collects files, detects hotspots from git history, packs maximum information into the token budget.

Implementation: calls `packContext()` from `src/context/packer.ts`.

**`composto_scan`** — Scan for security issues

```
Input:  { path?: string }
Output: text content with findings
```

Runs detectors (security, console.log) on all files, returns findings with severity and location.

Implementation: calls `runDetector()` from `src/watcher/detector.ts`.

### Installation

**Claude Code:**
```bash
claude mcp add composto -- npx composto-mcp
```

**Claude Desktop / any MCP client:**
```json
{
  "mcpServers": {
    "composto": {
      "command": "npx",
      "args": ["composto-mcp"]
    }
  }
}
```

**Global install (faster startup):**
```bash
npm install -g composto-ai
claude mcp add composto -- composto-mcp
```

### Build Changes

Add second entry point to `tsup.config.ts`:

```typescript
entry: ['src/index.ts', 'src/mcp/server.ts']
```

Add second bin to `package.json`:

```json
"bin": {
  "composto": "dist/index.js",
  "composto-mcp": "dist/mcp-server.js"
}
```

MCP server file must have `#!/usr/bin/env node` shebang.

### New Dependency

```
@modelcontextprotocol/sdk: ^1.26.0
```

Single new dependency. No other changes to existing deps.

## Files

| File | Action | What |
|------|--------|------|
| `src/mcp/server.ts` | **Create** | MCP server with 4 tools |
| `tsup.config.ts` | Modify | Add mcp-server entry point |
| `package.json` | Modify | Add composto-mcp bin, add MCP SDK dep |
| `tests/mcp/server.test.ts` | **Create** | Tests for MCP tool handlers |

## Success Criteria

- `npx composto-mcp` starts and responds to MCP protocol
- `claude mcp add composto -- npx composto-mcp` works
- All 4 tools callable from Claude Code
- `composto_ir` returns valid IR for TypeScript files
- `composto_context` respects budget
- Existing CLI unchanged, all 145 tests still pass
- npm publish includes mcp-server.js in dist/

## Out of Scope

- Hook interceptor (v2)
- Claude Code marketplace listing (manual submission after ship)
- Session continuity
- Platform-specific adapters (Cursor, VS Code, etc.)
