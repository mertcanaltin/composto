---
name: composto-trends
description: Analyze codebase health trends — find hotspots, decay signals, and inconsistencies. Use before refactoring or when investigating recurring bugs.
---

# Composto Trends

Analyze codebase health over time using git history. Zero LLM tokens — all analysis is local.

## How to Run

```bash
npx composto trends .
```

## What It Finds

### Hotspots
Files that change too often with too many bug fixes:
```
src/auth/session.ts — 12 changes, 67% fixes, 3 authors
```
This means: this file is a problem area. It keeps breaking and different people keep patching it differently.

### Decay Signals
Areas where churn is accelerating — more changes happening in recent time than before:
```
src/auth/session.ts — churn is declining
```
"Declining" means the health is declining (churn is increasing).

### Inconsistencies
Files where many different authors have made changes, potentially with different patterns:
```
src/auth/session.ts — 3 different patterns
```

## When to Use

- **Before refactoring**: Find which files actually need it most
- **Investigating recurring bugs**: Find the hotspot
- **Code review**: Check if the file being changed is in a problem area
- **Sprint planning**: Identify technical debt priorities

## After Running Trends

If a file shows up as a hotspot:
1. Use `composto-ir <file> L1` to see its Health-Aware IR with annotations
2. The IR will include tags like `[HOT:12/30 FIX:67%]` so any LLM working on it knows it's fragile
3. Consider recommending a refactor plan for that area
