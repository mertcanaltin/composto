# Composto BlastRadius — Design Spec

**Date:** 2026-04-19
**Status:** Draft, pending review
**Scope:** First wedge of Composto's pivot from token compressor to causal oracle. Introduces a new MCP tool `composto_blastradius` plus supporting memory subsystem. Does not modify existing 4 MCP tools.

---

## 1. Motivation

Composto today is positioned as "send meaning to your LLM, not code" — an AST-based IR compressor delivering ~89% token savings. Compression is becoming a commodity: LLM providers are expanding context windows, caching natively, and third-party tools will close the compression gap. Compression ratio is not a defensible moat.

The structural gap LLMs cannot close with more context is **temporal and causal reasoning about a specific codebase**: "if I change this region, what historically broke?", "is this change pattern similar to ones that were reverted?", "who owns this code and are they still around?" The signal for these questions lives in the *delta* between past states of the repo — not in the current code. No amount of context window expansion exposes it; it must be mined and injected.

Composto is uniquely positioned to build this layer because it already touches the three required data sources: tree-sitter AST (`src/parser/`), git history mining (`src/trends/`), and health signals (`src/ir/health.ts`). Today those signals are flattened into IR strings (`HOT:15/30 FIX:73%`). The next product is to expose them as a first-class queryable graph.

The strategic direction is: **Composto becomes the causal oracle / temporal memory layer for coding agents.** Compression is demoted to a side effect.

This spec describes the first shippable wedge: a single MCP tool `composto_blastradius` that predicts the historical blast radius of a proposed code change, backed by a local causal graph built from git history.

## 2. Goals and non-goals

**Goals:**

- Ship a new MCP tool `composto_blastradius` that takes a file path (optionally with intent and diff) and returns a calibrated risk verdict with explicit signals.
- Build the foundational memory subsystem (`src/memory/`) with SQLite-backed graph storage suitable for extension.
- Maintain the `npm install -g composto-ai` single-binary distribution. No daemon, no new external services.
- Meet strict performance budgets: hot-path query p95 < 50ms.
- Be honest about uncertainty: return `verdict: "unknown"` when confidence is low instead of guessing.
- Ship a CLI counterpart `composto impact` mirroring the MCP tool.
- Provide a reproducible calibration backtest (`docs/blastradius-proof.md`) as product credibility evidence.

**Non-goals (deferred to later versions):**

- CI / test-run history integration (v2).
- Incident data ingestion (Sentry, PagerDuty, Linear) (v2+).
- Multi-branch indexing; v1 indexes the current default branch only (v1.1).
- PR metadata from GitHub API (v2).
- Vector embeddings — the problem is causal/temporal, not semantic similarity.
- Follow-on primitives (`composto_witness`, `composto_ownership`, `composto_invariants`); direction only, not scoped.
- Any modification to the existing 4 MCP tools. Optional v1.1 bridge to `composto_context` is noted but not built.

## 3. Architecture

Single Node process, three-layer internal structure. All work stays inside the existing `composto-ai` package and its MCP server. Parallelism via `worker_threads`; persistence via SQLite in WAL mode.

```
Process Boundary (single Node process)
┌─────────────────────────────────────────────────────────────┐
│  MCP Server (main thread) — src/mcp/server.ts                │
│    existing 4 tools + new: composto_blastradius              │
│                                          │                   │
│  CLI (main thread) — src/cli/index.ts    │                   │
│    composto impact <file>                │                   │
│    composto index [--background]         │                   │
│                                          ▼                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Memory API (main thread) — src/memory/api.ts          │  │
│  │   • ensureFresh(): HEAD vs last_indexed (O(1) git)     │  │
│  │   • query(file, intent, level, diff): graph lookup     │  │
│  │   • queueIngest(range): submit to worker pool          │  │
│  │   • does NOT parse AST, does NOT read git log          │  │
│  └──────┬──────────────────────────────┬──────────────────┘  │
│         │ SQLite reads (WAL)           │ postMessage         │
│         ▼                              ▼                     │
│  ┌──────────────┐              ┌───────────────────────────┐ │
│  │ SQLite (WAL) │◄── readers ──│  Worker Pool              │ │
│  │ .composto/   │              │   src/memory/worker.ts    │ │
│  │ memory.db    │◄── writer  ──│   • git log ingest        │ │
│  └──────────────┘              │   • tree-sitter AST       │ │
│                                │   • signal extraction     │ │
│                                │   • calibration refresh   │ │
│                                └───────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Layer responsibilities:**

- **API layer (main thread).** Orchestration and query only. Target: <10ms main-thread work per call. Never invokes AST parsers or git log directly; delegates to the worker pool.
- **Worker pool (`worker_threads`).** All CPU-bound work: shelling to `git log`, tree-sitter parsing, signal extraction, calibration math. Pool size: `min(os.cpus().length - 1, 8)`. Each worker opens its own SQLite read handle; writes funnel through a central write queue (SQLite single-writer).
- **SQLite (WAL mode).** Single source of truth. `.composto/memory.db` + `.db-wal` + `.db-shm`. Workers and the main thread are stateless w.r.t. persistence — restart reads state from disk.

**Reuse of existing modules:**

| Existing module | Role in BlastRadius |
|---|---|
| `src/parser/` (tree-sitter) | Used in workers during Tier 2 ingest |
| `src/trends/` | Commit-mining heuristics; moves from IR-string output to graph population |
| `src/ir/health.ts` | Feeds `coverage_decline` signal; reused as-is |
| `src/mcp/server.ts` | Adds 5th tool registration |
| `src/cli/` | Adds `impact` and `index` commands |

**Why not a sidecar daemon:** Daemon lifecycle (install, start, upgrade, diagnose) is the highest support burden for developer tools. It breaks the `npm install -g` distribution model and is over-engineering at the wedge stage. The worker-thread architecture preserves single-binary simplicity while fixing the real concern (main-thread responsiveness). Future migration to a daemon is mechanical: move the worker pool to a separate process; DB schema and message protocol remain unchanged.

**Why not single-thread in-process:** Cold Tier 2 file indexing on main thread would block the MCP protocol for hundreds of milliseconds to seconds on larger files. Tool-call timeouts and degraded UX would follow. Unacceptable for a responsive oracle.

## 4. Graph schema

Storage: `.composto/memory.db` (SQLite, WAL mode). Migrations keyed on `PRAGMA user_version`, shipped as `src/memory/migrations/NNN-*.sql`. Ship with schema version 1.

### 4.1 Tables

```sql
-- Global metadata: bootstrap state, version, last indexed commit
CREATE TABLE index_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Canonical keys: schema_version, last_indexed_sha, first_commit_sha,
--                 bootstrap_completed_at, calibration_last_refreshed_at,
--                 indexed_commits_total

-- Commits: append-only, SHA immutable
CREATE TABLE commits (
  sha         TEXT PRIMARY KEY,
  parent_sha  TEXT,              -- first parent only; multi-parent handling deferred
  author      TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,  -- Unix epoch seconds, UTC
  subject     TEXT NOT NULL,
  is_fix      INTEGER NOT NULL,  -- boolean: matches fix:|hotfix|bugfix|closes #N
  is_revert   INTEGER NOT NULL,  -- boolean: "This reverts commit <sha>"
  reverts_sha TEXT,              -- parsed from revert message
  FOREIGN KEY (reverts_sha) REFERENCES commits(sha)
);
CREATE INDEX idx_commits_timestamp ON commits(timestamp);
CREATE INDEX idx_commits_is_fix    ON commits(is_fix) WHERE is_fix = 1;

-- File touches: junction, Tier 1 foundation
CREATE TABLE file_touches (
  commit_sha    TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  adds          INTEGER NOT NULL,
  dels          INTEGER NOT NULL,
  change_type   TEXT NOT NULL,  -- 'A'|'M'|'D'|'R' from git numstat
  renamed_from  TEXT,
  PRIMARY KEY (commit_sha, file_path),
  FOREIGN KEY (commit_sha) REFERENCES commits(sha)
);
CREATE INDEX idx_ft_file ON file_touches(file_path);

-- Symbol identities: stable (file_path, kind, qualified_name) tuples
CREATE TABLE symbols (
  id              INTEGER PRIMARY KEY,
  file_path       TEXT NOT NULL,
  kind            TEXT NOT NULL,  -- 'fn'|'class'|'method'|'type'|'const'
  qualified_name  TEXT NOT NULL,  -- e.g. 'AuthService.login'
  first_seen_sha  TEXT NOT NULL,
  last_seen_sha   TEXT,            -- NULL if still present
  UNIQUE (file_path, kind, qualified_name)
);
CREATE INDEX idx_symbols_file ON symbols(file_path);

-- Symbol touches: Tier 2, populated lazily per queried file
CREATE TABLE symbol_touches (
  commit_sha    TEXT NOT NULL,
  symbol_id     INTEGER NOT NULL,
  change_type   TEXT NOT NULL,  -- 'added'|'modified'|'deleted'|'renamed'
  PRIMARY KEY (commit_sha, symbol_id),
  FOREIGN KEY (commit_sha) REFERENCES commits(sha),
  FOREIGN KEY (symbol_id)  REFERENCES symbols(id)
);
CREATE INDEX idx_st_symbol ON symbol_touches(symbol_id);

-- Causal edges: derived fix-to-break links
CREATE TABLE fix_links (
  fix_commit_sha       TEXT NOT NULL,
  suspected_break_sha  TEXT NOT NULL,
  evidence_type        TEXT NOT NULL, -- 'revert_marker'|'short_followup_fix'|'same_region_fix_chain'
  confidence           REAL NOT NULL, -- 0.0..1.0, evidence-specific
  window_hours         INTEGER,
  PRIMARY KEY (fix_commit_sha, suspected_break_sha, evidence_type),
  FOREIGN KEY (fix_commit_sha)      REFERENCES commits(sha),
  FOREIGN KEY (suspected_break_sha) REFERENCES commits(sha)
);
CREATE INDEX idx_fl_break ON fix_links(suspected_break_sha);

-- Calibration: per-repo signal precision from self-validation
CREATE TABLE signal_calibration (
  signal_type        TEXT PRIMARY KEY,  -- 'revert_match'|'hotspot'|'fix_ratio'|'coverage_decline'|'author_churn'
  precision          REAL NOT NULL,     -- 0.0..1.0
  sample_size        INTEGER NOT NULL,
  last_computed_sha  TEXT NOT NULL,
  computed_at        INTEGER NOT NULL
);

-- Tier 2 cache tracking: which files are deeply indexed
CREATE TABLE file_index_state (
  file_path            TEXT PRIMARY KEY,
  last_commit_indexed  TEXT NOT NULL,
  last_blob_indexed    TEXT,
  indexed_at           INTEGER NOT NULL,
  parse_failed         INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (last_commit_indexed) REFERENCES commits(sha)
);
```

### 4.2 Invariants

1. **`commits` is append-only.** Writes use `INSERT OR IGNORE`. Same SHA cannot be written twice.
2. **Timestamps are UTC epoch seconds.** Normalized at the DB boundary exactly once.
3. **`fix_links` is derived.** Can be dropped and rebuilt safely from `commits` + `file_touches`.
4. **Symbol identity is `(file_path, kind, qualified_name)`.** Renames close the old row (`last_seen_sha`) and open a new one; cross-file rename tracking deferred beyond v1.
5. **Schema version in `PRAGMA user_version`.** Migrations are idempotent and atomic.

### 4.3 Size and performance

| Repo scale | Commits | file_touches | symbol_touches (fully populated) | Total DB |
|---|---|---|---|---|
| Small | 500 | ~3k | ~10k | ~3 MB |
| Medium | 10k | ~50k | ~200k | ~30 MB |
| Large | 100k | ~500k | ~2M | ~250 MB |

Because Tier 2 (`symbol_touches`) populates only on `blastradius` calls that provide a `diff` (§5.2), typical actual size is far below the fully-populated ceiling — commonly under 10% of the listed `symbol_touches` figure.

### 4.4 Query patterns covered by indexes

- "Commits touching this file" — `idx_ft_file`
- "Commits touching this symbol" — `idx_st_symbol` + `commits` PK
- "Did a fix follow this commit?" — `idx_fl_break`
- "Hotspot: touches in last 90 days" — `idx_commits_timestamp` + `idx_ft_file`

## 5. Data flow

### 5.1 Ingest — Tier 1 (metadata, global, eager)

Triggered by: first call on the repo; explicit `composto index`; or any subsequent call where `git rev-list --count <last_indexed>..HEAD > 0`.

Bootstrap from empty DB:

1. Worker shells `git log --name-only --numstat --format=…` on the default branch.
2. Populate `commits` and `file_touches` in 1000-row batches per transaction.
3. Parse commit subjects for `is_fix`, `is_revert`, `reverts_sha`.
4. Derive `fix_links`:
   - `revert_marker`: for each `is_revert` commit, link to `reverts_sha`.
   - `short_followup_fix`: for each `is_fix` commit, link to any commit touching the same files within the prior 72 hours.
   - `same_region_fix_chain`: three or more fix commits clustering on the same file within a rolling window.
5. Update `index_state.last_indexed_sha` to HEAD.
6. Notify main thread on completion.

Parallelism: commit range is partitioned across N workers. CPU-bound regex and parse work is parallel; SQLite writes are serialized through a single writer (write queue).

Incremental delta: same pipeline but on `last_indexed_sha..HEAD`. Typical delta is 1–50 commits, completing in <100ms.

### 5.2 Ingest — Tier 2 (AST, per-file, lazy)

Triggered **only when a `blastradius` call provides the `diff` parameter** and the file's Tier 2 cache is missing or stale. The five v1 signals (§6.2) are all satisfied by Tier 1 tables; Tier 2 exists to support symbol-granularity narrowing when a diff is available, and to unblock follow-on primitives that need it.

Without `diff`, the tool responds entirely from Tier 1 and never incurs Tier 2 cost. This keeps the default path (summary, no diff) free of cold-start latency beyond Tier 1 bootstrap.

Staleness rule: `file_index_state` has no entry for the file, or the file's `last_commit_indexed` is older than the most recent commit touching that file.

1. Load commits that touched this file from `file_touches` (ordered by timestamp).
2. For each commit, `git show <sha>:<file>` and `git show <sha^>:<file>`; tree-sitter parse both.
3. Diff symbol sets; insert `symbol_touches` rows.
4. Upsert `file_index_state` (`last_commit_indexed`, `last_blob_indexed`, `indexed_at`).

Cut-off: `--max-commits 500` per file (configurable). Older history rarely changes hotspot or fix-ratio signals meaningfully.

### 5.3 Query path — `blastradius(file, intent?, level?, diff?)`

Timeline for a hot-path call:

- `t=0ms`: Call arrives at `src/mcp/server.ts`, routes to `memory/api.ts::blastradius()`.
- `t=1ms`: `ensureFresh()` — shell `git rev-parse HEAD` (~1ms), read `last_indexed_sha` from `index_state` (<1ms). If mismatched, non-blocking enqueue of delta ingest and set `tazelik = "catching_up"`; otherwise `tazelik = "fresh"`.
- `t=3ms`: If the call provides `diff`, check `file_index_state` and enqueue Tier 2 ingest on a miss; while Tier 2 is building, fall back to file-level signals. If Tier 1 itself is not yet bootstrapped, return `{status: "indexing", retry_hint_ms: 800}` immediately unless last-50-commit partial signals are available.
- `t=5ms`: Fire parallel SQLite reads for five signals:
  - `revert_match` from `fix_links` where `suspected_break_sha` affected the file
  - `hotspot` from `file_touches` in last 90 days
  - `fix_ratio` from last 30 commits touching the file
  - `coverage_decline` from `src/ir/health.ts`
  - `author_churn` from last commit author's activity in last 90 days
- `t=12ms`: Load calibration from `signal_calibration`.
- `t=13ms`: Compute `score` and `confidence` (see §6).
- `t=15ms`: Map to `verdict` (low/medium/high/unknown).
- `t=16ms`: If `level=detail`, compute `affected_tests`, `similar_commits`, `recommended_guards`, `ownership`.
- `t=20ms`: Return response envelope.

Hot-path budget: 50ms p95. The 20ms timeline above is realistic; remaining margin absorbs outliers.

### 5.4 Freshness contract — O(1) per call

Every call performs exactly two freshness operations:

1. `git rev-parse HEAD` (~1ms shell fork)
2. `SELECT value FROM index_state WHERE key='last_indexed_sha'` (<1ms SQLite)

If they match, no ingest is performed. If they differ, delta ingest is enqueued but **the current call does not wait**; the existing indexed state answers the query, and the envelope reports `tazelik: "catching_up", behind_by: N commits`. This keeps latency deterministic; user experience beats marginally fresher data.

### 5.5 History rewrite detection

On every `ensureFresh`, additionally verify:

```
git merge-base --is-ancestor <last_indexed_sha> HEAD
```

If `last_indexed_sha` is no longer reachable (force-push, rebase, filter-repo), clear `index_state` and trigger a full rebuild. Response status becomes `reindexing`. Without this check, the delta ingest would silently produce wrong answers.

### 5.6 Calibration refresh — background

Triggered after bootstrap, then every N=500 new commits or every 7 days, whichever comes first.

For each signal type:

1. Find the last K events where the signal would have fired.
2. For each, check whether a `fix_link` materialized within the subsequent 14 days.
3. `precision = hits / total`; `sample_size = K`.
4. Upsert `signal_calibration`.

If `sample_size < 20`, set `precision = NULL` and fall back to the heuristic weights below (calibration reported as `heuristic` in the response envelope).

## 6. Confidence math

Two separate numbers. Combining them hides the truth.

### 6.1 Score — repo-calibrated weighted average

```
score = Σᵢ (signalᵢ.strength × calibrationᵢ.precision)
       ─────────────────────────────────────────────
            Σᵢ calibrationᵢ.precision

(only firing signals contribute; terms with precision=0 or strength=0 are excluded)
```

`signal.strength ∈ [0,1]` is how strongly the signal fires. `calibration.precision ∈ [0,1]` is how often this signal type has historically predicted a fix in this repo. If uncalibrated, fallback `precision = 0.3` (conservative).

### 6.2 Signal strength formulas (v1 signals)

| Signal | Strength formula | Rationale |
|---|---|---|
| `revert_match` | 1.0 if `revert_marker` evidence exists for an affecting commit; 0.7 if `short_followup_fix`; 0.4 if `same_region_fix_chain`; 0 otherwise | Evidence type directly maps to strength |
| `hotspot` | `min(1.0, touches_90d / 30)` | Saturates at 30 touches so one hotspot doesn't dominate |
| `fix_ratio` | `max(0, (ratio - 0.3) / 0.5)` over last 30 commits touching file | Dead zone below 30%, saturates at 80% |
| `coverage_decline` | 1.0 if `COV:↓` from `ir/health.ts`; 0 otherwise | Binary, reused signal |
| `author_churn` | 1.0 if last author has 0 commits in last 90d; 0.5 if <5; 0 otherwise | Institutional-expertise signal |

Each formula has a saturation ceiling and a dead zone. No single extreme signal dominates; no mild condition contributes noise.

### 6.3 Confidence — weakest-link `min`

```
confidence = min(
  coverage_factor,      -- how many usable signals fired
  calibration_factor,   -- calibration's own sample size
  freshness_factor,     -- index freshness / degraded state
  history_factor        -- total commits in repo
)
```

`min` (not product, not average) because the weakest factor is the true ceiling on trust.

```
coverage_factor:
  n_usable = count(signal.strength > 0 AND calibration.sample_size >= 20)
  → min(1.0, n_usable / 3)

calibration_factor:
  avg_sample = mean(calibration.sample_size) over firing signals
  avg < 20   → 0.3
  avg < 100  → 0.6
  avg >= 100 → 1.0

freshness_factor:
  fresh + full         → 1.0
  catching_up          → 0.8
  partial (last-50)    → 0.4
  bootstrap running    → 0.2

history_factor:
  n_commits < 50     → 0.2
  n_commits < 200    → 0.5
  n_commits < 1000   → 0.8
  n_commits >= 1000  → 1.0
```

### 6.4 Verdict mapping — confidence overrides severity

```
if confidence < 0.3:
  verdict := "unknown"
elif score < 0.3:
  verdict := "low"
elif score < 0.6:
  verdict := "medium"
else:
  verdict := "high"
```

The `confidence < 0.3 → "unknown"` override is intentional. It prevents an agent from treating a low-confidence result as a low-risk green light. Silence is part of the contract.

### 6.5 Degraded modes

All degraded modes are first-class status values returned in the envelope. `confidence_cap` is applied as `final_confidence = min(computed, cap)`.

| `status` | Trigger | Behavior | `confidence_cap` |
|---|---|---|---|
| `ok` | Normal operation | Full response | — |
| `empty_repo` | <10 commits | `verdict: "unknown"`, no signals | 0.0 |
| `insufficient_history` | 10–49 commits | Only `hotspot` fires; no calibration | 0.3 |
| `shallow_clone` | `git rev-parse --is-shallow-repository` returns true | `verdict: "unknown"`, suggest `composto index --deepen` | 0.0 |
| `indexing` | Tier 1 bootstrap running (Tier 2 misses do not surface this status; they silently fall back to file-level signals) | Partial result from last 50 commits if available, else `retry_hint_ms: 800` | 0.4 |
| `squashed_history` | Heuristic: single author + narrow time window across many commits | Score computed, cap applied | 0.5 |
| `reindexing` | History rewrite detected | `verdict: "unknown"` until rebuild completes | 0.0 |
| `internal_error` | Unknown failure; surfaced rather than hidden | Log reference in `reason`; tool not disabled unless three-strike | 0.0 |
| `disabled` | Three consecutive unrecoverable errors | No computation; user action required | 0.0 |

## 7. MCP tool and CLI contract

### 7.1 Tool registration

Name: `composto_blastradius`. Added in `src/mcp/server.ts` alongside the existing four tools; none of the existing tools change.

Description (what the LLM reads when deciding whether to call):

> Predict the historical blast radius of a code change before applying it. Returns a risk verdict (low/medium/high/unknown), confidence, and the git-derived signals behind it (revert history, hotspots, fix ratio, coverage decline, ownership churn). Call BEFORE proposing significant edits to files with non-trivial history. Honest about uncertainty — returns "unknown" when confidence is low instead of guessing. Degraded modes (empty repo, shallow clone, indexing) are explicit in the `status` field.

Annotations:

- `readOnlyHint: true` — tool does not modify the repo
- `idempotentHint: true` — identical input yields identical output within a short window
- `openWorldHint: false` — no external network access

### 7.2 Input JSON Schema

```json
{
  "type": "object",
  "properties": {
    "file": {
      "type": "string",
      "description": "Repo-relative path of the file the agent intends to modify."
    },
    "intent": {
      "type": "string",
      "enum": ["refactor", "bugfix", "feature", "test", "docs", "unknown"],
      "default": "unknown",
      "description": "Kind of change planned. Refactor and bugfix receive stricter weighting; docs and test receive relaxed weighting."
    },
    "level": {
      "type": "string",
      "enum": ["summary", "detail"],
      "default": "summary",
      "description": "summary: compact verdict + top-3 signals. detail: full evidence, affected tests, recommended guards, ownership."
    },
    "diff": {
      "type": "string",
      "description": "Optional unified diff. When present, narrows blast radius to actually-touched symbols."
    }
  },
  "required": ["file"]
}
```

### 7.3 Output envelope (summary mode)

```json
{
  "status": "ok",
  "verdict": "medium",
  "score": 0.58,
  "confidence": 0.64,
  "signals": [
    {
      "type": "revert_match",
      "strength": 0.7,
      "precision": 0.82,
      "sample_size": 47,
      "evidence": [
        { "commit_sha": "a3b2c1", "subject": "revert: auth token race", "days_ago": 12 }
      ]
    },
    {
      "type": "hotspot",
      "strength": 0.5,
      "precision": 0.41,
      "sample_size": 112,
      "touches_90d": 15
    }
  ],
  "calibration": "repo-calibrated",
  "metadata": {
    "tazelik": "fresh",
    "index_version": 1,
    "indexed_commits_through": "ff1a2b3",
    "indexed_commits_total": 8432,
    "query_ms": 18,
    "signal_coverage": "4/5"
  }
  // signal_coverage is "<usable>/<total>", where <usable> is the count of signals
  // whose strength > 0 AND whose calibration.sample_size >= 20. It is the same
  // quantity that drives coverage_factor in §6.3.
}
```

### 7.4 Detail-mode additional fields

```json
{
  "affected_tests": [
    { "file": "tests/auth.test.ts", "line": 340, "failure_count": 3 }
  ],
  "similar_commits": [
    { "sha": "a3b2c1", "subject": "...", "verdict_at_time": "high", "outcome": "reverted_in_2d" }
  ],
  "recommended_guards": [
    "add integration test for credential null path — 3 of 5 similar commits were reverted without it"
  ],
  "ownership": {
    "last_author": "@alice",
    "last_commit_days_ago": 112,
    "active_in_last_90d": false
  }
}
```

### 7.5 Envelope invariants

- `status` and `metadata` are always present, even in degraded modes.
- `signals` is always an array (possibly empty) with a fixed item shape; LLM parsing never breaks.
- `reason` is required whenever `status != "ok"`.
- No degraded mode returns a silent response.

### 7.6 CLI counterparts

```
composto impact <file> [--intent=bugfix] [--level=detail]
    Same data as the MCP tool, human-readable formatted output.

composto index [--background] [--deepen] [--status] [--rebuild]
    --background : start Tier 1 bootstrap in a detached process.
    --deepen     : detected shallow clone; runs `git fetch --unshallow`.
    --status     : show index state, calibration, storage, health.
    --rebuild    : drop .composto/memory.db and rebuild from scratch.
```

### 7.7 Relationship to existing MCP tools

| Tool | Change |
|---|---|
| `composto_ir` | None |
| `composto_benchmark` | None |
| `composto_context` | None in v1. Optional v1.1 bridge: higher-risk files get L1 detail in context packing. Out of scope here. |
| `composto_scan` | None |
| `composto_blastradius` | **New** |

## 8. Error handling and observability

### 8.1 Principles

1. **Known failure → degraded response, never silent.** `status` + `reason` always present.
2. **Unknown failure → fail loud.** `status: "internal_error"` with reason and log reference. Never fabricate output.
3. **Recovery is cache-level.** `.composto/memory.db` is derived from git. If corrupt, `composto index --rebuild` reconstructs.

### 8.2 Failure catalogue

| Category | Trigger | Tool behavior | Recovery |
|---|---|---|---|
| Not a git repo | `git rev-parse` fails | `status: "not_a_git_repo"` + init hint | `git init` |
| Detached HEAD | No symbolic ref | Respond against last named branch, flag in `reason` | Informational only |
| Shallow clone | `--is-shallow-repository` true | `status: "shallow_clone"`, `verdict: "unknown"` | Suggest `composto index --deepen` |
| Empty / insufficient | Commit count | `status: "empty_repo"` or `"insufficient_history"` | Time |
| SQLite BUSY | Concurrent write | Auto-retry 3× at 50ms backoff | Transparent |
| SQLite disk full | SQLITE_FULL | `status: "internal_error"`; tool disabled for subsequent calls | User frees disk |
| SQLite corrupt | `PRAGMA integrity_check` fails | `status: "index_corrupt"`, suggest rebuild | `--rebuild` |
| Schema mismatch | `user_version < code` | Auto-migrate; on failure `status: "schema_migration_failed"` | Manual `--rebuild` |
| Worker crash | Non-zero exit | Pool respawns, re-queues job; three strikes → fail loud | Transparent up to three strikes |
| Tree-sitter parse fail | Parser exception | `file_index_state.parse_failed = 1`, Tier 1 signals still returned | Log only |
| History rewrite | `last_indexed_sha` not ancestor of HEAD | Full rebuild triggered, `status: "reindexing"` | Automatic |
| Symlink loop / permission | FS errors | Skip offending entries, log | User attention |

### 8.3 Logging

Destination: `.composto/index.log`, NDJSON, daily rotation, 7-day retention.

```json
{"t":1713485432,"lvl":"info","evt":"ingest_start","range":"abc123..def456","commits":42}
{"t":1713485433,"lvl":"warn","evt":"parse_failed","file":"src/bad.ts","err":"unexpected token","commit":"abc123"}
{"t":1713485435,"lvl":"info","evt":"ingest_done","commits":42,"duration_ms":2800}
{"t":1713485501,"lvl":"info","evt":"query","file":"src/auth/login.ts","verdict":"medium","confidence":0.64,"query_ms":18}
{"t":1713485520,"lvl":"error","evt":"sqlite_corrupt","integrity_check":"row 1234 missing","action":"auto_rebuild_suggested"}
```

Levels: `debug|info|warn|error`. Default `info`. Override via `COMPOSTO_LOG=debug`.

### 8.4 Diagnostic CLI

`composto index --status` outputs human-readable state: schema version, bootstrap time, indexed commit count, Tier 2 coverage, calibration freshness, storage footprint, integrity check result, last-100-queries average latency.

### 8.5 Three-strike rule

Three consecutive unrecoverable errors of the same failure class (e.g. `sqlite_corrupt`, `schema_migration_failed`, `worker_crash`) across any caller within a 5-minute window set `status: "disabled"` on the tool. While disabled, `composto_blastradius` returns that status immediately without further work. The flag clears on successful `composto index --rebuild` or when `.composto/memory.db` is removed. No silent retry loop; user must investigate before re-enabling.

### 8.6 Explicitly not included in v1

- External telemetry (Sentry, etc.) — privacy-first; `COMPOSTO_TELEMETRY=1` opt-in deferred to v1.1.
- Remote log upload — none.
- Log viewer UI — `cat`/`jq` is sufficient.

## 9. Testing strategy

Four categories, each protecting a different property.

### 9.1 Unit

Synthetic fixtures, in-memory SQLite (`:memory:`). Target ~80 tests under `tests/memory/unit/`.

- Commit message parser across common `fix:` / `revert:` / `hotfix` patterns.
- Signal strength formulas: boundary values, saturation, dead zone.
- Confidence `min()` composition: each factor's weakest-link effect.
- Verdict mapping grid, especially the `confidence < 0.3` override.
- Schema migration: v1 no-op path; corrupted-DB integrity path.
- Degraded-mode response shape validity across all `status` values.

### 9.2 Integration

Real tree-sitter, real SQLite on disk, four fixture git repos under `tests/memory/fixtures/`:

- `empty-repo/` — zero commits
- `small-repo/` — 20 commits, below thresholds
- `healthy-repo/` — 200 commits, clean signals, low-risk target file
- `chaotic-repo/` — 500 commits, revert chains, high-risk target file, squashed segment

Each fixture asserts: bootstrap completes, `blastradius` query returns expected `status`, and `verdict` falls in an expected range.

### 9.3 Calibration backtest

Public-repo precision/recall evidence, published as `docs/blastradius-proof.md`:

1. Choose three public OSS repos of moderate scale (roughly 2k–15k commits): Composto itself, `vitest`, and one additional project with a visible fix history (e.g. `zod` or `picomatch`). Very large repos (Node.js, React) are out of scope for the backtest — runtime and noise both dominate.
2. For each historical fix commit, compute what `blastradius` would have returned at the preceding HEAD for the files the fix touched.
3. Treat the subsequent fix as ground truth for "risk existed".
4. Report precision and recall for the `medium|high` verdict band.

Ship gate: precision > 60%, recall > 40% on the `medium|high` band. Below this, the product is not ready to ship.

### 9.4 Performance budget (CI-enforced)

| Path | Budget | Measurement |
|---|---|---|
| Hot call | p95 < 50ms | 1000 sequential calls against a warm fixture |
| Warm (delta) | p95 < 200ms | Call after advancing HEAD by one commit |
| Cold file | p95 < 1s | First call on a fresh Tier 2 file |
| Full cold Tier 1 (~5k commits) | < 10s | Replicated healthy-repo fixture |

Measured with `vitest` bench and `process.hrtime`. CI fails on budget regression.

### 9.5 Out of scope for v1

- End-to-end MCP protocol test — trust `@modelcontextprotocol/sdk`, integration test is sufficient.
- Real-agent E2E (Claude Code calling the tool live) — manual QA.
- Fuzz testing — deferred to v1.1.

## 10. Rollout

1. Ship behind a feature flag `COMPOSTO_BLASTRADIUS=1` in the first release.
2. Bundle as part of `composto-ai` at version 0.4.0. Single package, no new install step.
3. On first use on a repo, `composto_blastradius` detects missing `.composto/memory.db` and initiates Tier 1 bootstrap (returning `status: "indexing"` with `retry_hint_ms`).
4. Publish `docs/blastradius-proof.md` at the same release.
5. Remove the feature flag at 0.4.1 once the calibration backtest meets ship-gate numbers in the wild.

## 11. Open questions

None blocking implementation. The following are deliberate v1-scope exclusions documented elsewhere in this spec:

- Multi-branch indexing (v1.1)
- CI / test-run integration (v2)
- GitHub PR metadata (v2)
- Incident ingestion (v2+)
- Bridge from `blastradius` to `composto_context` packing (v1.1)

### 11.1 Working assumptions (product decisions not yet vetted with humans)

These are choices the spec currently **assumes** but that genuinely belong to the product owner rather than the engineer. They are listed here so they can be changed cheaply before or during implementation rather than after ship.

1. **Tool name: `composto_blastradius`.** Alternatives considered: `composto_impact` (shorter, matches CLI verb), `composto_risk` (more generic). `blastradius` chosen for descriptive precision. *Cost to change after ship: MCP consumers break; rename is costly.*
2. **Ship gate numbers: precision > 60%, recall > 40% on `medium|high` band.** Chosen as a plausible first bar — not derived from prior measurement. Product owner may prefer a different trade-off (e.g., higher precision with lower recall if the goal is "never cry wolf").
3. **Backtest target repos: composto itself, vitest, one more moderate-scale OSS project.** Chosen for scale and accessibility. Maintainer relationships and publication sensitivity not verified.
4. **Release packaging: ship in `composto-ai` 0.4.0 behind `COMPOSTO_BLASTRADIUS=1` flag; remove flag at 0.4.1 after ship gate is met in the wild.** Release cadence, breaking-change timing, and flag removal criteria are product-owner decisions.
5. **Follow-on primitive sequencing: `witness` → `ownership` → `invariants`.** This ordering is an engineer's intuition, not a strategy call. If the product owner is closer to enterprise conversations, `ownership` may warrant priority.
6. **Scope of engineering time: ~2–3 weeks.** Based on code-size estimate for `src/memory/` + tests + backtest. Real calendar depends on the owner's parallel commitments and is not negotiated here.

Implementation proceeds on these defaults. Each will surface as a checkpoint in the implementation plan; revisiting any one is inexpensive up until the code lands in a published release.

## 12. Success criteria

The wedge is considered successful if, within one release cycle after ship:

- Calibration backtest meets precision > 60% and recall > 40% on the `medium|high` band across at least three public repos.
- Hot-path p95 < 50ms on a medium-scale repo (10k commits) is sustained in CI.
- `composto_blastradius` is invoked by at least one agent framework (Claude Code or Cursor) in documented flows.
- No silent wrong answers reported in logs; every non-`ok` response carries a `status` + `reason`.

Absent these, the wedge is not the right shape and the direction is revisited before adding follow-on primitives.

---

## Implementation Status

### Plan 1 — Foundation (complete on branch `feature/blastradius-plan-1`)

See `docs/superpowers/plans/2026-04-19-blastradius-plan-1-foundation.md`. Ships: memory subsystem skeleton, Tier 1 ingest (commits + file_touches + fix_links), worker-thread pool, freshness check, `revert_match` signal end-to-end, confidence + verdict math, envelope builder, `MemoryAPI`, `composto_blastradius` MCP tool (feature-flagged via `COMPOSTO_BLASTRADIUS=1`), `composto impact` + `composto index` CLI, end-to-end smoke test. Other four signals return `strength: 0`. Full memory test suite green (196/196 as of Task 17).

### Technical debt carried from Plan 1 into follow-on plans

1. **Coverage factor semantics (Plan 2).** `confidence.ts` uses `strength > 0` only for `coverage_factor`, diverging from spec §6.3 / §7.3 which specify `strength > 0 AND sample_size >= 20`. Plan 1's test expectations and Plan 1's stubs (sample_size=0) together make the spec-strict AND version trivially zero, killing confidence. Plan 2 (real signals with real sample sizes) should revert to spec-strict once signals are backed by meaningful sample counts and update the Plan 1 test expectations accordingly.
2. **Pool / schema path resolution brittleness (Plan 3 cleanup).** When `src/memory/api.ts` is imported from the CLI entry (`src/index.ts`), tsup bundles it into `dist/index.js`; at runtime `import.meta.url` resolves to `dist/index.js` instead of `dist/memory/api.js`. Plan 1 works around this with (a) `splitting: false` in tsup config, (b) `resolveWorkerPath()` in `pool.ts` that detects whether it's in `dist/memory/` or `dist/` and re-roots the lookup, (c) duplicated migration SQL in both `dist/migrations/` and `dist/memory/migrations/`. Plan 3 should replace this with a single robust resolution strategy — either embedding migration SQL as string constants, or resolving the package root via `package.json` lookup, or using an explicit runtime config env var.
3. **Worker error type (Plan 3).** `src/memory/pool.ts` `worker.on("error", (err) => ...)` where `err` is `unknown` but `job.reject(err)` expects `Error`. Flagged by Task 7 code review; deferred to Plan 3's error-handling pass.
4. **Plan 1 file-count deviations from plan-text.** Task 5 (fixture touch-count), Task 7 (pool as tsup entry), Task 11 (coverage formula), Task 14 (splitting:false + pool pool.ts comment), Task 16 (pool.ts bundled-mode + dual migrations copy). All approved during subagent-driven review loops; none change Plan 1's external contract. They represent real integration issues that surfaced during implementation.

### Plan 2–5 (pending)

- **Plan 2** — Remaining four signals (`hotspot`, `fix_ratio`, `coverage_decline`, `author_churn`) + repo-calibrated `signal_calibration` with self-validation + revert-strict `coverage_factor`.
- **Plan 3** — Full degraded-mode catalogue (shallow_clone, squashed_history, reindexing, disabled three-strike, internal_error), NDJSON logging to `.composto/index.log`, `composto index --status|--deepen|--rebuild`, performance-budget CI gate, path-resolution cleanup.
- **Plan 4** — Tier 2 AST ingest (`diff` parameter): per-file `symbol_touches` populated on demand when a blastradius call supplies a unified diff.
- **Plan 5** — Calibration backtest on three OSS repos + `docs/blastradius-proof.md` + ship-gate validation of precision > 60%, recall > 40% on `medium|high` band.
