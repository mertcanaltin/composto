# BlastRadius Plan 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an end-to-end working `composto_blastradius` MCP tool whose verdict is driven by a single real signal (`revert_match`), backed by a new `src/memory/` subsystem that indexes a repo's git history into a local SQLite graph. Other four signals are registered but stubbed (`strength: 0`) in this plan; they are filled in by Plan 2.

**Architecture:** Single Node process. Main-thread API orchestrates; `worker_threads` pool runs git mining and SQLite writes; SQLite in WAL mode is the single source of truth at `.composto/memory.db`. Everything lives under `src/memory/` except the MCP registration in `src/mcp/server.ts` and CLI dispatch in `src/index.ts`. See `docs/superpowers/specs/2026-04-19-composto-blastradius-design.md` for the full design.

**Tech Stack:** TypeScript (existing `composto-ai` package), `better-sqlite3` (new dep, synchronous SQLite for Node), `node:worker_threads`, `node:child_process` for git shelling, `@modelcontextprotocol/sdk` (already present), `vitest` for tests, `zod` for MCP schema (already used).

---

## Scope and Non-Scope

**In scope for Plan 1:**

- `src/memory/` subsystem skeleton: DB wrapper, schema v1 migration, commit parser, git helpers, Tier 1 ingest, worker pool, freshness check, signal orchestrator, confidence + verdict math, envelope builder, main-thread API.
- One working signal: `revert_match` with evidence from `fix_links` (all three evidence types).
- `composto_blastradius` MCP tool registered alongside existing 4 tools.
- `composto impact <file>` CLI command and `composto index` basic bootstrap command.
- Integration smoke test: bootstrap a fixture repo, query `blastradius`, assert envelope fields.
- Fixture repo `tests/memory/fixtures/small-repo` (20 commits, one revert, three fixes).

**Explicitly out of scope for Plan 1 (covered by later plans):**

- Four other signals: `hotspot`, `fix_ratio`, `coverage_decline`, `author_churn`. Stubbed to return `{ strength: 0, precision: 0.3, sample_size: 0 }` this plan; Plan 2 fills them in.
- Repo-calibrated precision via self-validation. Plan 1 hardcodes `precision: 0.5` for `revert_match`; Plan 2 adds calibration machinery.
- Tier 2 AST ingest (the `diff` parameter). Plan 4.
- Full degraded-mode catalogue (`shallow_clone`, `squashed_history`, `reindexing`, three-strike `disabled`, `internal_error`). Plan 1 supports only `ok`, `empty_repo`, and a basic `indexing` state. Plan 3 covers the rest.
- NDJSON logging, diagnostic `composto index --status`, `composto index --rebuild`. Plan 3.
- Calibration backtest and `docs/blastradius-proof.md`. Plan 5.
- Performance-budget CI gate. Plan 3 (lives with error handling polish).
- Detail-mode response fields (`affected_tests`, `similar_commits`, `recommended_guards`, `ownership`). These are stubs returning `[]` in Plan 1 unless trivially derivable; fleshed out in Plan 2.

---

## File Structure

New files (all under `src/memory/` unless noted):

| Path | Responsibility |
|---|---|
| `src/memory/types.ts` | All TypeScript types for the subsystem: `BlastRadiusResponse`, `Signal`, `Evidence`, `DegradedStatus`, `IngestRange`, `Tazelik`, etc. |
| `src/memory/db.ts` | SQLite connection wrapper. Opens/closes DB, sets WAL pragma, exposes `prepare`/`transaction` helpers. |
| `src/memory/schema.ts` | Runs migrations against a fresh or upgraded DB. Reads migration SQL files, manages `PRAGMA user_version`. |
| `src/memory/migrations/001-initial.sql` | Schema v1: all 7 tables + indexes from spec §4.1. |
| `src/memory/commit-parser.ts` | `parseCommit(subject, body)` returning `{ is_fix, is_revert, reverts_sha }`. Regex-based, stateless. |
| `src/memory/git.ts` | Shell helpers: `revParseHead`, `isShallowRepo`, `isAncestor`, `revListCount`, `logRange`, `countCommits`. Uses `child_process.execSync`. |
| `src/memory/ingest/tier1.ts` | Entry point for Tier 1 ingest. Orchestrates git log → commits + file_touches + fix_links. |
| `src/memory/ingest/fix-links.ts` | Derives `fix_links` rows from `commits` and `file_touches` using three evidence types. |
| `src/memory/worker.ts` | Worker thread entry point. Accepts `{type: 'ingest', range}` messages, runs tier1 code, posts completion. |
| `src/memory/pool.ts` | Main-thread worker pool. Spawns N workers, routes jobs, tracks completions. |
| `src/memory/freshness.ts` | `ensureFresh(db, repoPath)`: compares HEAD vs `index_state.last_indexed_sha`, enqueues delta ingest. |
| `src/memory/signals/revert-match.ts` | `computeRevertMatch(db, filePath)` — the one real signal in Plan 1. |
| `src/memory/signals/stubs.ts` | Zero-strength stubs for `hotspot`, `fix_ratio`, `coverage_decline`, `author_churn`. Plan 2 replaces these. |
| `src/memory/signals/index.ts` | `collectSignals(db, filePath, intent)` — runs all five signals, returns array. |
| `src/memory/confidence.ts` | `computeConfidence(signals, ctx)` returning `{ score, confidence }` per spec §6. |
| `src/memory/verdict.ts` | `mapVerdict(score, confidence)` returning `"low"|"medium"|"high"|"unknown"`. |
| `src/memory/envelope.ts` | Constructs the response object with `status`, `verdict`, signals, metadata. |
| `src/memory/api.ts` | Main-thread API: `blastradius({file, intent, level, diff})` orchestrating ensureFresh → signals → envelope. |

Modified files:

| Path | Change |
|---|---|
| `package.json` | Add `better-sqlite3` dependency; add `composto-blastradius` feature flag note (documentation only). |
| `src/mcp/server.ts` | Register fifth tool `composto_blastradius`. |
| `src/index.ts` | Add `impact` and `index` cases to the CLI switch. |
| `src/cli/commands.ts` | Export `runImpact(projectPath, file, options)` and `runIndex(projectPath, options)`. |
| `tsup.config.ts` | Add `src/memory/worker.ts` as an additional entry so tsup bundles the worker script. |

Test files:

| Path | Responsibility |
|---|---|
| `tests/memory/unit/commit-parser.test.ts` | Regex coverage for fix/revert patterns. |
| `tests/memory/unit/schema.test.ts` | Migration runs, tables exist, `user_version` set. |
| `tests/memory/unit/fix-links.test.ts` | All three evidence-type derivations. |
| `tests/memory/unit/confidence.test.ts` | `min()` composition, boundary values. |
| `tests/memory/unit/verdict.test.ts` | Full verdict mapping grid. |
| `tests/memory/unit/revert-match.test.ts` | Signal computes correct strength from fix_links. |
| `tests/memory/fixtures/make-small-repo.sh` | Bash script that `git init`s a repo with 20 commits, 3 fixes, 1 revert. |
| `tests/memory/integration/smoke.test.ts` | End-to-end: setup fixture → run `api.blastradius(file)` → assert envelope fields. |

---

## Task 1: Add better-sqlite3 and scaffold `src/memory/`

**Files:**
- Modify: `package.json`
- Create: `src/memory/` (directory)
- Create: `src/memory/types.ts`

- [ ] **Step 1: Add the `better-sqlite3` dependency**

```bash
pnpm add better-sqlite3@^11.5.0
pnpm add -D @types/better-sqlite3@^7.6.11
```

- [ ] **Step 2: Create the memory directory with a placeholder index**

```bash
mkdir -p src/memory/migrations src/memory/ingest src/memory/signals
```

- [ ] **Step 3: Create `src/memory/types.ts` with the shared types**

```typescript
// src/memory/types.ts
// Shared types for the Composto memory subsystem. See spec §4, §6, §7.

export type DegradedStatus =
  | "ok"
  | "empty_repo"
  | "insufficient_history"
  | "shallow_clone"
  | "indexing"
  | "squashed_history"
  | "reindexing"
  | "internal_error"
  | "disabled";

export type Tazelik = "fresh" | "catching_up" | "partial" | "bootstrapping";

export type Verdict = "low" | "medium" | "high" | "unknown";

export type SignalType =
  | "revert_match"
  | "hotspot"
  | "fix_ratio"
  | "coverage_decline"
  | "author_churn";

export type Intent =
  | "refactor"
  | "bugfix"
  | "feature"
  | "test"
  | "docs"
  | "unknown";

export type Level = "summary" | "detail";

export interface Evidence {
  commit_sha: string;
  subject: string;
  days_ago: number;
  evidence_type?: string;
}

export interface Signal {
  type: SignalType;
  strength: number;           // 0.0..1.0
  precision: number;          // 0.0..1.0
  sample_size: number;
  evidence?: Evidence[];
  // Signal-specific extras (present for some signals only)
  touches_90d?: number;
  ratio?: number;
}

export interface ResponseMetadata {
  tazelik: Tazelik;
  index_version: number;
  indexed_commits_through: string;
  indexed_commits_total: number;
  query_ms: number;
  signal_coverage: string;    // "<usable>/<total>"
}

export interface BlastRadiusResponse {
  status: DegradedStatus;
  reason?: string;
  verdict: Verdict;
  score: number;
  confidence: number;
  signals: Signal[];
  calibration: "repo-calibrated" | "heuristic";
  retry_hint_ms?: number;
  confidence_cap?: number;
  metadata: ResponseMetadata;
}

export interface IngestRange {
  from: string | null;  // null = bootstrap from first commit
  to: string;           // HEAD SHA
}

export interface BlastRadiusInput {
  file: string;
  intent?: Intent;
  level?: Level;
  diff?: string;
}
```

- [ ] **Step 4: Verify the package installs and typechecks**

```bash
pnpm install
pnpm exec tsc --noEmit
```

Expected: `tsc` completes without errors (the new file is syntactically valid).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/memory/types.ts
git commit -m "feat(memory): scaffold memory subsystem — deps + types"
```

---

## Task 2: Schema migration and DB wrapper

**Files:**
- Create: `src/memory/migrations/001-initial.sql`
- Create: `src/memory/schema.ts`
- Create: `src/memory/db.ts`
- Create: `tests/memory/unit/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/schema.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";

describe("memory schema migrations", () => {
  it("creates all tables at version 1 on a fresh DB", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-memory-"));
    const dbPath = join(dir, "memory.db");

    const db = openDatabase(dbPath);
    runMigrations(db);

    const userVersion = db.pragma("user_version", { simple: true }) as number;
    expect(userVersion).toBe(1);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "commits",
        "file_touches",
        "file_index_state",
        "fix_links",
        "index_state",
        "signal_calibration",
        "symbol_touches",
        "symbols",
      ])
    );

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("is idempotent: running migrations twice leaves version at 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-memory-"));
    const dbPath = join(dir, "memory.db");

    const db = openDatabase(dbPath);
    runMigrations(db);
    runMigrations(db);
    expect(db.pragma("user_version", { simple: true })).toBe(1);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/schema.test.ts`
Expected: FAIL with module-not-found for `db.js` / `schema.js`.

- [ ] **Step 3: Write `src/memory/migrations/001-initial.sql`**

```sql
-- src/memory/migrations/001-initial.sql
-- Composto memory schema v1. See spec §4.1.

CREATE TABLE IF NOT EXISTS index_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commits (
  sha         TEXT PRIMARY KEY,
  parent_sha  TEXT,
  author      TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,
  subject     TEXT NOT NULL,
  is_fix      INTEGER NOT NULL,
  is_revert   INTEGER NOT NULL,
  reverts_sha TEXT,
  FOREIGN KEY (reverts_sha) REFERENCES commits(sha)
);
CREATE INDEX IF NOT EXISTS idx_commits_timestamp ON commits(timestamp);
CREATE INDEX IF NOT EXISTS idx_commits_is_fix    ON commits(is_fix) WHERE is_fix = 1;

CREATE TABLE IF NOT EXISTS file_touches (
  commit_sha    TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  adds          INTEGER NOT NULL,
  dels          INTEGER NOT NULL,
  change_type   TEXT NOT NULL,
  renamed_from  TEXT,
  PRIMARY KEY (commit_sha, file_path),
  FOREIGN KEY (commit_sha) REFERENCES commits(sha)
);
CREATE INDEX IF NOT EXISTS idx_ft_file ON file_touches(file_path);

CREATE TABLE IF NOT EXISTS symbols (
  id              INTEGER PRIMARY KEY,
  file_path       TEXT NOT NULL,
  kind            TEXT NOT NULL,
  qualified_name  TEXT NOT NULL,
  first_seen_sha  TEXT NOT NULL,
  last_seen_sha   TEXT,
  UNIQUE (file_path, kind, qualified_name)
);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);

CREATE TABLE IF NOT EXISTS symbol_touches (
  commit_sha    TEXT NOT NULL,
  symbol_id     INTEGER NOT NULL,
  change_type   TEXT NOT NULL,
  PRIMARY KEY (commit_sha, symbol_id),
  FOREIGN KEY (commit_sha) REFERENCES commits(sha),
  FOREIGN KEY (symbol_id)  REFERENCES symbols(id)
);
CREATE INDEX IF NOT EXISTS idx_st_symbol ON symbol_touches(symbol_id);

CREATE TABLE IF NOT EXISTS fix_links (
  fix_commit_sha       TEXT NOT NULL,
  suspected_break_sha  TEXT NOT NULL,
  evidence_type        TEXT NOT NULL,
  confidence           REAL NOT NULL,
  window_hours         INTEGER,
  PRIMARY KEY (fix_commit_sha, suspected_break_sha, evidence_type),
  FOREIGN KEY (fix_commit_sha)      REFERENCES commits(sha),
  FOREIGN KEY (suspected_break_sha) REFERENCES commits(sha)
);
CREATE INDEX IF NOT EXISTS idx_fl_break ON fix_links(suspected_break_sha);

CREATE TABLE IF NOT EXISTS signal_calibration (
  signal_type        TEXT PRIMARY KEY,
  precision          REAL NOT NULL,
  sample_size        INTEGER NOT NULL,
  last_computed_sha  TEXT NOT NULL,
  computed_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_index_state (
  file_path            TEXT PRIMARY KEY,
  last_commit_indexed  TEXT NOT NULL,
  last_blob_indexed    TEXT,
  indexed_at           INTEGER NOT NULL,
  parse_failed         INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (last_commit_indexed) REFERENCES commits(sha)
);
```

- [ ] **Step 4: Write `src/memory/db.ts`**

```typescript
// src/memory/db.ts
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export type { DB };
```

- [ ] **Step 5: Write `src/memory/schema.ts`**

```typescript
// src/memory/schema.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DB } from "./db.js";

const CURRENT_VERSION = 1;

function migrationPath(version: number): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const name = `${String(version).padStart(3, "0")}-initial.sql`;
  return join(here, "migrations", name);
}

export function runMigrations(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current >= CURRENT_VERSION) return;

  for (let v = current + 1; v <= CURRENT_VERSION; v++) {
    const sql = readFileSync(migrationPath(v), "utf-8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.pragma(`user_version = ${v}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
```

- [ ] **Step 6: Add migrations copy to `tsup.config.ts`**

```typescript
// tsup.config.ts — add migrations copy to onSuccess
import { defineConfig } from "tsup";
import { cpSync, mkdirSync, readdirSync } from "node:fs";

export default defineConfig({
  entry: ["src/index.ts", "src/mcp/server.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  onSuccess: async () => {
    mkdirSync("dist/grammars", { recursive: true });
    for (const file of readdirSync("grammars")) {
      if (file.endsWith(".wasm")) {
        cpSync(`grammars/${file}`, `dist/grammars/${file}`);
      }
    }
    mkdirSync("dist/memory/migrations", { recursive: true });
    for (const file of readdirSync("src/memory/migrations")) {
      if (file.endsWith(".sql")) {
        cpSync(`src/memory/migrations/${file}`, `dist/memory/migrations/${file}`);
      }
    }
  },
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/schema.test.ts`
Expected: PASS (both tests).

- [ ] **Step 8: Commit**

```bash
git add src/memory/migrations src/memory/db.ts src/memory/schema.ts \
        tests/memory/unit/schema.test.ts tsup.config.ts
git commit -m "feat(memory): add schema v1 migration + SQLite wrapper"
```

---

## Task 3: Commit parser

**Files:**
- Create: `src/memory/commit-parser.ts`
- Create: `tests/memory/unit/commit-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/commit-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseCommit } from "../../../src/memory/commit-parser.js";

describe("parseCommit", () => {
  it("detects fix-style subjects", () => {
    expect(parseCommit("fix: null pointer in auth", "").is_fix).toBe(true);
    expect(parseCommit("hotfix: race in session refresh", "").is_fix).toBe(true);
    expect(parseCommit("bug: login fails on empty body", "").is_fix).toBe(true);
    expect(parseCommit("Fixes #123: crash on startup", "").is_fix).toBe(true);
  });

  it("does not flag non-fix subjects", () => {
    expect(parseCommit("feat: add OTP login", "").is_fix).toBe(false);
    expect(parseCommit("refactor: extract helper", "").is_fix).toBe(false);
    expect(parseCommit("docs: update README", "").is_fix).toBe(false);
  });

  it("detects revert subjects and extracts reverted SHA", () => {
    const body = 'This reverts commit abc1234567890abcdef.\n\nReason: flaky.';
    const r = parseCommit('Revert "feat: add OTP login"', body);
    expect(r.is_revert).toBe(true);
    expect(r.reverts_sha).toBe("abc1234567890abcdef");
  });

  it("returns reverts_sha = null when no SHA is present", () => {
    const r = parseCommit("Revert: something", "no reference here");
    expect(r.is_revert).toBe(true);
    expect(r.reverts_sha).toBeNull();
  });

  it("handles multiline subjects safely", () => {
    const r = parseCommit("fix(auth): token leak\n\nmore context here", "");
    expect(r.is_fix).toBe(true);
    expect(r.is_revert).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/commit-parser.test.ts`
Expected: FAIL with module-not-found for `commit-parser.js`.

- [ ] **Step 3: Write `src/memory/commit-parser.ts`**

```typescript
// src/memory/commit-parser.ts
// Regex-based parser for git commit subjects/bodies.
// Mirrors spec §5.1 fix/revert detection rules.

const FIX_PATTERNS: RegExp[] = [
  /\bfix(es|ed|ing)?\b/i,
  /\bbugfix\b/i,
  /\bhotfix\b/i,
  /\bpatch\b/i,
  /\bbug\b/i,
  /closes?\s+#\d+/i,
  /resolves?\s+#\d+/i,
];

const REVERT_SUBJECT = /^\s*revert\b/i;
const REVERT_BODY_SHA = /This reverts commit ([0-9a-f]{7,40})/i;

export interface ParsedCommit {
  is_fix: boolean;
  is_revert: boolean;
  reverts_sha: string | null;
}

export function parseCommit(subject: string, body: string): ParsedCommit {
  const is_revert = REVERT_SUBJECT.test(subject);
  const match = is_revert ? body.match(REVERT_BODY_SHA) : null;
  const reverts_sha = match ? match[1] : null;

  // Don't treat "revert" as a fix by default (noise).
  const is_fix =
    !is_revert && FIX_PATTERNS.some((re) => re.test(subject));

  return { is_fix, is_revert, reverts_sha };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/commit-parser.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/memory/commit-parser.ts tests/memory/unit/commit-parser.test.ts
git commit -m "feat(memory): commit-subject parser for fix/revert detection"
```

---

## Task 4: Git shell helpers

**Files:**
- Create: `src/memory/git.ts`
- Create: `tests/memory/fixtures/make-small-repo.sh`
- Create: `tests/memory/unit/git.test.ts`

- [ ] **Step 1: Write the fixture script**

```bash
# tests/memory/fixtures/make-small-repo.sh
#!/usr/bin/env bash
# Builds a deterministic small repo for tests.
# Usage: make-small-repo.sh <target_dir>
set -euo pipefail
target="${1:?target dir required}"
rm -rf "$target"
mkdir -p "$target"
cd "$target"

git init -q -b main
git config user.email "test@composto.dev"
git config user.name  "Composto Test"
export GIT_AUTHOR_DATE="2026-01-01T10:00:00Z"
export GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"

commit() {
  local msg="$1"; shift
  local datestr="$1"; shift
  export GIT_AUTHOR_DATE="$datestr"
  export GIT_COMMITTER_DATE="$datestr"
  git add -A
  git commit -q -m "$msg"
}

# 20 commits: 16 features, 3 fixes, 1 revert
echo "export function login() {}" > auth.ts
commit "feat: add login stub" "2026-01-01T10:00:00Z"

echo "export function login(u: string) {}" > auth.ts
commit "feat: login takes username" "2026-01-02T10:00:00Z"

echo "export function login(u: string, p: string) {}" > auth.ts
commit "fix: login missing password param" "2026-01-03T10:00:00Z"

echo "export function logout() {}" > session.ts
commit "feat: add logout" "2026-01-04T10:00:00Z"

echo "export function validate() {}" > token.ts
commit "feat: token validator" "2026-01-05T10:00:00Z"

echo "export function validate(t: string) {}" > token.ts
commit "fix: validate takes token" "2026-01-06T10:00:00Z"

for i in $(seq 7 16); do
  echo "// noop $i" >> notes.md
  commit "docs: note $i" "2026-01-${i}T10:00:00Z"
done

# Introduce a bug, then revert it
echo "export function validate(t: string) { throw new Error('oops') }" > token.ts
BUG_SHA=$(git rev-parse HEAD)
commit "feat: extra validation" "2026-01-17T10:00:00Z"
BUG_SHA=$(git rev-parse HEAD)

git revert --no-edit "$BUG_SHA" -q

# One more fix after the revert
echo "export function validate(t: string) { return !!t }" > token.ts
commit "fix: token validator returns boolean" "2026-01-19T10:00:00Z"

echo "Built small repo at $target with $(git rev-list --count HEAD) commits"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x tests/memory/fixtures/make-small-repo.sh
```

- [ ] **Step 3: Write the failing git helpers test**

```typescript
// tests/memory/unit/git.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  revParseHead,
  isShallowRepo,
  revListCount,
  isAncestor,
  countCommits,
} from "../../../src/memory/git.js";

describe("git helpers", () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-git-"));
    execSync(
      `bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`,
      { stdio: "ignore" }
    );
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns a full-length SHA for HEAD", () => {
    const head = revParseHead(repoDir);
    expect(head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reports not shallow for a normal repo", () => {
    expect(isShallowRepo(repoDir)).toBe(false);
  });

  it("counts commits reachable from HEAD", () => {
    expect(countCommits(repoDir)).toBeGreaterThanOrEqual(20);
  });

  it("revListCount between same SHA is 0", () => {
    const head = revParseHead(repoDir);
    expect(revListCount(repoDir, head, head)).toBe(0);
  });

  it("isAncestor returns true for HEAD~1..HEAD", () => {
    const prev = execSync("git rev-parse HEAD~1", { cwd: repoDir, encoding: "utf-8" }).trim();
    const head = revParseHead(repoDir);
    expect(isAncestor(repoDir, prev, head)).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/git.test.ts`
Expected: FAIL on module not found.

- [ ] **Step 5: Write `src/memory/git.ts`**

```typescript
// src/memory/git.ts
// Thin wrappers around child_process for the git commands
// the memory subsystem needs. All throw on failure — callers
// handle degraded modes.

import { execSync } from "node:child_process";

function run(cwd: string, cmd: string, timeoutMs = 10000): string {
  return execSync(cmd, { cwd, encoding: "utf-8", timeout: timeoutMs }).trim();
}

export function revParseHead(cwd: string): string {
  return run(cwd, "git rev-parse HEAD");
}

export function isShallowRepo(cwd: string): boolean {
  return run(cwd, "git rev-parse --is-shallow-repository") === "true";
}

export function revListCount(cwd: string, from: string, to: string): number {
  if (from === to) return 0;
  const out = run(cwd, `git rev-list --count ${from}..${to}`);
  return parseInt(out, 10);
}

export function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  try {
    execSync(`git merge-base --is-ancestor ${ancestor} ${descendant}`, {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function countCommits(cwd: string): number {
  const out = run(cwd, "git rev-list --count HEAD");
  return parseInt(out, 10);
}

// logRange returns raw NUL-delimited git log output for parsing
// in Task 5 (Tier 1 ingest). The format captures everything
// tier1 needs: SHA, parent, author, timestamp, subject, body, numstat.
export function logRange(
  cwd: string,
  from: string | null,
  to: string,
  timeoutMs = 60000
): string {
  const range = from ? `${from}..${to}` : to;
  // %x00 is NUL; use a record separator that cannot appear in commit messages
  const fmt = "--format=%x1e%H%x00%P%x00%an%x00%at%x00%s%x00%b%x1f";
  const cmd = `git log ${fmt} --numstat --no-renames ${range}`;
  return execSync(cmd, { cwd, encoding: "utf-8", timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/git.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/memory/git.ts \
        tests/memory/fixtures/make-small-repo.sh \
        tests/memory/unit/git.test.ts
git commit -m "feat(memory): git shell helpers + small-repo test fixture"
```

---

## Task 5: Tier 1 ingest — commits and file_touches

**Files:**
- Create: `src/memory/ingest/tier1.ts`
- Create: `tests/memory/integration/tier1-commits.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/integration/tier1-commits.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";

describe("tier1 ingest — commits + file_touches", () => {
  let repoDir: string;
  let dbDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-ing-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-ing-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("populates commits for the full history on bootstrap", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    const head = revParseHead(repoDir);

    ingestRange(db, repoDir, { from: null, to: head });

    const rows = db.prepare("SELECT COUNT(*) AS n FROM commits").get() as { n: number };
    expect(rows.n).toBeGreaterThanOrEqual(20);

    const fixCount = db.prepare("SELECT COUNT(*) AS n FROM commits WHERE is_fix = 1").get() as { n: number };
    expect(fixCount.n).toBeGreaterThanOrEqual(2);

    const revertCount = db.prepare("SELECT COUNT(*) AS n FROM commits WHERE is_revert = 1").get() as { n: number };
    expect(revertCount.n).toBe(1);

    db.close();
  });

  it("populates file_touches rows for each commit", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const touches = db.prepare("SELECT COUNT(*) AS n FROM file_touches").get() as { n: number };
    expect(touches.n).toBeGreaterThan(20);
    db.close();
  });

  it("sets index_state.last_indexed_sha to HEAD", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const row = db.prepare("SELECT value FROM index_state WHERE key='last_indexed_sha'").get() as { value: string };
    expect(row.value).toMatch(/^[0-9a-f]{40}$/);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/integration/tier1-commits.test.ts`
Expected: FAIL on missing `ingest/tier1.js`.

- [ ] **Step 3: Write `src/memory/ingest/tier1.ts`**

```typescript
// src/memory/ingest/tier1.ts
// Tier 1 ingest: git log → commits + file_touches.
// fix_links derivation lives in ingest/fix-links.ts (Task 6).

import type { DB } from "../db.js";
import type { IngestRange } from "../types.js";
import { logRange } from "../git.js";
import { parseCommit } from "../commit-parser.js";

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x00";
const RECORD_END = "\x1f";

interface RawCommit {
  sha: string;
  parent_sha: string | null;
  author: string;
  timestamp: number;
  subject: string;
  body: string;
  touches: Array<{
    file_path: string;
    adds: number;
    dels: number;
    change_type: string;
  }>;
}

function parseNumstatLine(line: string): { adds: number; dels: number; path: string } | null {
  // Format: "<adds>\t<dels>\t<path>" or "-\t-\t<path>" for binary
  const parts = line.split("\t");
  if (parts.length < 3) return null;
  const adds = parts[0] === "-" ? 0 : parseInt(parts[0], 10);
  const dels = parts[1] === "-" ? 0 : parseInt(parts[1], 10);
  if (Number.isNaN(adds) || Number.isNaN(dels)) return null;
  return { adds, dels, path: parts.slice(2).join("\t").trim() };
}

function parseLogOutput(output: string): RawCommit[] {
  const commits: RawCommit[] = [];
  // Each record starts with RECORD_SEP and ends with RECORD_END.
  // Body may span multiple lines; numstat follows the body before RECORD_END.
  const records = output.split(RECORD_SEP).slice(1);
  for (const rec of records) {
    const endIdx = rec.indexOf(RECORD_END);
    if (endIdx === -1) continue;
    const content = rec.slice(0, endIdx);
    const tail = rec.slice(endIdx + 1);

    const fields = content.split(FIELD_SEP);
    if (fields.length < 6) continue;
    const [sha, parent, author, tsStr, subject, ...rest] = fields;
    const body = rest.join(FIELD_SEP);

    const touches: RawCommit["touches"] = [];
    for (const line of tail.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = parseNumstatLine(trimmed);
      if (!parsed) continue;
      touches.push({
        file_path: parsed.path,
        adds: parsed.adds,
        dels: parsed.dels,
        change_type: parsed.adds > 0 && parsed.dels === 0 ? "A" : parsed.dels > 0 && parsed.adds === 0 ? "D" : "M",
      });
    }

    commits.push({
      sha,
      parent_sha: parent ? parent.split(" ")[0] : null,
      author,
      timestamp: parseInt(tsStr, 10),
      subject,
      body,
      touches,
    });
  }
  return commits;
}

export function ingestRange(db: DB, repoPath: string, range: IngestRange): number {
  const raw = logRange(repoPath, range.from, range.to);
  const commits = parseLogOutput(raw);

  const insertCommit = db.prepare(`
    INSERT OR IGNORE INTO commits
      (sha, parent_sha, author, timestamp, subject, is_fix, is_revert, reverts_sha)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTouch = db.prepare(`
    INSERT OR IGNORE INTO file_touches
      (commit_sha, file_path, adds, dels, change_type, renamed_from)
    VALUES (?, ?, ?, ?, ?, NULL)
  `);
  const upsertState = db.prepare(`
    INSERT INTO index_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const tx = db.transaction((batch: RawCommit[]) => {
    for (const c of batch) {
      const parsed = parseCommit(c.subject, c.body);
      insertCommit.run(
        c.sha,
        c.parent_sha,
        c.author,
        c.timestamp,
        c.subject,
        parsed.is_fix ? 1 : 0,
        parsed.is_revert ? 1 : 0,
        parsed.reverts_sha
      );
      for (const t of c.touches) {
        insertTouch.run(c.sha, t.file_path, t.adds, t.dels, t.change_type);
      }
    }
  });

  const BATCH = 1000;
  for (let i = 0; i < commits.length; i += BATCH) {
    tx(commits.slice(i, i + BATCH));
  }

  upsertState.run("last_indexed_sha", range.to);
  const totalRow = db.prepare("SELECT COUNT(*) AS n FROM commits").get() as { n: number };
  upsertState.run("indexed_commits_total", String(totalRow.n));

  return commits.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/integration/tier1-commits.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/memory/ingest/tier1.ts tests/memory/integration/tier1-commits.test.ts
git commit -m "feat(memory): tier1 ingest — commits + file_touches"
```

---

## Task 6: Fix-links derivation

**Files:**
- Create: `src/memory/ingest/fix-links.ts`
- Modify: `src/memory/ingest/tier1.ts` (call `deriveFixLinks` after commit ingest)
- Create: `tests/memory/unit/fix-links.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/fix-links.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";

describe("fix-links derivation", () => {
  let repoDir: string;
  let dbDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-fl-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-fl-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("creates a revert_marker link from the revert commit to the reverted commit", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    const head = revParseHead(repoDir);
    ingestRange(db, repoDir, { from: null, to: head });

    const reverts = db.prepare(`
      SELECT * FROM fix_links WHERE evidence_type = 'revert_marker'
    `).all() as Array<{ fix_commit_sha: string; suspected_break_sha: string; confidence: number }>;

    expect(reverts.length).toBe(1);
    expect(reverts[0].confidence).toBe(1.0);
    db.close();
  });

  it("creates short_followup_fix links for fixes following prior touches within 72h", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const links = db.prepare(`
      SELECT * FROM fix_links WHERE evidence_type = 'short_followup_fix'
    `).all();
    // small-repo has at least one fix following a recent touch on the same file
    expect(links.length).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/fix-links.test.ts`
Expected: FAIL — `fix_links` table empty because no derivation runs yet.

- [ ] **Step 3: Write `src/memory/ingest/fix-links.ts`**

```typescript
// src/memory/ingest/fix-links.ts
// Derives fix_links from commits + file_touches using three evidence types
// defined in spec §5.1:
//   - revert_marker: is_revert commit links to reverts_sha
//   - short_followup_fix: a fix commit links to prior commits touching
//     the same files within WINDOW_HOURS
//   - same_region_fix_chain: three+ fix commits clustered on the same file
//     within CHAIN_WINDOW_DAYS are cross-linked to prior non-fix touches
//     in the same cluster

import type { DB } from "../db.js";

const FOLLOWUP_WINDOW_HOURS = 72;
const CHAIN_WINDOW_DAYS = 14;
const CHAIN_MIN = 3;

export function deriveFixLinks(db: DB): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO fix_links
      (fix_commit_sha, suspected_break_sha, evidence_type, confidence, window_hours)
    VALUES (?, ?, ?, ?, ?)
  `);

  // 1. revert_marker
  const reverts = db.prepare(`
    SELECT sha, reverts_sha FROM commits
    WHERE is_revert = 1 AND reverts_sha IS NOT NULL
  `).all() as Array<{ sha: string; reverts_sha: string }>;

  for (const r of reverts) {
    // Only link if the reverted SHA is actually in our commits table
    const exists = db.prepare("SELECT 1 FROM commits WHERE sha = ?").get(r.reverts_sha);
    if (exists) insert.run(r.sha, r.reverts_sha, "revert_marker", 1.0, null);
  }

  // 2. short_followup_fix
  const fixes = db.prepare(`
    SELECT sha, timestamp FROM commits WHERE is_fix = 1
  `).all() as Array<{ sha: string; timestamp: number }>;

  const priorByFile = db.prepare(`
    SELECT c.sha AS prior_sha
      FROM file_touches ft_fix
      JOIN file_touches ft_prior ON ft_prior.file_path = ft_fix.file_path
      JOIN commits c ON c.sha = ft_prior.commit_sha
     WHERE ft_fix.commit_sha = ?
       AND c.timestamp < ?
       AND c.timestamp >= ?
       AND c.sha != ?
       AND c.is_fix = 0
       AND c.is_revert = 0
  `);

  for (const f of fixes) {
    const lowerBound = f.timestamp - FOLLOWUP_WINDOW_HOURS * 3600;
    const priors = priorByFile.all(f.sha, f.timestamp, lowerBound, f.sha) as Array<{ prior_sha: string }>;
    const unique = new Set(priors.map((p) => p.prior_sha));
    for (const prior of unique) {
      insert.run(f.sha, prior, "short_followup_fix", 0.7, FOLLOWUP_WINDOW_HOURS);
    }
  }

  // 3. same_region_fix_chain
  // For each file, find windows of >= CHAIN_MIN fix commits within CHAIN_WINDOW_DAYS.
  // Link every fix in the window to the earliest non-fix touch immediately preceding
  // the window.
  const filesWithFixes = db.prepare(`
    SELECT DISTINCT ft.file_path
      FROM file_touches ft
      JOIN commits c ON c.sha = ft.commit_sha
     WHERE c.is_fix = 1
  `).all() as Array<{ file_path: string }>;

  const fixesOnFile = db.prepare(`
    SELECT c.sha, c.timestamp
      FROM commits c
      JOIN file_touches ft ON ft.commit_sha = c.sha
     WHERE ft.file_path = ? AND c.is_fix = 1
     ORDER BY c.timestamp ASC
  `);

  const priorNonFixOnFile = db.prepare(`
    SELECT c.sha
      FROM commits c
      JOIN file_touches ft ON ft.commit_sha = c.sha
     WHERE ft.file_path = ?
       AND c.timestamp < ?
       AND c.is_fix = 0 AND c.is_revert = 0
     ORDER BY c.timestamp DESC
     LIMIT 1
  `);

  for (const { file_path } of filesWithFixes) {
    const rows = fixesOnFile.all(file_path) as Array<{ sha: string; timestamp: number }>;
    const windowSec = CHAIN_WINDOW_DAYS * 86400;
    for (let i = 0; i + CHAIN_MIN - 1 < rows.length; i++) {
      const windowEnd = rows[i + CHAIN_MIN - 1];
      if (windowEnd.timestamp - rows[i].timestamp > windowSec) continue;
      const prior = priorNonFixOnFile.get(file_path, rows[i].timestamp) as { sha: string } | undefined;
      if (!prior) continue;
      for (let j = i; j < rows.length && rows[j].timestamp - rows[i].timestamp <= windowSec; j++) {
        insert.run(rows[j].sha, prior.sha, "same_region_fix_chain", 0.4, CHAIN_WINDOW_DAYS * 24);
      }
    }
  }
}
```

- [ ] **Step 4: Wire `deriveFixLinks` into `ingestRange`**

```typescript
// src/memory/ingest/tier1.ts — add at the top
import { deriveFixLinks } from "./fix-links.js";

// src/memory/ingest/tier1.ts — inside ingestRange, after the BATCH loop
// and before the upsertState calls:
  deriveFixLinks(db);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/fix-links.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/memory/ingest/fix-links.ts src/memory/ingest/tier1.ts \
        tests/memory/unit/fix-links.test.ts
git commit -m "feat(memory): derive fix_links via three evidence types"
```

---

## Task 7: Worker thread skeleton

**Files:**
- Create: `src/memory/worker.ts`
- Create: `src/memory/pool.ts`
- Create: `tests/memory/unit/pool.test.ts`
- Modify: `tsup.config.ts` (add worker as an entry)

- [ ] **Step 1: Add the worker entry to tsup**

```typescript
// tsup.config.ts — update entry list
  entry: ["src/index.ts", "src/mcp/server.ts", "src/memory/worker.ts"],
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/memory/unit/pool.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { WorkerPool } from "../../../src/memory/pool.js";

describe("WorkerPool", () => {
  let pool: WorkerPool | null = null;
  let repoDir = "";
  let dbPath = "";

  afterEach(async () => {
    if (pool) await pool.close();
    pool = null;
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
    if (dbPath) rmSync(dbPath, { force: true });
  });

  it("dispatches an ingest job to a worker and receives completion", async () => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-pool-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbPath = join(mkdtempSync(join(tmpdir(), "composto-pool-db-")), "memory.db");

    pool = new WorkerPool({ size: 1 });
    const result = await pool.runIngest({
      dbPath,
      repoPath: repoDir,
      range: { from: null, to: execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf-8" }).trim() },
    });

    expect(result.status).toBe("done");
    expect(result.commits).toBeGreaterThanOrEqual(20);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/pool.test.ts`
Expected: FAIL on missing `pool.js`.

- [ ] **Step 4: Write `src/memory/worker.ts`**

```typescript
// src/memory/worker.ts
// Worker thread entry. Accepts {type: 'ingest'} messages and runs tier1 ingest.
// Uses its own DB connection; main thread's DB is separate.

import { parentPort } from "node:worker_threads";
import { openDatabase } from "./db.js";
import { runMigrations } from "./schema.js";
import { ingestRange } from "./ingest/tier1.js";
import type { IngestRange } from "./types.js";

type InMessage =
  | { type: "ingest"; jobId: number; dbPath: string; repoPath: string; range: IngestRange };

type OutMessage =
  | { type: "ingest_done"; jobId: number; commits: number }
  | { type: "ingest_error"; jobId: number; message: string };

if (!parentPort) {
  throw new Error("memory/worker.ts must run inside a Worker");
}

parentPort.on("message", (msg: InMessage) => {
  if (msg.type === "ingest") {
    try {
      const db = openDatabase(msg.dbPath);
      runMigrations(db);
      const n = ingestRange(db, msg.repoPath, msg.range);
      db.close();
      const out: OutMessage = { type: "ingest_done", jobId: msg.jobId, commits: n };
      parentPort!.postMessage(out);
    } catch (err) {
      const out: OutMessage = {
        type: "ingest_error",
        jobId: msg.jobId,
        message: err instanceof Error ? err.message : String(err),
      };
      parentPort!.postMessage(out);
    }
  }
});
```

- [ ] **Step 5: Write `src/memory/pool.ts`**

```typescript
// src/memory/pool.ts
// Main-thread worker pool. Plan 1 uses size=1 by default; parallelism
// is added in Plan 2 when bootstrap ranges get partitioned.

import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { IngestRange } from "./types.js";

export interface IngestResult {
  status: "done";
  commits: number;
}

interface PendingJob {
  resolve: (r: IngestResult) => void;
  reject: (err: Error) => void;
}

function resolveWorkerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // In dev (tsx) here is src/memory; in dist here is dist (flattened).
  // worker.ts lives alongside pool.ts after tsup output.
  return join(here, "worker.js");
}

export class WorkerPool {
  private workers: Worker[] = [];
  private nextJobId = 1;
  private pending = new Map<number, PendingJob>();

  constructor(opts: { size?: number } = {}) {
    const size = Math.max(1, opts.size ?? 1);
    for (let i = 0; i < size; i++) this.spawn();
  }

  private spawn(): void {
    const worker = new Worker(resolveWorkerPath());
    worker.on("message", (msg: any) => {
      const job = this.pending.get(msg.jobId);
      if (!job) return;
      this.pending.delete(msg.jobId);
      if (msg.type === "ingest_done") {
        job.resolve({ status: "done", commits: msg.commits });
      } else if (msg.type === "ingest_error") {
        job.reject(new Error(msg.message));
      }
    });
    worker.on("error", (err) => {
      for (const job of this.pending.values()) job.reject(err);
      this.pending.clear();
    });
    this.workers.push(worker);
  }

  runIngest(args: { dbPath: string; repoPath: string; range: IngestRange }): Promise<IngestResult> {
    const jobId = this.nextJobId++;
    const worker = this.workers[jobId % this.workers.length];
    return new Promise((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject });
      worker.postMessage({ type: "ingest", jobId, ...args });
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.pending.clear();
  }
}
```

- [ ] **Step 6: Build before running pool test**

The pool loads a compiled worker file. Build once so `dist/memory/worker.js` exists.

Run: `pnpm build`
Expected: build succeeds; `dist/memory/worker.js` present.

*(Task 17's integration test will run against the dist build too. During dev iteration the engineer runs `pnpm build` once per change to worker code.)*

- [ ] **Step 7: Update the test to load from dist**

```typescript
// tests/memory/unit/pool.test.ts — adjust import to dist build
// (revisit once we have a tsx-based runner; for Plan 1 we test against
// the bundled worker to match production behavior)
import { WorkerPool } from "../../../dist/memory/pool.js";
```

- [ ] **Step 8: Run the pool test**

Run: `pnpm exec vitest run tests/memory/unit/pool.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/memory/worker.ts src/memory/pool.ts \
        tests/memory/unit/pool.test.ts tsup.config.ts
git commit -m "feat(memory): worker thread + pool for ingest jobs"
```

---

## Task 8: Freshness check

**Files:**
- Create: `src/memory/freshness.ts`
- Create: `tests/memory/unit/freshness.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/freshness.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { ensureFresh } from "../../../src/memory/freshness.js";
import { revParseHead } from "../../../src/memory/git.js";

describe("ensureFresh", () => {
  let repoDir = "";
  let dbDir = "";

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-fresh-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-fresh-db-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("reports 'bootstrapping' when DB has no last_indexed_sha", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    const res = ensureFresh(db, repoDir);
    expect(res.tazelik).toBe("bootstrapping");
    expect(res.delta).toEqual({ from: null, to: expect.any(String) });
    db.close();
  });

  it("reports 'fresh' when last_indexed_sha matches HEAD", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });
    const res = ensureFresh(db, repoDir);
    expect(res.tazelik).toBe("fresh");
    expect(res.delta).toBeNull();
    db.close();
  });

  it("reports 'catching_up' and delta when HEAD has advanced", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    // Advance HEAD by one commit
    execSync("git commit --allow-empty -m 'chore: advance'", {
      cwd: repoDir,
      stdio: "ignore",
    });

    const res = ensureFresh(db, repoDir);
    expect(res.tazelik).toBe("catching_up");
    expect(res.delta?.from).not.toBeNull();
    expect(res.behind_by).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/freshness.test.ts`
Expected: FAIL on missing `freshness.js`.

- [ ] **Step 3: Write `src/memory/freshness.ts`**

```typescript
// src/memory/freshness.ts
import type { DB } from "./db.js";
import type { IngestRange, Tazelik } from "./types.js";
import { revParseHead, isAncestor, revListCount } from "./git.js";

export interface FreshnessResult {
  tazelik: Tazelik;
  head: string;
  delta: IngestRange | null;   // null when fresh
  behind_by: number;           // commits HEAD is ahead of last_indexed
  rewritten: boolean;          // true if last_indexed_sha no longer reachable
}

export function ensureFresh(db: DB, repoPath: string): FreshnessResult {
  const head = revParseHead(repoPath);
  const row = db
    .prepare("SELECT value FROM index_state WHERE key = 'last_indexed_sha'")
    .get() as { value: string } | undefined;

  if (!row) {
    return {
      tazelik: "bootstrapping",
      head,
      delta: { from: null, to: head },
      behind_by: 0,
      rewritten: false,
    };
  }

  const last = row.value;
  if (last === head) {
    return { tazelik: "fresh", head, delta: null, behind_by: 0, rewritten: false };
  }

  const reachable = isAncestor(repoPath, last, head);
  if (!reachable) {
    return {
      tazelik: "bootstrapping",
      head,
      delta: { from: null, to: head },
      behind_by: 0,
      rewritten: true,
    };
  }

  const behind_by = revListCount(repoPath, last, head);
  return {
    tazelik: "catching_up",
    head,
    delta: { from: last, to: head },
    behind_by,
    rewritten: false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/freshness.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/memory/freshness.ts tests/memory/unit/freshness.test.ts
git commit -m "feat(memory): ensureFresh with history-rewrite detection"
```

---

## Task 9: revert_match signal

**Files:**
- Create: `src/memory/signals/revert-match.ts`
- Create: `tests/memory/unit/revert-match.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/revert-match.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { computeRevertMatch } from "../../../src/memory/signals/revert-match.js";

describe("revert_match signal", () => {
  let repoDir = "";
  let dbDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-rm-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-rm-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("fires with strength 1.0 for a file touched by a reverted commit", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    const sig = computeRevertMatch(db, "token.ts");
    expect(sig.type).toBe("revert_match");
    expect(sig.strength).toBe(1.0);
    expect(sig.evidence?.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("returns strength 0 for a file with no revert history", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const sig = computeRevertMatch(db, "nonexistent.ts");
    expect(sig.strength).toBe(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/revert-match.test.ts`
Expected: FAIL on missing `revert-match.js`.

- [ ] **Step 3: Write `src/memory/signals/revert-match.ts`**

```typescript
// src/memory/signals/revert-match.ts
import type { DB } from "../db.js";
import type { Signal, Evidence } from "../types.js";

// Strength per evidence type per spec §6.2.
const STRENGTH_BY_EVIDENCE: Record<string, number> = {
  revert_marker: 1.0,
  short_followup_fix: 0.7,
  same_region_fix_chain: 0.4,
};

// Plan 1 uses a fallback precision; Plan 2 computes this from signal_calibration.
const FALLBACK_PRECISION = 0.5;
const MAX_EVIDENCE = 5;

export function computeRevertMatch(db: DB, filePath: string): Signal {
  const rows = db
    .prepare(`
      SELECT fl.evidence_type, fl.confidence, fl.suspected_break_sha,
             c.subject, c.timestamp
        FROM fix_links fl
        JOIN file_touches ft ON ft.commit_sha = fl.suspected_break_sha
        JOIN commits c ON c.sha = fl.suspected_break_sha
       WHERE ft.file_path = ?
       ORDER BY c.timestamp DESC
       LIMIT ?
    `)
    .all(filePath, MAX_EVIDENCE) as Array<{
      evidence_type: string;
      confidence: number;
      suspected_break_sha: string;
      subject: string;
      timestamp: number;
    }>;

  if (rows.length === 0) {
    return {
      type: "revert_match",
      strength: 0,
      precision: FALLBACK_PRECISION,
      sample_size: 0,
      evidence: [],
    };
  }

  // Take max strength across matched evidence types
  let strength = 0;
  const evidence: Evidence[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const r of rows) {
    const s = STRENGTH_BY_EVIDENCE[r.evidence_type] ?? 0;
    if (s > strength) strength = s;
    evidence.push({
      commit_sha: r.suspected_break_sha,
      subject: r.subject,
      days_ago: Math.floor((now - r.timestamp) / 86400),
      evidence_type: r.evidence_type,
    });
  }

  return {
    type: "revert_match",
    strength,
    precision: FALLBACK_PRECISION,
    sample_size: rows.length,
    evidence,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/revert-match.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/memory/signals/revert-match.ts tests/memory/unit/revert-match.test.ts
git commit -m "feat(memory): revert_match signal from fix_links evidence"
```

---

## Task 10: Signal orchestrator with stubs for remaining four

**Files:**
- Create: `src/memory/signals/stubs.ts`
- Create: `src/memory/signals/index.ts`

- [ ] **Step 1: Write `src/memory/signals/stubs.ts`**

```typescript
// src/memory/signals/stubs.ts
// Placeholder implementations for the four signals filled in by Plan 2.
// Each returns zero strength and a conservative fallback precision so that
// confidence math in Plan 1 degrades gracefully: coverage_factor drops when
// these signals do not contribute.

import type { DB } from "../db.js";
import type { Signal, SignalType } from "../types.js";

const FALLBACK_PRECISION = 0.3;

function zeroSignal(type: SignalType): Signal {
  return {
    type,
    strength: 0,
    precision: FALLBACK_PRECISION,
    sample_size: 0,
    evidence: [],
  };
}

export function computeHotspot(_db: DB, _filePath: string): Signal {
  return zeroSignal("hotspot");
}
export function computeFixRatio(_db: DB, _filePath: string): Signal {
  return zeroSignal("fix_ratio");
}
export function computeCoverageDecline(_db: DB, _filePath: string): Signal {
  return zeroSignal("coverage_decline");
}
export function computeAuthorChurn(_db: DB, _filePath: string): Signal {
  return zeroSignal("author_churn");
}
```

- [ ] **Step 2: Write `src/memory/signals/index.ts`**

```typescript
// src/memory/signals/index.ts
import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { computeRevertMatch } from "./revert-match.js";
import {
  computeHotspot,
  computeFixRatio,
  computeCoverageDecline,
  computeAuthorChurn,
} from "./stubs.js";

export function collectSignals(db: DB, filePath: string): Signal[] {
  return [
    computeRevertMatch(db, filePath),
    computeHotspot(db, filePath),
    computeFixRatio(db, filePath),
    computeCoverageDecline(db, filePath),
    computeAuthorChurn(db, filePath),
  ];
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/memory/signals/stubs.ts src/memory/signals/index.ts
git commit -m "feat(memory): signals orchestrator + stubs for Plan 2 signals"
```

---

## Task 11: Confidence math

**Files:**
- Create: `src/memory/confidence.ts`
- Create: `tests/memory/unit/confidence.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/confidence.test.ts
import { describe, it, expect } from "vitest";
import { computeScoreAndConfidence } from "../../../src/memory/confidence.js";
import type { Signal } from "../../../src/memory/types.js";

function signal(s: Partial<Signal>): Signal {
  return {
    type: "revert_match",
    strength: 0,
    precision: 0.5,
    sample_size: 0,
    ...s,
  };
}

describe("computeScoreAndConfidence", () => {
  it("returns zero score when no signal fires", () => {
    const { score, confidence } = computeScoreAndConfidence(
      [signal({ strength: 0 }), signal({ type: "hotspot", strength: 0, precision: 0.3 })],
      { tazelik: "fresh", partial: false, totalCommits: 1500 }
    );
    expect(score).toBe(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("weights signals by their precision", () => {
    const { score } = computeScoreAndConfidence(
      [
        signal({ strength: 1.0, precision: 0.8, sample_size: 50 }),
        signal({ type: "hotspot", strength: 0.5, precision: 0.4, sample_size: 30 }),
      ],
      { tazelik: "fresh", partial: false, totalCommits: 1500 }
    );
    // Numerator = 1.0*0.8 + 0.5*0.4 = 1.0
    // Denominator = 0.8 + 0.4 = 1.2
    // score ≈ 0.833
    expect(score).toBeCloseTo(0.833, 2);
  });

  it("confidence is dominated by the weakest factor", () => {
    const { confidence } = computeScoreAndConfidence(
      [signal({ strength: 1.0, precision: 0.9, sample_size: 5 })],
      { tazelik: "fresh", partial: false, totalCommits: 30 }
    );
    // history_factor = 0.2 (n<50); calibration_factor = 0.3 (sample<20)
    // coverage_factor = 1/3; freshness_factor = 1.0
    // min = 0.2
    expect(confidence).toBeCloseTo(0.2, 2);
  });

  it("bootstrapping drops freshness_factor to 0.2", () => {
    const { confidence } = computeScoreAndConfidence(
      [signal({ strength: 1.0, precision: 0.9, sample_size: 100 })],
      { tazelik: "bootstrapping", partial: false, totalCommits: 2000 }
    );
    expect(confidence).toBeCloseTo(0.2, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/confidence.test.ts`
Expected: FAIL on missing `confidence.js`.

- [ ] **Step 3: Write `src/memory/confidence.ts`**

```typescript
// src/memory/confidence.ts
// Implements spec §6.1–6.3: score and confidence math.

import type { Signal, Tazelik } from "./types.js";

export interface ConfidenceContext {
  tazelik: Tazelik;
  partial: boolean;
  totalCommits: number;
}

export interface ScoreAndConfidence {
  score: number;
  confidence: number;
}

const USABLE_SAMPLE_THRESHOLD = 20;

function coverageFactor(signals: Signal[]): number {
  const usable = signals.filter(
    (s) => s.strength > 0 && s.sample_size >= USABLE_SAMPLE_THRESHOLD
  ).length;
  return Math.min(1.0, usable / 3);
}

function calibrationFactor(signals: Signal[]): number {
  const firing = signals.filter((s) => s.strength > 0);
  if (firing.length === 0) return 1.0;
  const avg = firing.reduce((acc, s) => acc + s.sample_size, 0) / firing.length;
  if (avg < 20) return 0.3;
  if (avg < 100) return 0.6;
  return 1.0;
}

function freshnessFactor(ctx: ConfidenceContext): number {
  if (ctx.partial) return 0.4;
  switch (ctx.tazelik) {
    case "fresh":         return 1.0;
    case "catching_up":   return 0.8;
    case "partial":       return 0.4;
    case "bootstrapping": return 0.2;
  }
}

function historyFactor(totalCommits: number): number {
  if (totalCommits < 50) return 0.2;
  if (totalCommits < 200) return 0.5;
  if (totalCommits < 1000) return 0.8;
  return 1.0;
}

export function computeScoreAndConfidence(
  signals: Signal[],
  ctx: ConfidenceContext
): ScoreAndConfidence {
  let num = 0;
  let den = 0;
  for (const s of signals) {
    if (s.strength <= 0 || s.precision <= 0) continue;
    num += s.strength * s.precision;
    den += s.precision;
  }
  const score = den === 0 ? 0 : num / den;

  const confidence = Math.min(
    coverageFactor(signals),
    calibrationFactor(signals),
    freshnessFactor(ctx),
    historyFactor(ctx.totalCommits)
  );

  return { score, confidence };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/confidence.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/memory/confidence.ts tests/memory/unit/confidence.test.ts
git commit -m "feat(memory): score + confidence math (weakest-link min)"
```

---

## Task 12: Verdict mapping

**Files:**
- Create: `src/memory/verdict.ts`
- Create: `tests/memory/unit/verdict.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/verdict.test.ts
import { describe, it, expect } from "vitest";
import { mapVerdict } from "../../../src/memory/verdict.js";

describe("mapVerdict", () => {
  it("returns 'unknown' whenever confidence < 0.3 regardless of score", () => {
    expect(mapVerdict(0.1, 0.2)).toBe("unknown");
    expect(mapVerdict(0.9, 0.29)).toBe("unknown");
  });

  it("returns 'low' for score < 0.3 at sufficient confidence", () => {
    expect(mapVerdict(0.1, 0.5)).toBe("low");
    expect(mapVerdict(0.29, 0.9)).toBe("low");
  });

  it("returns 'medium' for 0.3 <= score < 0.6 at sufficient confidence", () => {
    expect(mapVerdict(0.3, 0.5)).toBe("medium");
    expect(mapVerdict(0.59, 0.8)).toBe("medium");
  });

  it("returns 'high' for score >= 0.6 at sufficient confidence", () => {
    expect(mapVerdict(0.6, 0.5)).toBe("high");
    expect(mapVerdict(0.95, 1.0)).toBe("high");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/verdict.test.ts`
Expected: FAIL on missing `verdict.js`.

- [ ] **Step 3: Write `src/memory/verdict.ts`**

```typescript
// src/memory/verdict.ts
// Maps (score, confidence) → verdict per spec §6.4.

import type { Verdict } from "./types.js";

export function mapVerdict(score: number, confidence: number): Verdict {
  if (confidence < 0.3) return "unknown";
  if (score < 0.3)  return "low";
  if (score < 0.6)  return "medium";
  return "high";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/verdict.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/memory/verdict.ts tests/memory/unit/verdict.test.ts
git commit -m "feat(memory): verdict mapping with confidence override"
```

---

## Task 13: Envelope builder

**Files:**
- Create: `src/memory/envelope.ts`
- Create: `tests/memory/unit/envelope.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/envelope.test.ts
import { describe, it, expect } from "vitest";
import { buildEnvelope } from "../../../src/memory/envelope.js";
import type { Signal } from "../../../src/memory/types.js";

const s: Signal[] = [
  { type: "revert_match", strength: 1.0, precision: 0.5, sample_size: 25, evidence: [] },
  { type: "hotspot", strength: 0, precision: 0.3, sample_size: 0, evidence: [] },
  { type: "fix_ratio", strength: 0, precision: 0.3, sample_size: 0, evidence: [] },
  { type: "coverage_decline", strength: 0, precision: 0.3, sample_size: 0, evidence: [] },
  { type: "author_churn", strength: 0, precision: 0.3, sample_size: 0, evidence: [] },
];

describe("buildEnvelope", () => {
  it("assembles a valid ok response", () => {
    const env = buildEnvelope({
      status: "ok",
      signals: s,
      score: 0.5,
      confidence: 0.4,
      tazelik: "fresh",
      indexedThrough: "abc123",
      indexedTotal: 1500,
      queryMs: 18,
    });
    expect(env.status).toBe("ok");
    expect(env.verdict).toBe("medium");
    expect(env.signals.length).toBe(5);
    expect(env.metadata.signal_coverage).toBe("1/5");
    expect(env.calibration).toBe("heuristic"); // Plan 1 default
  });

  it("sets verdict 'unknown' when confidence is below threshold", () => {
    const env = buildEnvelope({
      status: "ok",
      signals: s,
      score: 0.9,
      confidence: 0.2,
      tazelik: "bootstrapping",
      indexedThrough: "abc123",
      indexedTotal: 30,
      queryMs: 5,
    });
    expect(env.verdict).toBe("unknown");
  });

  it("applies confidence_cap on degraded statuses", () => {
    const env = buildEnvelope({
      status: "empty_repo",
      signals: [],
      score: 0,
      confidence: 1.0,
      tazelik: "fresh",
      indexedThrough: "",
      indexedTotal: 0,
      queryMs: 1,
      reason: "repo has 2 commits; blastradius requires >= 10",
    });
    expect(env.status).toBe("empty_repo");
    expect(env.confidence).toBeLessThanOrEqual(0.0);
    expect(env.verdict).toBe("unknown");
    expect(env.reason).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/envelope.test.ts`
Expected: FAIL on missing `envelope.js`.

- [ ] **Step 3: Write `src/memory/envelope.ts`**

```typescript
// src/memory/envelope.ts
// Assembles the BlastRadiusResponse envelope with all invariants from spec §7.5.

import type {
  BlastRadiusResponse,
  Signal,
  DegradedStatus,
  Tazelik,
} from "./types.js";
import { mapVerdict } from "./verdict.js";

interface BuildArgs {
  status: DegradedStatus;
  signals: Signal[];
  score: number;
  confidence: number;
  tazelik: Tazelik;
  indexedThrough: string;
  indexedTotal: number;
  queryMs: number;
  reason?: string;
  retry_hint_ms?: number;
}

// Degraded-mode confidence caps per spec §6.5.
// Plan 1 covers only the subset it supports; others map to 0.0 pending Plan 3.
const CONFIDENCE_CAP: Record<DegradedStatus, number> = {
  ok:                    1.0,
  empty_repo:            0.0,
  insufficient_history:  0.3,
  shallow_clone:         0.0,
  indexing:              0.4,
  squashed_history:      0.5,
  reindexing:            0.0,
  internal_error:        0.0,
  disabled:              0.0,
};

const USABLE_SAMPLE_THRESHOLD = 20;

export function buildEnvelope(args: BuildArgs): BlastRadiusResponse {
  const cap = CONFIDENCE_CAP[args.status];
  const cappedConfidence = Math.min(args.confidence, cap);
  const verdict = mapVerdict(args.score, cappedConfidence);

  const usable = args.signals.filter(
    (s) => s.strength > 0 && s.sample_size >= USABLE_SAMPLE_THRESHOLD
  ).length;

  return {
    status: args.status,
    reason: args.reason,
    verdict,
    score: args.score,
    confidence: cappedConfidence,
    signals: args.signals,
    calibration: "heuristic", // Plan 2 flips this when repo-calibrated data exists
    retry_hint_ms: args.retry_hint_ms,
    confidence_cap: args.status === "ok" ? undefined : cap,
    metadata: {
      tazelik: args.tazelik,
      index_version: 1,
      indexed_commits_through: args.indexedThrough,
      indexed_commits_total: args.indexedTotal,
      query_ms: args.queryMs,
      signal_coverage: `${usable}/${args.signals.length}`,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/envelope.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/memory/envelope.ts tests/memory/unit/envelope.test.ts
git commit -m "feat(memory): response envelope builder with confidence caps"
```

---

## Task 14: Main-thread API — `blastradius()`

**Files:**
- Create: `src/memory/api.ts`
- Create: `tests/memory/integration/api-blastradius.test.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
// tests/memory/integration/api-blastradius.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryAPI } from "../../../dist/memory/api.js";

describe("MemoryAPI.blastradius end-to-end", () => {
  let repoDir = "";
  let dbDir = "";
  let api: MemoryAPI;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-api-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-api-db-"));

    api = new MemoryAPI({ dbPath: join(dbDir, "memory.db"), repoPath: repoDir });
    await api.bootstrapIfNeeded();
  });

  afterAll(async () => {
    await api.close();
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("returns an ok response with a verdict for a file touched by a revert", async () => {
    const res = await api.blastradius({ file: "token.ts" });
    expect(res.status).toBe("ok");
    expect(res.signals.length).toBe(5);
    const revert = res.signals.find((s) => s.type === "revert_match");
    expect(revert?.strength).toBeGreaterThan(0);
    expect(res.metadata.indexed_commits_through).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns status 'empty_repo' on a repo with <10 commits", async () => {
    const shortRepo = mkdtempSync(join(tmpdir(), "composto-short-"));
    execSync(`git init -q -b main && git config user.email x@y && git config user.name x`, { cwd: shortRepo, shell: "/bin/bash" });
    for (let i = 0; i < 3; i++) {
      execSync(`git commit --allow-empty -m 'c${i}'`, { cwd: shortRepo });
    }
    const shortDb = mkdtempSync(join(tmpdir(), "composto-short-db-"));
    const shortApi = new MemoryAPI({ dbPath: join(shortDb, "memory.db"), repoPath: shortRepo });
    await shortApi.bootstrapIfNeeded();

    const res = await shortApi.blastradius({ file: "any.ts" });
    expect(res.status).toBe("empty_repo");
    expect(res.verdict).toBe("unknown");
    await shortApi.close();
    rmSync(shortRepo, { recursive: true, force: true });
    rmSync(shortDb, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && pnpm exec vitest run tests/memory/integration/api-blastradius.test.ts`
Expected: FAIL on missing `api.js` in dist.

- [ ] **Step 3: Write `src/memory/api.ts`**

```typescript
// src/memory/api.ts
// Main-thread orchestration: ensureFresh → collect signals → envelope.
// Ingest is delegated to the worker pool (Task 7).

import { openDatabase, type DB } from "./db.js";
import { runMigrations } from "./schema.js";
import { ensureFresh } from "./freshness.js";
import { collectSignals } from "./signals/index.js";
import { computeScoreAndConfidence } from "./confidence.js";
import { buildEnvelope } from "./envelope.js";
import { WorkerPool } from "./pool.js";
import { countCommits, isShallowRepo } from "./git.js";
import type {
  BlastRadiusInput,
  BlastRadiusResponse,
  DegradedStatus,
  Tazelik,
} from "./types.js";

const EMPTY_REPO_THRESHOLD = 10;

export interface MemoryAPIOptions {
  dbPath: string;
  repoPath: string;
  workerPoolSize?: number;
}

export class MemoryAPI {
  private db: DB;
  private pool: WorkerPool;
  private readonly dbPath: string;
  private readonly repoPath: string;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(opts: MemoryAPIOptions) {
    this.dbPath = opts.dbPath;
    this.repoPath = opts.repoPath;
    this.db = openDatabase(opts.dbPath);
    runMigrations(this.db);
    this.pool = new WorkerPool({ size: opts.workerPoolSize ?? 1 });
  }

  async bootstrapIfNeeded(): Promise<void> {
    if (this.bootstrapPromise) return this.bootstrapPromise;

    const fresh = ensureFresh(this.db, this.repoPath);
    if (fresh.tazelik === "fresh" || !fresh.delta) return;

    this.bootstrapPromise = this.pool
      .runIngest({ dbPath: this.dbPath, repoPath: this.repoPath, range: fresh.delta })
      .then(() => undefined)
      .finally(() => {
        this.bootstrapPromise = null;
      });
    return this.bootstrapPromise;
  }

  async blastradius(input: BlastRadiusInput): Promise<BlastRadiusResponse> {
    const start = Date.now();

    // 1. Degraded detection: shallow clone
    if (isShallowRepo(this.repoPath)) {
      return buildEnvelope({
        status: "shallow_clone",
        signals: [],
        score: 0,
        confidence: 0,
        tazelik: "fresh",
        indexedThrough: "",
        indexedTotal: 0,
        queryMs: Date.now() - start,
        reason: "shallow clone detected; run `composto index --deepen`",
      });
    }

    // 2. Degraded detection: empty / insufficient
    const totalCommits = countCommits(this.repoPath);
    if (totalCommits < EMPTY_REPO_THRESHOLD) {
      return buildEnvelope({
        status: "empty_repo",
        signals: [],
        score: 0,
        confidence: 0,
        tazelik: "fresh",
        indexedThrough: "",
        indexedTotal: totalCommits,
        queryMs: Date.now() - start,
        reason: `repo has ${totalCommits} commits; blastradius requires >= ${EMPTY_REPO_THRESHOLD}`,
      });
    }

    // 3. Freshness + deferred delta ingest
    const fresh = ensureFresh(this.db, this.repoPath);
    let status: DegradedStatus = "ok";
    let partial = false;

    if (fresh.tazelik === "bootstrapping") {
      // No data yet — block until bootstrap completes rather than returning
      // a retry hint. Plan 3 revisits this with a partial last-50-commit path.
      await this.bootstrapIfNeeded();
    } else if (fresh.tazelik === "catching_up" && fresh.delta) {
      // Fire-and-forget: main call answers from current index, delta in background.
      this.pool
        .runIngest({ dbPath: this.dbPath, repoPath: this.repoPath, range: fresh.delta })
        .catch(() => { /* Plan 3 adds logging */ });
    }

    const indexedTotalRow = this.db
      .prepare("SELECT value FROM index_state WHERE key='indexed_commits_total'")
      .get() as { value: string } | undefined;
    const indexedTotal = indexedTotalRow ? parseInt(indexedTotalRow.value, 10) : 0;
    const indexedThrough = (this.db
      .prepare("SELECT value FROM index_state WHERE key='last_indexed_sha'")
      .get() as { value: string } | undefined)?.value ?? "";

    // 4. Signals + math
    const signals = collectSignals(this.db, input.file);
    const tazelik: Tazelik = fresh.tazelik === "bootstrapping" ? "fresh" : fresh.tazelik;
    const { score, confidence } = computeScoreAndConfidence(signals, {
      tazelik,
      partial,
      totalCommits: indexedTotal,
    });

    return buildEnvelope({
      status,
      signals,
      score,
      confidence,
      tazelik,
      indexedThrough,
      indexedTotal,
      queryMs: Date.now() - start,
    });
  }

  async close(): Promise<void> {
    this.db.close();
    await this.pool.close();
  }
}
```

- [ ] **Step 4: Rebuild and run the test**

Run: `pnpm build && pnpm exec vitest run tests/memory/integration/api-blastradius.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/memory/api.ts tests/memory/integration/api-blastradius.test.ts
git commit -m "feat(memory): MemoryAPI orchestrates ensureFresh → signals → envelope"
```

---

## Task 15: Register `composto_blastradius` MCP tool

**Files:**
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Add the tool registration to `src/mcp/server.ts`**

Locate the last `server.tool(...)` call in `src/mcp/server.ts` and append the registration below. The feature flag `COMPOSTO_BLASTRADIUS=1` (per spec §10) gates the tool; if unset the handler returns a clear message.

```typescript
// src/mcp/server.ts — append after the last existing server.tool(...) block

import { MemoryAPI } from "../memory/api.js";
import { join } from "node:path";

server.tool(
  "composto_blastradius",
  "Predict the historical blast radius of a code change before applying it. Returns a risk verdict (low/medium/high/unknown), confidence, and the git-derived signals behind it (revert history, hotspots, fix ratio, coverage decline, ownership churn). Call BEFORE proposing significant edits to files with non-trivial history. Honest about uncertainty — returns \"unknown\" when confidence is low instead of guessing. Degraded modes (empty repo, shallow clone, indexing) are explicit in the `status` field.",
  {
    file: z.string().describe("Repo-relative path of the file the agent intends to modify."),
    intent: z.enum(["refactor", "bugfix", "feature", "test", "docs", "unknown"]).default("unknown").optional(),
    level: z.enum(["summary", "detail"]).default("summary").optional(),
    diff: z.string().optional().describe("Optional unified diff. When present, narrows blast radius to actually-touched symbols (Plan 4)."),
  },
  async ({ file, intent, level, diff }) => {
    if (process.env.COMPOSTO_BLASTRADIUS !== "1") {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          status: "disabled",
          reason: "composto_blastradius is gated by COMPOSTO_BLASTRADIUS=1 during Plan 1 rollout.",
        }) }],
      };
    }
    const projectPath = resolve(".");
    const dbPath = join(projectPath, ".composto", "memory.db");
    const api = new MemoryAPI({ dbPath, repoPath: projectPath });
    try {
      await api.bootstrapIfNeeded();
      const res = await api.blastradius({ file, intent, level, diff });
      return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
    } finally {
      await api.close();
    }
  }
);
```

- [ ] **Step 2: Build and verify the MCP server starts with the new tool**

Run: `pnpm build && node dist/mcp/server.js --help 2>/dev/null; echo "exit=$?"`
Expected: the server bundle executes (exits after init since no stdio pipe).

- [ ] **Step 3: Add a minimal MCP registration test**

```typescript
// tests/memory/unit/mcp-registration.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("MCP server — composto_blastradius registration", () => {
  it("includes composto_blastradius in the compiled bundle", () => {
    const bundle = readFileSync("dist/mcp/server.js", "utf-8");
    expect(bundle).toMatch(/composto_blastradius/);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run tests/memory/unit/mcp-registration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts tests/memory/unit/mcp-registration.test.ts
git commit -m "feat(mcp): register composto_blastradius tool (feature-flagged)"
```

---

## Task 16: CLI — `composto impact` and `composto index`

**Files:**
- Modify: `src/cli/commands.ts` — add `runImpact` and `runIndex`
- Modify: `src/index.ts` — dispatch `impact` and `index` commands
- Create: `tests/memory/integration/cli-impact.test.ts`

- [ ] **Step 1: Add new command exports to `src/cli/commands.ts`**

Append to the end of `src/cli/commands.ts`:

```typescript
// src/cli/commands.ts — append
import { MemoryAPI } from "../memory/api.js";
import { join } from "node:path";

export async function runImpact(
  projectPath: string,
  file: string,
  opts: { intent?: string; level?: string } = {}
): Promise<void> {
  const dbPath = join(projectPath, ".composto", "memory.db");
  const api = new MemoryAPI({ dbPath, repoPath: projectPath });
  try {
    await api.bootstrapIfNeeded();
    const res = await api.blastradius({
      file,
      intent: opts.intent as any,
      level: opts.level as any,
    });

    if (res.status !== "ok") {
      console.log(`status:     ${res.status}`);
      if (res.reason) console.log(`reason:     ${res.reason}`);
      console.log(`verdict:    ${res.verdict}`);
      console.log(`confidence: ${res.confidence.toFixed(2)}`);
      return;
    }

    console.log(`verdict:    ${res.verdict}`);
    console.log(`score:      ${res.score.toFixed(2)}`);
    console.log(`confidence: ${res.confidence.toFixed(2)}`);
    console.log(`tazelik:    ${res.metadata.tazelik}`);
    console.log(`signals:`);
    for (const s of res.signals) {
      const bar = s.strength > 0 ? "■".repeat(Math.max(1, Math.round(s.strength * 10))) : "·";
      console.log(`  ${s.type.padEnd(18)} ${bar.padEnd(10)} strength=${s.strength.toFixed(2)} precision=${s.precision.toFixed(2)}`);
    }
  } finally {
    await api.close();
  }
}

export async function runIndex(projectPath: string): Promise<void> {
  const dbPath = join(projectPath, ".composto", "memory.db");
  const api = new MemoryAPI({ dbPath, repoPath: projectPath });
  try {
    console.log("composto: bootstrapping memory index...");
    const start = Date.now();
    await api.bootstrapIfNeeded();
    console.log(`composto: index ready (${Date.now() - start} ms)`);
  } finally {
    await api.close();
  }
}
```

- [ ] **Step 2: Add dispatch cases to `src/index.ts`**

```typescript
// src/index.ts — add inside the switch, before `case "version"`:
  case "impact": {
    const filePath = args[1];
    if (!filePath) {
      console.error("Usage: composto impact <file> [--intent=bugfix] [--level=detail]");
      process.exit(1);
    }
    const intentArg = args.find((a) => a.startsWith("--intent="));
    const levelArg = args.find((a) => a.startsWith("--level="));
    await runImpact(resolve("."), filePath, {
      intent: intentArg?.slice("--intent=".length),
      level: levelArg?.slice("--level=".length),
    });
    break;
  }
  case "index": {
    await runIndex(resolve("."));
    break;
  }
```

Also extend the imports and help text at the top/bottom of `src/index.ts`:

```typescript
// src/index.ts — update the import list
import {
  runScan, runTrends, runIR, runBenchmark, runBenchmarkQuality, runContext,
  runImpact, runIndex,
} from "./cli/commands.js";

// src/index.ts — append to the help output (default case), keep alphabetical grouping:
    console.log("  impact <file>                         Show historical blast radius for a file");
    console.log("  index                                 Build or refresh the memory index");
```

- [ ] **Step 3: Write a CLI smoke test**

```typescript
// tests/memory/integration/cli-impact.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("composto impact CLI", () => {
  let repoDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-cli-repo-"));
    execSync(`bash ${process.cwd()}/tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("prints a verdict line for a file with history", () => {
    const bin = join(process.cwd(), "dist", "index.js");
    const out = execSync(`node ${bin} impact token.ts`, {
      cwd: repoDir,
      encoding: "utf-8",
    });
    expect(out).toMatch(/verdict:\s+(low|medium|high|unknown)/);
    expect(out).toMatch(/revert_match/);
  });
});
```

- [ ] **Step 4: Rebuild and run the CLI test**

Run: `pnpm build && pnpm exec vitest run tests/memory/integration/cli-impact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands.ts src/index.ts tests/memory/integration/cli-impact.test.ts
git commit -m "feat(cli): composto impact + composto index commands"
```

---

## Task 17: End-to-end smoke test

**Files:**
- Create: `tests/memory/integration/smoke.test.ts`

- [ ] **Step 1: Write the end-to-end test**

```typescript
// tests/memory/integration/smoke.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("BlastRadius Plan 1 — end-to-end smoke", () => {
  let repoDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-smoke-"));
    execSync(`bash ${process.cwd()}/tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("bootstraps the memory index from scratch via `composto index`", () => {
    const bin = join(process.cwd(), "dist", "index.js");
    execSync(`node ${bin} index`, { cwd: repoDir, encoding: "utf-8" });
    expect(existsSync(join(repoDir, ".composto", "memory.db"))).toBe(true);
  });

  it("answers `composto impact token.ts` with a revert_match signal firing", () => {
    const bin = join(process.cwd(), "dist", "index.js");
    const out = execSync(`node ${bin} impact token.ts`, {
      cwd: repoDir,
      encoding: "utf-8",
    });
    expect(out).toMatch(/verdict:/);
    expect(out).toMatch(/revert_match\s+■+/);
  });

  it("responds immediately on an unrelated file with zero signals firing", () => {
    const bin = join(process.cwd(), "dist", "index.js");
    const out = execSync(`node ${bin} impact nonexistent-file.ts`, {
      cwd: repoDir,
      encoding: "utf-8",
    });
    expect(out).toMatch(/verdict:/);
    expect(out).toMatch(/revert_match\s+·/);
  });
});
```

- [ ] **Step 2: Run the smoke test**

Run: `pnpm build && pnpm exec vitest run tests/memory/integration/smoke.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all new tests PASS; existing 145 tests continue to pass.

- [ ] **Step 4: Commit**

```bash
git add tests/memory/integration/smoke.test.ts
git commit -m "test(memory): end-to-end smoke test for Plan 1 wedge"
```

---

## Task 18: Document Plan 1 completion

**Files:**
- Modify: `docs/superpowers/specs/2026-04-19-composto-blastradius-design.md` (append status note)

- [ ] **Step 1: Append a Plan 1 completion note at the bottom of the spec**

Append below §12 Success criteria:

```markdown
---

## Implementation Status

- **Plan 1 (Foundation)** — *in progress / done*, see `docs/superpowers/plans/2026-04-19-blastradius-plan-1-foundation.md`. Ships: memory subsystem skeleton, Tier 1 ingest, `revert_match` signal end-to-end, MCP tool + CLI (feature-flagged via `COMPOSTO_BLASTRADIUS=1`). Other four signals return `strength: 0`.
- **Plan 2 (Signals + calibration)** — pending.
- **Plan 3 (Error handling + logging + perf budget)** — pending.
- **Plan 4 (Tier 2 AST ingest, `diff` parameter)** — pending.
- **Plan 5 (Calibration backtest + ship gate)** — pending.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-19-composto-blastradius-design.md
git commit -m "docs: track BlastRadius Plan 1 implementation status"
```

---

## Definition of Done for Plan 1

All of the following must hold before declaring Plan 1 complete:

1. `pnpm test` passes green. New tests added: schema, commit-parser, git helpers, tier1-commits, fix-links, freshness, revert-match, confidence, verdict, envelope, mcp-registration, pool, api-blastradius, cli-impact, smoke.
2. `pnpm build` produces `dist/memory/worker.js`, `dist/memory/api.js`, and the bundled MCP server containing the `composto_blastradius` literal.
3. `COMPOSTO_BLASTRADIUS=1 node dist/mcp/server.js` starts without crashing. (MCP connection is manual QA — outside this plan.)
4. `composto index` on the Composto repo itself creates `.composto/memory.db` and exits 0.
5. `composto impact src/memory/api.ts` on the Composto repo returns a verdict line.
6. The existing 4 MCP tools remain unchanged — running `composto_ir`, `composto_benchmark`, `composto_context`, `composto_scan` returns the same output as on master.

---

## Self-Review Checklist (completed against spec)

**Spec coverage:**
- §3 Architecture → Tasks 1, 7, 14 (scaffold, worker pool, API)
- §4 Graph schema → Task 2 (all 7 tables + indexes)
- §5.1 Tier 1 ingest → Tasks 5, 6
- §5.3 Query path → Task 14
- §5.4 Freshness contract → Task 8
- §5.5 History rewrite → Task 8 (handled inside `ensureFresh`)
- §6 Confidence math → Tasks 11, 12, 13
- §7 MCP tool contract → Task 15
- §7.6 CLI counterparts → Task 16
- §8 Error handling — partial: Plan 1 covers `ok`, `empty_repo`, `shallow_clone`. Rest deferred to Plan 3 — documented above.
- §9.1 Unit tests — covered by per-task unit tests
- §9.2 Integration — Tasks 14, 16, 17 via `small-repo` fixture
- §9.3 Calibration backtest — deferred to Plan 5
- §9.4 Perf budget — deferred to Plan 3

**Placeholder scan:** no TBD / "implement later" / "appropriate error handling" / "similar to Task N" patterns remain.

**Type consistency:** `Signal`, `BlastRadiusResponse`, `BlastRadiusInput`, `DegradedStatus`, `Tazelik`, `Verdict`, `Intent`, `Level` are all defined in Task 1's `types.ts` and referenced consistently through Tasks 9–16.
