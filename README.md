# Composto

**A fast structural map of your codebase, for AI agents. Your file's full structure in a fraction of the tokens.**

> Send your agent the structure, not the noise.

Composto compresses any source file into a structural IR that keeps exactly what your agent needs, signatures, types, control flow, dependencies, at 60-95% fewer tokens than raw code. Spread across a repo and kept fresh, that IR becomes a navigation map your agent reads instead of blindly opening files. Local-first, MIT. Works with Claude Code, Cursor, and Gemini CLI.

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

## Use it in 3 steps

```bash
# 1. See what your repo costs an AI, zero install, no API key, ~2s
cd your-project
npx composto-ai score          # scorecard: tokens, $/load, a README badge

# 2. Install
npm install -g composto-ai

# 3. Wire it into your AI agent so it gets compact context automatically
composto init --client=claude-code    # or cursor, or gemini-cli
# Restart your client. Existing settings are merged, never overwritten.
```

That's it. On Claude Code, large code Reads are auto-replaced with structure-preserving IR before they hit the agent's context, saving tokens on every turn (see `composto stats`).

<details>
<summary>More commands</summary>

```bash
composto score .                       # shareable scorecard + README badge (add --json to pipe)
composto ir src/app.ts                 # compress one file to IR (L0/L1/L2/L3)
composto context src/ --budget 4000    # pack a directory's map into a token budget
composto context . --target <symbol>   # target file raw, surroundings as IR
composto context . --json              # machine-readable context for piping into agents
composto reindex .                     # write the navigation map to .composto/context.md
composto start .                       # keep the map live: file watcher auto-refreshes it
composto proxy --port 8787             # compression proxy, point your LLM base URL at it
composto stats                         # cumulative tokens saved by the compress hook
```
</details>

### The core: a token-efficient structural map

Composto's spine is a tree-sitter based AST compressor and a smart context packer. Compress any file to IR, or pack a whole directory into a token budget:

```bash
composto ir src/app.ts                 # compress a file to IR (L0/L1/L2/L3)
composto context src/ --budget 2000    # smart context within a token budget
composto benchmark .                   # see compression stats
```

See the [IR Layers](#ir-layers), [Health-Aware IR](#health-aware-ir), and [Context Budget](#context-budget) sections below for details.

### MCP plugin (Claude Code, Cursor, Claude Desktop)

The MCP server is bundled inside `composto-ai`. Install the package globally first, then register the server with your client:

```bash
npm install -g composto-ai
```

**Claude Code:**

```bash
claude mcp add composto -- composto-mcp
```

**Cursor** , add to `~/.cursor/mcp.json` (or project-local `.cursor/mcp.json`):

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

**Claude Desktop** , add the same block to `~/Library/Application Support/Claude/claude_desktop_config.json`.

Composto adds 3 tools to your AI assistant: `composto_ir`, `composto_context`, and `composto_benchmark`.

#### Cursor: one-command setup

Registering the MCP server only *exposes* the tools, Cursor's agent often defaults to its built-in `read_file` / `codebase_search`. To configure both the MCP server **and** a project rule that tells the agent when to call Composto, run:

```bash
cd your-project
composto init --client=cursor --with-rules
```

This writes `.cursor/mcp.json` (project-local MCP registration) and `.cursor/rules/composto.mdc` (an `alwaysApply: true` rule injected into every conversation). Existing files are merged, never overwritten. Restart Cursor and check Settings → MCP that `composto` is green.

Without the rule, hit rate is ~30-50%; with it, ~85-95%. The rule template lives in [`src/cli/init.ts`](src/cli/init.ts) (`CURSOR_RULES_MDC`).

#### Hook-enforced compression (Claude Code)

The primary integration. Instead of asking the agent to remember to compress, wire a `PostToolUse` hook so every large code `Read` is transparently swapped for IR before it enters the agent's context, a real, compounding token saving on every subsequent turn.

```bash
cd your-project
composto init --client=claude-code            # compress hook on by default
composto init --client=claude-code --with-mcp # also register the MCP server
```

Ranged reads stay raw, and any file where IR is not a clear win falls back to the source. The hook never blocks the agent. Existing settings are merged and re-running is idempotent.

**Observe what's happening:**

```bash
composto stats            # cumulative tokens saved + reads compressed
composto stats --json     # machine-readable
composto stats --disable  # opt out (writes .composto/telemetry-disabled marker)
```

Telemetry is **local-only**, a flat `.composto/savings.json` counter in your repo. Nothing leaves your machine. No user ID, no cloud sync, no account.

**Platform matrix:**

| Platform | MCP | Compress hook |
|---|:---:|:---:|
| Claude Code | ✅ | ✅ `PostToolUse` on `Read` |
| Cursor | ✅ | , (MCP-only) |
| Gemini CLI | ✅ | , (MCP-only) |
| Claude Desktop | ✅ | , (MCP-only) |

---

## How It Works

Composto uses [tree-sitter](https://tree-sitter.github.io/) to parse your code into an AST, then walks every node and classifies it:

| Tier | Action | What | % of nodes |
|------|--------|------|-----------|
| **Tier 1** | Keep | imports, functions, classes, interfaces, types, enums | 0.8% |
| **Tier 2** | Summarize | if, for, while, switch, return, throw, try/catch | 0.9% |
| **Tier 3** | Compress | variable declarations → one-liner, await → kept | 6.9% |
| **Tier 4** | Drop | string contents, operators, punctuation, comments | **86.6%** |

86.6% of your code's AST nodes are noise. Composto drops them. Languages without a tree-sitter grammar fall back to a grammar-free structural extractor, so braced languages (C/C++/Java and friends) still get a map.

---

## Commands

```bash
# Shareable scorecard: AI context cost + a README badge
composto score .              # add --json to pipe into scripts/agents

# Generate IR at different detail levels
composto ir <file> L0    # Structure map (~10 tokens), just names
composto ir <file> L1    # Full IR, compressed code + health signals
composto ir <file> L2    # Delta context, only what changed
composto ir <file> L3    # Raw source, original code

# Smart context packing within a token budget
composto context <path> --budget <tokens>
# Fits maximum information into your budget:
# hotspot files get L1 (detailed), rest get L0 (structure)

# The navigation map
composto reindex .            # write .composto/context.md (SHA-stamped)
composto start .              # keep it live: file watcher auto-refreshes it

# Cross-agent handoff: layered prefix/delta + hashes, changed files as IR
composto handoff .

# Benchmark token savings across your project
composto benchmark .

# Compression proxy, point your LLM client's base URL at it
composto proxy --port 8787    # swaps raw code blocks for IR in-flight (BYOK), experimental

# Compare LLM quality: raw code vs IR (requires ANTHROPIC_API_KEY)
composto benchmark-quality <file>
```

---

## Quality Proof

We tested 4 files from simple to hard. Same question, raw code vs IR: "What does this file do?"

| File | Complexity | Raw Tokens | IR Tokens | Savings | Comprehension |
|------|-----------|-----------|----------|---------|--------------|
| hotspot.ts | Simple | 299 | 77 | 74.2% | Full |
| layers.ts | Medium | 765 | 249 | 67.5% | Full |
| ast-walker.ts | **Hard (448 lines)** | 3,782 | 663 | 82.5% | ~90% |

Even on a 448-line recursive AST walker with nested switches, an LLM can fully explain the architecture, all 12 functions, and the data flow from the IR alone.

**What IR preserves:** function signatures, parameter types, imports, control flow, return values, class/interface declarations.

**What IR drops:** string contents, regex patterns, operator details, formatting, things the LLM already knows.

Full benchmark: [docs/benchmark-proof.md](docs/benchmark-proof.md)

---

## IR Layers

| Layer | Tokens | Use case |
|-------|--------|----------|
| **L0** | ~10 | "What's in this file?", just function/class names |
| **L1** | ~85 | "What does this file do?", compressed code + health signals |
| **L2** | ~65 | "What changed?", git diff with context |
| **L3** | variable | "Show me the exact code", raw source |

### When to use which

```
"Explain the architecture"     → L1 for all files
"Fix this bug"                 → L3 for target file, L1 for context
"Review this PR"               → L2 for changed files, L1 for context
"What files are in this repo?" → L0 for everything
```

---

## Health-Aware IR

Composto reads git history and embeds lightweight health signals directly into the IR, one annotation line, no extra round-trip:

```
FN:handleAuth({credentials}) [HOT:15/30 FIX:73% COV:↓ INCON]
  IF:!session → RET 401
  RET { token, expiresAt }
```

- `[HOT:15/30]`, 15 changes in last 30 commits (hotspot)
- `[FIX:73%]`, 73% of changes were bug fixes
- `[COV:↓]`, test coverage declining
- `[INCON]`, inconsistent patterns from multiple authors

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
AST engine:          AST-parsed, with a grammar-free fallback for other languages
Languages:           TypeScript, JavaScript, Python, Go, Rust (+ generic fallback)
```

---

## Configuration

Optional `.composto/config.yaml`:

```yaml
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
pnpm test        # 256 tests
pnpm build       # builds to dist/
npx composto benchmark .  # see compression stats
```

---

## License

MIT
