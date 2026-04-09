---
name: composto-ir
description: Generate Health-Aware IR for any file — compressed code representation with health signals. Use when you need to understand or share file context with minimal tokens.
---

# Composto IR — Health-Aware Intermediate Representation

Generate compressed, health-annotated code representation. Send meaning, not code.

## How to Run

```bash
# L0: Structure Map (~10 tokens) — just file outline
npx composto ir <file> L0

# L1: Health-Aware Generic IR (~85 tokens) — compressed code + health
npx composto ir <file> L1

# L2: Delta Context (~65 tokens) — only what changed + health
npx composto ir <file> L2

# L3: Raw Source — original code (fallback)
npx composto ir <file> L3
```

## Layer Selection Guide

| Need | Layer | Tokens |
|---|---|---|
| "What's in this file?" | L0 | ~10 |
| "What does this file do?" | L1 | ~85 |
| "What changed recently?" | L2 | ~65 |
| "Show me the exact code" | L3 | variable |

## Reading the Output

### L0 — Structure Map
```
src/auth/session.ts
  FN:createSession L5
  FN:validateToken L23
  CLASS:SessionManager L45
```

### L1 — Health-Aware IR
```
USE:jsonwebtoken{sign,verify}
FN:createSession({credentials}) [HOT:12/30 FIX:67% COV:↓ INCON]
  VAR:token = sign(credentials, secret)
  RET {token, expiresAt}
```

Health annotations (only on unhealthy code):
- `[HOT:12/30]` — 12 changes in last 30 commits (hotspot)
- `[FIX:67%]` — 67% of changes were bug fixes
- `[COV:↓]` — test coverage declining
- `[INCON]` — inconsistent patterns from multiple authors

## When to Use

- **Instead of reading full files**: L1 gives you the meaning in 75% fewer tokens
- **When providing context to other LLM calls**: Send IR instead of raw source
- **When explaining code to the user**: L0 for overview, L1 for detail
- **When a file has health issues**: IR includes the health context automatically

## The Key Insight

Raw source code wastes tokens on syntax, indentation, and boilerplate that LLMs already know. Health-Aware IR strips the noise and adds health signals that raw source never had. **Less tokens, more insight.**
