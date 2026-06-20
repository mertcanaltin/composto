# Composto

**Token-efficient code context for AI agents. Your file's full structure in a fraction of the tokens, with its causal history baked in.**

Composto compresses any source file into a Health-Aware IR that keeps exactly what your agent needs — signatures, types, control flow, dependencies — at 60-95% fewer tokens than raw code. On top of that, it surfaces the file's causal history (what historically changed and broke alongside the code you're touching) as advisory context. Local-first, MIT. Works with Claude Code, Cursor, and Gemini CLI.

```
$ composto ir src/memory/confidence.ts L1

USE:./types.js
OUT INTERFACE:ConfidenceContext
OUT INTERFACE:ScoreAndConfidence
FN:calibrationFactor(signals: Signal[])
      GUARD:[firing.length === 0 → 1.0, avg < 20 → 0.3, avg < 100 → 0.6]
FN:historyFactor(totalCommits: number)
      GUARD:[totalCommits < 50 → 0.2, totalCommits < 200 → 0.5, totalCommits < 1000 → 0.8]
OUT FN:computeScoreAndConfidence(signals: Signal[], ctx: ConfidenceContext)

# 541 tokens of raw code → 230 tokens of IR (57% fewer). Structure intact:
# every signature, dependency, and decision threshold survives.
```

---

## Quick Start

```bash
# Install
npm install -g composto-ai

# One-command setup, wires MCP + PreToolUse hook into your AI client
cd your-project
composto init --client=claude-code     # or cursor, or gemini-cli

# Restart your AI client. Hook fires on every Edit / Write / MultiEdit.
# On medium|high|unknown verdicts, the agent gets a composto_blastradius
# block in context before it acts. Passthrough on low.

# Observe
composto stats              # hook invocations, verdict distribution, latency
composto stats --disable    # local-only opt-out (writes .composto/telemetry-disabled)

# Query on demand
composto impact src/auth/login.ts
composto index --status     # diagnostics: schema, freshness, calibration
```

### The core: token-efficient structural context

Composto's spine is a tree-sitter based AST compressor and a smart context packer. Compress any file to IR, or pack a whole directory into a token budget:

```bash
composto ir src/app.ts                 # compress a file to IR (L0/L1/L2/L3)
composto context src/ --budget 2000    # smart context within a token budget
composto benchmark .                   # see compression stats
```

See the [IR Layers](#ir-layers), [Health-Aware IR](#health-aware-ir), and [Context Budget](#context-budget) sections below for details.

### On top: causal history as advisory context

Composto also indexes your git history and surfaces what historically changed and broke alongside the file you're editing — advisory context the agent weighs, not a gate. See [Causal context](#causal-context) below.

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

#### Cursor: one-command setup

Registering the MCP server only *exposes* the tools — Cursor's agent often defaults to its built-in `read_file` / `codebase_search`. To configure both the MCP server **and** a project rule that tells the agent when to call Composto, run:

```bash
cd your-project
composto init
```

This writes `.cursor/mcp.json` (project-local MCP registration) and `.cursor/rules/composto.mdc` (an `alwaysApply: true` rule that gets injected into every conversation). Existing files are merged, never overwritten. Restart Cursor and check Settings → MCP that `composto` is green.

Without the rule, hit rate is ~30-50%; with it, ~85-95%. The rule template is embedded in [`src/cli/init.ts`](src/cli/init.ts) (`CURSOR_RULES_MDC`) — open the generated `.cursor/rules/composto.mdc` to customize per-project.

#### Hook-enforced injection (v0.6.0+)

Instead of asking the agent to remember to call `composto_blastradius`, wire a hook so it gets consulted **automatically** before every Edit / Write / MultiEdit. The agent receives a `<composto_blastradius>` context block in-line when verdict is `medium` or `high` — you don't do anything, the warning just shows up where it's needed.

```bash
cd your-project
composto init --client=claude-code    # or cursor, or gemini-cli
```

This writes:
- The platform's MCP config (same as before)
- A **`PreToolUse` hook** (Claude Code / Gemini CLI) that invokes `composto hook <platform> pretooluse` on every file-targeting tool call. The hook extracts the target file, runs `composto_blastradius`, and injects the verdict as `additionalContext`. Passthrough on `low` verdict — no noise.
- For Cursor: a `.cursor/hooks.json` entry that **denies** the tool call on `verdict: high` (Cursor's `additional_context` is dropped per [forum #155689](https://forum.cursor.com/t/...), so hybrid strategy — the existing `.cursor/rules/composto.mdc` rule carries `medium`/`low`, the hook only interrupts on `high`).

Existing settings are merged, never overwritten. Re-running `composto init` is idempotent — no duplicate hook entries.

**Observe what's happening:**

```bash
composto stats            # hook invocations, verdict distribution, p50/p95 latency
composto stats --json     # machine-readable
composto stats --disable  # opt out (writes .composto/telemetry-disabled marker)
```

Telemetry is **local-only** — writes to `.composto/memory.db` in your repo, nothing leaves your machine. No user ID, no cloud sync, no account.

**Platform matrix:**

| Platform | MCP | Hook | Strategy |
|---|:---:|:---:|---|
| Claude Code | ✅ | ✅ `PreToolUse` | `additionalContext` on medium\|high\|unknown, passthrough on low |
| Cursor | ✅ | ✅ `preToolUse` | Deny-on-high via `permissionDecision`; medium/low via `.mdc` rule |
| Gemini CLI | ✅ | ✅ `BeforeTool` | `additionalContext` on medium\|high\|unknown |
| Claude Desktop | ✅ | — | MCP-only (no hook API yet) |

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

## Causal context

On top of compression, Composto indexes your repo's git history into a local SQLite graph and surfaces what the current code can't tell you: *"has this region been reverted? does it have a fix cluster? what files historically changed and broke alongside it?"* — context no LLM can infer from the file alone. It's delivered as **advisory context the agent weighs**, not a hard gate.

Signals per query: `revert_match`, `hotspot`, `fix_ratio`, `author_churn`, `cochange`. The tool returns `unknown` when confidence is low rather than guessing.

```
$ composto impact src/auth/login.ts

revert_match   ■■■■■■■■■■ this file was touched by a Revert commit
cochange       ■■■■■      historically co-changed with session.ts, token.ts in fixes
hotspot        ■          14 changes in the last 90 days
```

**Where we are, honestly.** A 4-repo time-travel backtest (fastify, express, got, flask — each rewound to pre-fix snapshots) shows the causal layer is a **high-recall, advisory-grade** signal: on mature repos it recovers 67-80% of the files a fix actually touches. Precision is modest (~0.55) — these signals point you at *candidates*, they don't certify them, which is exactly why Composto surfaces them as context for the agent to judge rather than as a blocking verdict. Recall scales with git history, so the value grows as your repo matures (a young repo gets little until it accumulates fix history).

The honest framing: **causal context is a high-recall memory layer agents consult before editing** — "these files have a history of breaking together" — not a precision gate. The compression core works unconditionally; the causal layer adds repo-specific memory on top.

Available as CLI (`composto impact`, `composto index`) and MCP tool (`composto_blastradius`, gated by `COMPOSTO_BLASTRADIUS=1` during beta).

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
L1 compression:      ~81% fewer tokens (full IR, structure preserved)
L0 compression:      ~97% fewer tokens (structure map)
Token counts:        verified against a real BPE tokenizer, not estimates
AST engine:          AST-parsed, 0 regex fallback
Languages:           TypeScript, JavaScript, Python, Go, Rust
Causal layer:        high-recall advisory (0.67-0.80 recall on mature repos,
                     time-travel backtest across 4 public repos); precision
                     ~0.55, surfaced as context not a gate.
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
