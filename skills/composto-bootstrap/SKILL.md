---
name: composto-bootstrap
description: Use at the start of every session — initializes Composto proactive monitoring and Health-Aware IR capabilities
---

# Composto — Proactive AI Team Companion

You have access to Composto, a proactive codebase health tool. It provides:

1. **Health-Aware IR** — Compressed code representation enriched with health signals. Less tokens, more insight.
2. **Watcher Engine** — Detects security issues, debug artifacts, and code smells automatically.
3. **Trend Analysis** — Tracks codebase health over time: hotspots, decay, inconsistencies.

## Available Skills

- `composto-scan` — Scan the codebase for issues (security, console.log, etc.)
- `composto-trends` — Analyze codebase health trends from git history
- `composto-ir` — Generate Health-Aware IR for any file

## When to Use

- **Before writing code**: Run `composto-scan` to check for existing issues
- **Before refactoring**: Run `composto-trends` to find the areas that need it most
- **When sending code to LLM context**: Use `composto-ir` instead of raw source — 60-75% fewer tokens, more information

## Quick Start

When the user asks you to work on code, proactively:
1. Run a scan if you haven't already this session
2. Check trends for files you're about to modify
3. Use IR output when you need to understand file structure
