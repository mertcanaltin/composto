# Composto

**Send meaning to your LLM, not code. 89% fewer tokens, same understanding.**

Composto parses your code into an AST, classifies every node by importance, and drops the noise. Your LLM gets the signal — function signatures, control flow, dependencies — without the braces, semicolons, and string literals it already knows.

```
Raw source:  3,782 tokens    →    Composto IR:  663 tokens (82.5% savings)

USE:[../types.js, ./structure.js, ./fingerprint.js, ./health.js]
OUT FN:generateL0(code: string, filePath: string)
    RET `${filePath}\n${declarations.join("\n")}`
OUT ASYNC FN:generateL1(code: string, filePath: string, health: HealthAnnotation...)
    IF:health → RET annotateIR(ir, health)
    RET ir
OUT FN:generateLayer(layer: IRLayer, options: {...})
    SWITCH:layer
        CASE:"L0" → RET generateL0(...)
        CASE:"L1" → RET generateL1(...)
        CASE:"L2" → RET generateL2(...)
        CASE:"L3" → RET options.code
```

---

## Quick Start

```bash
# Install
npm install -g composto-ai

# See how much you save
composto benchmark .

# Generate IR for a file
composto ir src/app.ts

# Smart context within a token budget
composto context src/ --budget 2000

# Historical blast radius for a file (beta, feature-flagged)
COMPOSTO_BLASTRADIUS=1 composto index
composto impact src/auth/login.ts
composto index --status
```

### MCP plugin (Claude Code, Cursor, Claude Desktop)

The MCP server is bundled inside `composto-ai`. Install the package globally first, then register the server with your client:

```bash
npm install -g composto-ai
```

**Claude Code:**

```bash
claude mcp add composto -- composto-mcp
```

**Cursor** — add to `~/.cursor/mcp.json` (or project-local `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "composto": {
      "command": "composto-mcp"
    }
  }
}
```

Then restart Cursor and verify under Settings → MCP that `composto` is green.

**Claude Desktop** — add the same block to `~/Library/Application Support/Claude/claude_desktop_config.json`.

Composto adds 5 tools to your AI assistant: `composto_ir`, `composto_benchmark`, `composto_context`, `composto_scan`, and `composto_blastradius` (the last one gated by `COMPOSTO_BLASTRADIUS=1` during beta).

---

## How It Works

Composto uses [tree-sitter](https://tree-sitter.github.io/) to parse your code into an AST, then walks every node and classifies it:

| Tier | Action | What | % of nodes |
|------|--------|------|-----------|
| **Tier 1** | Keep | imports, functions, classes, interfaces, types, enums | 0.8% |
| **Tier 2** | Summarize | if, for, while, switch, return, throw, try/catch | 0.9% |
| **Tier 3** | Compress | variable declarations → one-liner, await → kept | 6.9% |
| **Tier 4** | Drop | string contents, operators, punctuation, comments | **86.6%** |

86.6% of your code's AST nodes are noise. Composto drops them.

---

## Commands

```bash
# Benchmark token savings across your project
composto benchmark .

# Generate IR at different detail levels
composto ir <file> L0    # Structure map (~10 tokens) — just names
composto ir <file> L1    # Full IR — compressed code + health signals
composto ir <file> L2    # Delta context — only what changed
composto ir <file> L3    # Raw source — original code

# Smart context packing within a token budget
composto context <path> --budget <tokens>
# Fits maximum information into your budget:
# hotspot files get L1 (detailed), rest get L0 (structure)

# Scan for security issues and debug artifacts
composto scan .

# Analyze git history for health trends
composto trends .

# Compare LLM quality: raw code vs IR (requires ANTHROPIC_API_KEY)
composto benchmark-quality <file>

# Historical blast radius — beta, gated by COMPOSTO_BLASTRADIUS=1
composto index                 # bootstrap .composto/memory.db from git history
composto impact <file>         # risk verdict + signals for a file
composto index --status        # diagnostics: schema, freshness, calibration
```

---

## BlastRadius (beta)

Beyond compression, Composto indexes your repo's git history into a local SQLite graph and exposes it as a queryable risk surface. Before your agent edits a file, it can ask: *"has this region been reverted? does it have a fix cluster? is the last author still around?"* — signals no LLM can infer from current code alone.

Five signals per query: `revert_match`, `hotspot`, `fix_ratio`, `coverage_decline`, `author_churn`. Verdict is `low` / `medium` / `high` / `unknown`; when confidence is low the tool returns `unknown` rather than guessing. Precision is repo-calibrated (self-validation on every N=500 commits).

```
verdict:    high
score:      1.00
confidence: 0.30
signals:
  revert_match       ■■■■■■■■■■ strength=1.00 precision=0.50
  hotspot            ·          strength=0.00 precision=0.30
  ...
```

**v1 ship gate** on this repo: precision 93.9%, recall 100% on the `medium|high` band. Multi-repo validation pending. See [docs/blastradius-proof.md](docs/blastradius-proof.md) for the method + honest caveats.

Feature-flagged via `COMPOSTO_BLASTRADIUS=1` during the beta. Available as both CLI (`composto impact`, `composto index`) and MCP tool (`composto_blastradius`).

---

## Quality Proof

We tested 4 files from simple to hard. Same question, raw code vs IR: "What does this file do?"

| File | Complexity | Raw Tokens | IR Tokens | Savings | Comprehension |
|------|-----------|-----------|----------|---------|--------------|
| hotspot.ts | Simple | 299 | 77 | 74.2% | Full |
| layers.ts | Medium | 765 | 249 | 67.5% | Full |
| detector.ts | Medium | 704 | 160 | 77.3% | Full |
| ast-walker.ts | **Hard (448 lines)** | 3,782 | 663 | 82.5% | ~90% |

Even on a 448-line recursive AST walker with nested switches, an LLM can fully explain the architecture, all 12 functions, and the data flow from the IR alone.

**What IR preserves:** function signatures, parameter types, imports, control flow, return values, class/interface declarations.

**What IR drops:** string contents, regex patterns, operator details, formatting — things the LLM already knows.

Full benchmark: [docs/benchmark-proof.md](docs/benchmark-proof.md)

---

## IR Layers

| Layer | Tokens | Use case |
|-------|--------|----------|
| **L0** | ~10 | "What's in this file?" — just function/class names |
| **L1** | ~85 | "What does this file do?" — compressed code + health signals |
| **L2** | ~65 | "What changed?" — git diff with context |
| **L3** | variable | "Show me the exact code" — raw source |

### When to use which

```
"Explain the architecture"     → L1 for all files
"Fix this bug"                 → L3 for target file, L1 for context
"Review this PR"               → L2 for changed files, L1 for context
"What files are in this repo?" → L0 for everything
```

---

## Health-Aware IR

Composto analyzes git history and embeds health signals directly into IR:

```
FN:handleAuth({credentials}) [HOT:15/30 FIX:73% COV:↓ INCON]
  IF:!session → RET 401
  RET { token, expiresAt }
```

- `[HOT:15/30]` — 15 changes in last 30 commits (hotspot)
- `[FIX:73%]` — 73% of changes were bug fixes
- `[COV:↓]` — Test coverage declining
- `[INCON]` — Inconsistent patterns from multiple authors

Only unhealthy code gets annotated. Healthy files stay clean.

---

## Context Budget

Don't guess which files to send. Let Composto decide:

```bash
composto context src/ --budget 2000
```

Output:
```
== L1 (detailed) ==
[hotspot] src/auth/login.ts
  USE:[./types.js, ./session.js]
  OUT ASYNC FN:login(credentials)
    TRY
      IF:!valid → THROW:AuthError
      RET { token, user }

== L0 (structure) ==
src/utils/helpers.ts
  FN:formatDate L5
  FN:parseQuery L23
...

Budget: 1994/2000 tokens
Files: 9 at L1, 16 at L0
```

Hotspot files get full detail. Everything else gets structure. Budget is never exceeded.

---

## Stats

```
Overall compression: 89.2%
L0 compression:      97.5%
AST engine:          51/51 files (0 regex fallback)
Languages:           TypeScript, JavaScript, Python, Go, Rust
Tests:               224 passing
BlastRadius v1:      precision 90-96%, recall 99-100% on 3 repos
                     (composto, picomatch, zod; medium|high band)
```

---

## Configuration

Optional `.composto/config.yaml`:

```yaml
watchers:
  security:
    enabled: true
    severity:
      "src/**": warning
      "tests/**": info
  consoleLog:
    enabled: true

trends:
  enabled: true
  hotspotThreshold: 10
  bugFixRatioThreshold: 0.5
```

All settings have sensible defaults. The config file is optional.

---

## Contributing

```bash
git clone https://github.com/mertcanaltin/composto
cd composto
pnpm install
pnpm test        # 145 tests
pnpm build       # builds to dist/
npx composto benchmark .  # see compression stats
```

---

## License

MIT
