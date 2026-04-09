# Composto

**Proactive AI team companion — less tokens, more insight.**

Every AI coding tool sends raw source code to LLMs. Composto sends **meaning** — compressed code enriched with codebase health data. The result: fewer tokens carrying more information than raw source ever could.

---

## What Makes It Different

| | Traditional AI Tools | Composto |
|---|---|---|
| **Paradigm** | Reactive (you ask, it does) | Proactive (it finds, you approve) |
| **What LLM sees** | Raw source code | Health-Aware IR |
| **Token usage** | Full files every time | 60-75% savings |
| **Health context** | None | Hotspots, decay, inconsistencies |
| **Codebase monitoring** | None | Watcher Engine |

### Health-Aware IR

Raw source tells the LLM *what* the code says. Composto IR tells it *what the code means* and *how healthy it is*:

```
// Raw source: 340 tokens, zero health context
import { useState, useEffect } from "react";
export function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetchUser(userId).then(...) }, [userId]);
  if (loading) return <Spinner />;
  if (!user) return <NotFound />;
  return <div>{user.name}</div>;
}

// Composto IR: 85 tokens + health context
USE:react{useState,useEffect}
OUT FN:UserProfile({userId}) [HOT:12/30 FIX:67% COV:↓ INCON]
  VAR:user = useState(null)
  VAR:loading = useState(true)
  IF:loading -> RET <Spinner />
  IF:!user -> RET <NotFound />
  RET <div>{user.name}</div>
```

The LLM sees less, knows more, decides better.

---

## Installation

### Claude Code

```
/plugin install composto
```

### Cursor

```
/add-plugin composto
```

### Any platform (CLI)

```bash
npm install -g composto
```

---

## Usage

### CLI Commands

```bash
# Scan codebase for issues
composto scan .

# Analyze codebase health trends
composto trends .

# Generate Health-Aware IR for a file
composto ir src/auth/login.ts L1

# Layer options:
#   L0 — Structure map (~10 tokens)
#   L1 — Health-Aware IR (~85 tokens)
#   L2 — Delta context (~65 tokens)
#   L3 — Raw source (fallback)
```

### As a Plugin

Once installed, Composto activates automatically. Your AI agent will:

1. **Scan** the codebase for issues before starting work
2. **Check trends** for files being modified
3. **Use IR** instead of raw source when sharing code context

No commands needed — it just works.

---

## What It Does

### IR Engine — Send meaning, not code

Four layers of code representation, from most compact to full source:

| Layer | Tokens | Use |
|---|---|---|
| L0: Structure Map | ~10 | File outline — functions, classes, line numbers |
| L1: Health-Aware IR | ~85 | Compressed code + health annotations |
| L2: Delta + Context | ~65 | Only what changed, with surrounding context |
| L3: Raw Source | variable | Original code, specific lines only |

No AST parser. No language-specific dependencies. Works with TypeScript, JavaScript, Python, Go, and more.

### Watcher Engine — Proactive issue detection

Detects problems without being asked:

- **Security** — Hardcoded secrets, API keys, tokens
- **Debug artifacts** — `console.log`, `console.debug` left in source
- **Context-aware severity** — Same issue, different severity in `src/` vs `tests/`

### Trend Analysis — Codebase health over time

Analyzes git history to find:

- **Hotspots** — Files that change too often with too many bug fixes
- **Decay signals** — Areas where churn is accelerating
- **Inconsistencies** — Files touched by many authors with conflicting patterns

All trend analysis is zero-token — pure local git analysis.

### Health Annotations — The killer feature

IR Engine and Trend Analysis are not separate systems. Health data is embedded directly into code representation:

```
FN:handleAuth({credentials}) [HOT:15/30 FIX:73% COV:↓ INCON]
  VAR:session = createSession(credentials)
  IF:!session -> RET 401
```

- `[HOT:15/30]` — 15 changes in last 30 commits
- `[FIX:73%]` — 73% of changes were bug fixes
- `[COV:↓]` — Test coverage declining
- `[INCON]` — Inconsistent patterns from multiple authors

Only unhealthy code gets annotated. Healthy files stay clean.

---

## Architecture

```
+----------------------------------------------+
|           Platform Adapters                   |
|     Claude Code | VS Code | Cursor | CLI     |
+----------------------------------------------+
|              Watcher Engine                   |
|  Detector (0 token) -> Interpreter (~100 tok) |
|  + Trend Analysis (hotspots, decay, incon.)   |
+----------------------------------------------+
|              IR Engine                        |
|  Indentation Intel | Fingerprinting | Delta   |
|  + Health Annotations (from Trend Analysis)   |
+----------------------------------------------+
|          Rule-Based Router                    |
|  Deterministic routing, zero tokens           |
+----------------------------------------------+
|           Agent Pool                          |
|  Fixer (Haiku) | Reviewer (Sonnet)            |
+----------------------------------------------+
|          Project Memory                       |
|  .composto/config.yaml | decisions/*.md       |
+----------------------------------------------+
```

---

## Configuration

Create `.composto/config.yaml` in your project root:

```yaml
watchers:
  security:
    enabled: true
    severity:
      "src/**": warning
      "tests/**": info
  consoleLog:
    enabled: true
    severity:
      "src/**": warning
      "tests/**": info

agents:
  fixer:
    enabled: true
    model: haiku

ir:
  deltaContextLines: 3
  confidenceThreshold: 0.6
  genericPatterns: default

trends:
  enabled: true
  hotspotThreshold: 10
  bugFixRatioThreshold: 0.5
  decayCheckTrigger: on-commit
  fullReportSchedule: weekly
```

All settings have sensible defaults. The config file is optional.

---

## How It Works

```
1. Developer saves src/auth/login.ts
        |
2. Watcher Engine triggers (debounced)
        |
3. Detector: pattern match → "hardcoded secret, line 23" (0 tokens)
        |
4. IR Engine: generates Health-Aware IR + annotations (0 tokens)
        |
5. Router: severity=critical → route to Fixer (0 tokens)
        |
6. Fixer: generates fix via IR, not full source (~150 tokens)
        |
7. User: "login.ts:23 has a hardcoded secret.
          You added it for debugging. Move to .env?"
        |
8. User approves → patch applied

Total cost: ~250 tokens. Traditional tools: ~3000+ tokens.
```

---

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **Testing:** Vitest (70 tests)
- **Build:** tsup
- **Zero native dependencies** — no tree-sitter, no language-specific parsers

---

## Roadmap

### v0.5 — Usable Alpha
- Watcher Interpreter (batch Haiku calls for contextual explanations)
- Reviewer Agent (Sonnet, code review with challenge mode)
- Project Memory (decisions/ with YAML frontmatter)
- Python + Go language support

### v1.0 — Public Release
- Framework-specific fingerprint patterns (React, Express, etc.)
- VS Code / Cursor / Claude Code deep integrations
- Benchmark results: Health-Aware IR vs raw source

### v2.0 — Platform
- Security / Architect agents
- Custom Agent API
- Team sync features

---

## Contributing

```bash
git clone https://github.com/mertcanaltin/composto
cd composto
pnpm install
pnpm test        # 70 tests
pnpm build       # builds to dist/
pnpm dev scan .  # run locally
```

---

## License

MIT
