# Composto — Proactive AI Team Companion

**Date:** 2026-04-09  
**Status:** Draft  
**Author:** Mert Can Altin

---

## Vision

Composto is a proactive AI team companion that watches your codebase, finds problems on its own, understands them in context, and fixes them with your approval — using revolutionary token efficiency.

**Paradigm shift:** "Less context, better understanding."

Every existing AI coding tool sends raw source code to LLMs. Composto sends compressed semantic representations — achieving 70-90% token savings while improving accuracy by reducing noise.

**Competitor:** Superpowers (obra/superpowers, 143K stars)

| | Superpowers | Composto |
|---|---|---|
| Paradigm | Reactive (you ask, it does) | Proactive (it finds, you approve) |
| Token usage | Full source every time | IR Engine, 70-90% savings |
| Agent model | Single agent, many skills | Multi-agent, role-based |
| Background monitoring | None | Watcher Engine |
| Finding quality | Pattern match | Contextual understanding (git + memory) |
| Project memory | None (fresh each session) | decisions/ + snapshots/ |
| Platform support | Added later | Protocol-based from day one |

---

## Architecture Overview

```
+----------------------------------------------+
|           Platform Adapters                   |
|     Claude Code | VS Code | Cursor | CLI     |
|         (CompostoProtocol only)               |
+----------------------------------------------+
|              Watcher Engine                   |
|  +------------+  +-------------+              |
|  | Detector   |->| Interpreter |              |
|  | (0 token)  |  | (~100 tok)  |              |
|  +------------+  +-------------+              |
|  Trigger: event-driven, debounced             |
+----------------------------------------------+
|              IR Engine                        |
|  +----------+ +----------+ +-----------+     |
|  | Indent   | | Finger-  | | Delta     |     |
|  | Intel    | | printing | | Context   |     |
|  | (struct) | | (meaning)| | (changes) |     |
|  +----------+ +----------+ +-----------+     |
|  No AST, no parser, <1ms, every language      |
+----------------------------------------------+
|          Rule-Based Router                    |
|  Pattern match -> right agent, right layer    |
|  LLM fallback only when ambiguous             |
+----------------------------------------------+
|           Agent Pool                          |
|  +--------+  +----------------------+         |
|  | Fixer  |  | Reviewer             |         |
|  |(Haiku) |  |(Sonnet)              |         |
|  |auto-fix|  |normal + challenge    |         |
|  +--------+  +----------------------+         |
|  v2: Security, Architect, Custom Agents       |
+----------------------------------------------+
|          Project Memory                       |
|  .composto/           ~/.composto/projects/   |
|  +- config.yaml       +- project.json        |
|  +- decisions/*.md    +- snapshots/           |
|     (team, committed)  +- profile.json        |
|                          (personal, local)     |
+----------------------------------------------+
```

---

## 1. IR Engine (Core Innovation)

The IR Engine replaces traditional AST parsing with three zero-dependency techniques that work across all programming languages.

### 1.1 Indentation Intelligence (Structure)

Extracts code structure from indentation levels and first-token classification. No parser, no language-specific dependency.

```typescript
function extractStructure(code: string): StructureMap {
  return code.split('\n').map(line => {
    const indent = line.search(/\S/)
    const firstToken = line.trim().split(/\s/)[0]
    return { indent, type: classifyLine(firstToken) }
  })
}

// Universal first-token classification
const lineClassifiers = {
  'function|def|fn|func':      'function-start',
  'class|struct|interface':    'type-start',
  'if|else|elif|switch|match': 'branch',
  'for|while|loop':            'loop',
  'return|yield':              'exit',
  'import|require|use|from':   'import',
  'export|pub|public':         'export',
  'const|let|var|val':         'assignment',
  'try|catch|except':          'error-handling',
  'async|await':               'async',
}
```

**Cost:** 0 dependencies, <1ms, every language.

### 1.2 Semantic Fingerprinting (Meaning)

Compresses known code patterns into compact notation. LLMs already know these patterns — no need to show them the full code.

**Pattern dictionary example:**

```yaml
react:
  useState:  "STATE:{name}:{type}"
  useEffect: "EFFECT[{deps}]:{body}"
  guard:     "GUARD:{condition}->{component}"

express:
  route:     "ROUTE:{method}:{path}->{handler}"
  middleware: "MW:{name}->{next}"

generic:
  loop:      "LOOP:{collection}->{body}"
  trycatch:  "TRY:{body}|CATCH:{handler}"
  assignment:"SET:{name}:{value}"
```

**Compression example:**

```
// Original: 340 tokens
import { useState, useEffect } from 'react';
import { fetchUser } from '../api';
export function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetchUser(userId).then(...) }, [userId]);
  if (loading) return <Spinner />;
  if (!user) return <NotFound />;
  return <div>{user.name}</div>;
}

// Composto IR: 38 tokens
FN:UserProfile(userId:str) @export
  STATE:user:User|null STATE:loading:bool=true
  EFFECT[userId]:fetchUser->user,loading=false
  GUARD:loading->Spinner,!user->NotFound
  RENDER:div>user.name
```

**89% compression.**

### 1.3 Confidence Scoring (Critical Safety Mechanism)

Not all code matches known patterns. Confidence scoring prevents information loss:

```typescript
function fingerprint(line: string): FingerprintResult {
  const match = matchPattern(line)

  if (match.confidence > 0.9) {
    // Exact match — send fingerprint only
    return { type: "fingerprint", ir: match.ir }
    // ~4 tokens
  }
  if (match.confidence > 0.6) {
    // Partial match — fingerprint + raw hint
    return { type: "fingerprint+hint", ir: match.ir, hint: line.trim() }
    // ~12 tokens
  }
  // Unknown — send raw, but only that line
  return { type: "raw", source: line.trim() }
  // ~20 tokens
}
```

**Zero information loss. Average savings still 70-80%.**

### 1.4 Delta Context (Changes Only)

Never send the full file. Send only what changed + minimal surrounding context:

```typescript
function getDeltaContext(file: string): DeltaIR {
  const diff = gitDiff(file)
  const blame = gitBlame(diff.lines)

  const context = diff.hunks.map(hunk => ({
    changed: hunk.lines,
    surroundingFingerprint: fingerprint(hunk, 3),
    functionScope: whichFunction(hunk.line),
  }))

  return { file, context, blame }
}
```

**LLM receives:**

```yaml
FILE: src/auth/login.ts
SCOPE: fn:handleLogin
CHANGED: +const token = "sk-hardcoded-123"
CONTEXT: fn body, JWT creation section
BLAME: mert, 2 hours ago, commit:"debug auth flow"
```

**~40 tokens instead of ~800 for full file.**

### 1.5 Layered Output

The router selects the minimum layer needed for each task:

| Layer | Tokens | When Used |
|---|---|---|
| L0: Structure Map | ~10 | "What's in this project?" |
| L1: Fingerprint IR | ~40 | "What does this file do?" |
| L2: Delta + Context | ~60 | "Fix this issue" |
| L3: Raw Source Lines | variable | Last resort, specific lines only |

---

## 2. Watcher Engine (Proactive Core)

The Watcher Engine runs in the background, finds problems, and presents them with contextual understanding.

### 2.1 Trigger System

Event-driven, not time-based:

```typescript
const triggers = {
  "security-patterns":  ["file:save:debounced(2000)"],
  "dependency-check":   ["package.json:changed", "daily"],
  "coverage-check":     ["test-run:completed"],
  "duplication":        ["git:commit"],
  "hotspot":            ["git:commit", "weekly"],
  "dead-code":          ["git:commit"],
}
```

### 2.2 Two-Phase Analysis

**Phase 1: Detector (0 tokens)**

Local analysis only — incremental indentation parsing, pattern matching, git log analysis.

Output: raw findings list.

**Phase 2: Interpreter (~100 tokens per finding)**

Enriches raw findings with git context + project memory. Uses Haiku. Only runs when Phase 1 finds something.

Produces contextual explanations:
- Not "console.log on line 42"
- But "This console.log was added 2 hours ago for debugging auth flow. The bug is fixed but this was left behind. Remove it?"

### 2.3 Context-Aware Severity

Same finding, different severity depending on location:

```typescript
interface WatcherRule {
  pattern: RegExp
  severity: {
    [glob: string]: "info" | "warning" | "critical"
  }
}

// Example
{
  pattern: /console\.log/,
  severity: {
    "src/**": "warning",
    "tests/**": "info",
    "scripts/**": "info"
  }
}
```

### 2.4 Actionable Findings

```typescript
interface Finding {
  watcherId: string
  severity: "info" | "warning" | "critical"
  file: string
  line?: number
  message: string

  action?: {
    type: "auto-fix" | "agent-required" | "human-only"
    autoFix?: string
    agentHint?: {
      role: "fixer" | "reviewer"
      model: "haiku" | "sonnet"
      contextFiles: string[]
    }
  }
}
```

**Notification rules:**
- `info` — silent log, no prompt
- `warning` — batched at end of session
- `critical` — immediate notification, approval required

---

## 3. Agent Pool

### 3.1 v1 Agents

| Role | Model | When | What |
|---|---|---|---|
| Fixer | Haiku | auto-fix findings | Deterministic fixes, near-zero tokens. Escalates to Reviewer when uncertain. |
| Reviewer | Sonnet | PR/commit, major decisions | Code quality review. Challenge mode activates automatically for major architectural decisions. |

### 3.2 Review Modes

```typescript
const reviewModes = {
  "trivial":  { challenge: false },  // rename, typo → pass through
  "moderate": { challenge: false },  // single-file change → normal review
  "major":    { challenge: true  }   // new module, architecture → counter-argument
}
```

### 3.3 Inter-Agent Communication

Agents communicate via structured messages, not raw conversations:

```typescript
interface AgentMessage {
  from: string
  to: string
  type: "proposal" | "objection" | "approval"
  summary: string       // max 200 tokens
  references: string[]  // file:line
}
```

### 3.4 v2 Roadmap

- Security Agent (Sonnet) — auth/crypto/input files
- Architect Agent (Opus) — design decisions, structure proposals
- Custom Agent API — user-defined agents via config

---

## 4. Rule-Based Router

Deterministic routing, zero tokens. LLM fallback only for ambiguous cases.

```typescript
const routes: RouteRule[] = [
  { pattern: "**/*.sql",       agents: ["fixer"],    irLayer: "L2" },
  { pattern: "**/auth/**",     agents: ["reviewer"], irLayer: "L2" },
  { pattern: "**/*.test.*",    agents: ["reviewer"], irLayer: "L1" },
  { pattern: "**/*.md",        agents: ["fixer"],    irLayer: "L0" },
  // ... extensible via config.yaml
]

function route(finding: Finding): RouteDecision {
  const match = routes.find(r => globMatch(finding.file, r.pattern))
  if (match) return match                    // deterministic, 0 tokens
  return llmFallback(finding)                // rare, ~50 tokens
}
```

---

## 5. Project Memory

### 5.1 Repository-Level (committed, shared)

```
.composto/
+-- config.yaml           # watcher rules, agent settings, project standards
+-- decisions/             # team decisions in markdown
    +-- YYYY-MM-DD-topic.md
```

**Decision format:**

```markdown
# Session Storage: SQLite

**Decision:** Session data stored in SQLite.
**Reason:** Redis unnecessary at current scale.
**Date:** 2026-04-09
**Related files:** src/auth/session.ts

---
Composto metadata (do not edit):
relatedFiles: ["src/auth/session.ts"]
supersedes: null
```

Decisions prevent repeated discussions. Agent reads relevant decisions (filtered by file relation) before making suggestions.

### 5.2 User-Level (local, personal)

```
~/.composto/projects/<repo-hash>/
+-- project.json           # auto-detected: language, framework, structure
+-- snapshots/latest.json  # file count, deps, coverage, open findings
+-- profile.json           # personal severity preferences
```

**project.json** is auto-generated from package.json, tsconfig.json, directory structure — zero tokens.

### 5.3 Decision Relevance Filtering

```typescript
function getRelevantDecisions(file: string): Decision[] {
  return decisions.filter(d =>
    d.relatedFiles.some(f => isRelated(f, file))
  )
}
```

Only related decisions loaded. JSON filtering — zero tokens.

---

## 6. Platform Protocol

Single interface for all platforms:

```typescript
interface CompostoProtocol {
  // Platform -> Composto
  onFileChange(event: FileChangeEvent): void
  onCommand(cmd: string, args: string[]): void
  onApproval(proposalId: string, approved: boolean): void

  // Composto -> Platform
  notify(message: CompostoMessage): void
}

type CompostoMessage =
  | { type: "finding", data: Finding }
  | { type: "proposal", data: Proposal }
  | { type: "edit", data: { file: string, content: string } }
  | { type: "question", data: { id: string, text: string, options?: string[] } }
```

Each platform implements one `notify` handler. Displays/applies using its native methods.

---

## 7. Config System

```yaml
# .composto/config.yaml

watchers:
  security:
    enabled: true
    severity:
      "src/**": warning
      "tests/**": info
  deadCode:
    enabled: true
    trigger: on-commit
  dependencies:
    enabled: true
    trigger: [package.json:changed, daily]

agents:
  fixer:
    enabled: true
    model: haiku
  reviewer:
    enabled: true
    model: sonnet
    challengeThreshold: major

ir:
  fingerprintPatterns: default    # or path to custom patterns
  confidenceThreshold: 0.6       # below this, send raw
  deltaContextLines: 3           # surrounding lines for delta

memory:
  decisionsDir: .composto/decisions
  snapshotInterval: on-commit
```

---

## 8. Data Flow Example

```
1. Developer saves src/auth/login.ts
        |
2. Watcher Engine triggers (debounced, 2s)
        |
3. Detector: indentation parse + pattern match
   -> "hardcoded secret found, line 23"
   (0 tokens)
        |
4. IR Engine: updates file's semantic IR
   (0 tokens)
        |
5. Interpreter: git blame + memory ->
   "This secret was added 2 hours ago for debugging,
    the bug is fixed, should use .env"
   (Haiku, ~100 tokens)
        |
6. Router: severity=critical, type=auto-fix
   -> route to Fixer agent
        |
7. Fixer: generates fix via IR (not full source)
   "Use process.env.JWT_SECRET"
   (Haiku, ~150 tokens — IR instead of full file)
        |
8. Shown to user:
   "login.ts:23 has a hardcoded secret.
    You added it for debugging, should I move it to .env?"
        |
9. User approves -> patch applied
        |
10. Decision saved:
    .composto/decisions/2026-04-09-no-hardcoded-secrets.md
```

**Total cost: ~250 tokens.** Same task in Superpowers: ~3000+ tokens.

---

## 9. v1 Scope (MVP)

### In scope:
- IR Engine (indentation intel + fingerprinting + confidence scoring + delta context)
- Watcher Engine (detector + interpreter, event-driven triggers)
- Rule-Based Router (deterministic, LLM fallback)
- Fixer Agent (Haiku) + Reviewer Agent (Sonnet)
- Project Memory (config.yaml + decisions/ + snapshots/)
- CLI adapter (first platform)
- Pattern dictionary for: TypeScript, JavaScript, Python, Go

### Out of scope (v2):
- VS Code / Cursor / Claude Code adapters
- Security / Architect agents
- Custom Agent API
- Challenge mode for Reviewer
- Web dashboard
- Team sync features
- Pattern dictionary for additional languages

---

## 10. Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **Package manager:** pnpm
- **Testing:** Vitest
- **Build:** tsup
- **LLM providers:** Anthropic (Claude), OpenAI (optional)
- **Zero native dependencies** — no tree-sitter, no language-specific parsers

---

## 11. Manifesto

> **"Less context, better understanding."**
>
> Every AI coding tool sends raw source code to LLMs.
> Composto sends meaning.
> Less noise, stronger signal.
> The AI reads less, understands more, costs less.
>
> Not a tool you command. A companion that watches, understands, and acts — with your permission.
