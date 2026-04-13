# composto-mcp

MCP (Model Context Protocol) server entrypoint for [Composto](https://composto.io).

This is a thin shim that re-exports the MCP server from `composto-ai`, so you can run it without a global install:

```bash
claude mcp add composto -- npx composto-mcp
```

## What it does

Composto parses your code into an AST, classifies each node by structural importance, and emits a compressed Intermediate Representation (IR). Your LLM sees the meaning, not the syntax, with up to 89% fewer tokens.

This package exposes 4 MCP tools:

- `composto_ir` — generate compressed IR for a file
- `composto_benchmark` — token savings report for a directory
- `composto_context` — pack files into a token budget (supports `--target`)
- `composto_scan` — security and code smell detection

## Full CLI

For the full command-line tool (benchmark, ir, scan, trends, context), install the main package:

```bash
npm install -g composto-ai
```

## Docs

- Website: https://composto.io
- Documentation: https://composto.io/docs
- Source: https://github.com/mertcanaltin/composto
