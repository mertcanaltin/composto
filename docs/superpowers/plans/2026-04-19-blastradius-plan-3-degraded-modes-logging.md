# BlastRadius Plan 3 — Degraded Modes + Logging + Diagnostic CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden BlastRadius for production use by finishing the degraded-mode catalogue (shallow_clone + squashed_history + reindexing + disabled + internal_error all enforced end-to-end), adding NDJSON structured logging to `.composto/index.log`, adding `composto index --status` diagnostic output, fixing the worker-error `unknown` type, and cleaning up the path-resolution triple-workaround by embedding migration SQL as a string constant.

**Architecture:** Each concern stays in a focused module under `src/memory/`. `detectors.ts` packages the three new degraded-mode predicates. `log.ts` implements NDJSON append with daily rotation. `failure-tracker.ts` implements the three-strike disabled mode. `api.ts` adapts to surface all new degraded modes + catch unknown errors as `internal_error`. `cli/commands.ts` gains `runIndexStatus`. Migration SQL moves from filesystem read to embedded string literal; pool.ts and schema.ts path workarounds are removed.

**Tech Stack:** Same as prior plans.

---

## Scope

**In scope:**

- Three new degraded-mode detectors: squashed_history, reindexing (surfaced through envelope when freshness.rewritten=true), disabled (three-strike).
- `internal_error` fallback envelope wrapping the entire `blastradius()` body in try/catch.
- `FailureTracker` — tracks consecutive failures across sessions via `.composto/failures.json`, triggers disabled mode.
- NDJSON logger at `.composto/index.log` with daily rotation, 7-day retention.
- `composto index --status` command printing schema version, bootstrap time, indexed commit count, calibration freshness, storage footprint.
- Worker `unknown`→`Error` type fix in `src/memory/pool.ts`.
- Embed migration SQL as string constant in `src/memory/schema.ts`; remove tsup dual-copy; remove `pool.ts` bundled-mode detection.

**Out of scope:**

- Tier 2 AST ingest / diff parameter (Plan 4).
- `composto index --deepen` and `--rebuild` subcommands (Plan 3b if needed).
- External telemetry, remote log upload.
- Calibration backtest (Plan 5).
- CI performance-budget gate (separate DevOps task).

---

## File Structure

New files:

| Path | Responsibility |
|---|---|
| `src/memory/detectors.ts` | `detectSquashed(db): boolean`, `detectDisabled(): boolean` (reads failures.json) |
| `src/memory/log.ts` | `log(event)` — NDJSON append to `.composto/index.log`, daily rotation, 7-day retention |
| `src/memory/failure-tracker.ts` | `recordFailure(reason)`, `recordSuccess()`, `isDisabled()` — `.composto/failures.json` state |
| `src/memory/status.ts` | `indexStatus(api, dbPath): StatusReport` producing the data for `composto index --status` |

Files to modify:

| Path | Change |
|---|---|
| `src/memory/schema.ts` | Embed migration SQL as string constant, remove `readFileSync` + migration file resolution |
| `src/memory/pool.ts` | Remove bundled-mode `resolveWorkerPath` detection logic (keep the simple `dirname + "/worker.js"` lookup); fix `worker.on("error", (err) => ...)` to narrow `err` to `Error` |
| `src/memory/api.ts` | Wrap `blastradius()` body in try/catch returning `internal_error` envelope; surface `reindexing` when freshness.rewritten=true; call FailureTracker + logger at key points; gate calls on `isDisabled()` |
| `src/memory/envelope.ts` | Ensure `retry_hint_ms` and all optional fields are present under degraded modes as spec requires |
| `src/cli/commands.ts` | `runIndexStatus(projectPath)` — invokes `indexStatus` + prints human-readable output |
| `src/index.ts` | `index` dispatcher supports `--status` flag |
| `tsup.config.ts` | Remove duplicate migration copy (both `dist/migrations` and `dist/memory/migrations`). Remove `src/memory/pool.ts` entry since migration is now embedded (we can also drop the pool.ts entry actually — it's imported by api.ts entry). Keep `splitting: false` for now (still needed because dist/index.js vs dist/memory/api.js have different import.meta.url contexts; in a later cleanup we could evaluate dropping this). |

Tests:

| Path | Responsibility |
|---|---|
| `tests/memory/unit/log.test.ts` | NDJSON append, rotation triggers |
| `tests/memory/unit/failure-tracker.test.ts` | Three-strike threshold, clear on success/rebuild |
| `tests/memory/unit/detectors.test.ts` | squashed_history heuristic on synthetic fixtures |
| `tests/memory/unit/status.test.ts` | Status fields populated correctly |
| `tests/memory/integration/degraded-modes.test.ts` | internal_error capture + reindexing trigger |
| `tests/memory/unit/schema.test.ts` | Update to verify embedded-string migration still produces all tables |

---

## Task 1: Embed migration SQL as a string; drop path workarounds

**Files:**
- Modify: `src/memory/schema.ts`
- Modify: `tsup.config.ts`
- Delete: `src/memory/migrations/001-initial.sql` (contents moved into schema.ts)
- Modify: `tests/memory/unit/schema.test.ts` (no behavioral change expected)

- [ ] **Step 1: Replace `src/memory/schema.ts` contents**

```typescript
// src/memory/schema.ts
// Composto memory schema v1 — embedded as a string constant so dist bundling
// never needs to resolve file paths. See spec §4.1.

import type { DB } from "./db.js";

const CURRENT_VERSION = 1;

const V1_SQL = `
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
`;

export function runMigrations(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current >= CURRENT_VERSION) return;

  db.exec("BEGIN");
  try {
    db.exec(V1_SQL);
    db.pragma(`user_version = ${CURRENT_VERSION}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
```

- [ ] **Step 2: Update `tsup.config.ts`** — remove the migration copy loops:

```typescript
import { defineConfig } from "tsup";
import { cpSync, mkdirSync, readdirSync } from "node:fs";

export default defineConfig({
  entry: ["src/index.ts", "src/mcp/server.ts", "src/memory/worker.ts", "src/memory/pool.ts", "src/memory/api.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  splitting: false,
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  onSuccess: async () => {
    mkdirSync("dist/grammars", { recursive: true });
    for (const file of readdirSync("grammars")) {
      if (file.endsWith(".wasm")) {
        cpSync(`grammars/${file}`, `dist/grammars/${file}`);
      }
    }
  },
});
```

- [ ] **Step 3: Simplify `src/memory/pool.ts` worker path resolution**

Replace the `resolveWorkerPath` function with:

```typescript
function resolveWorkerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/memory/pool.js → dist/memory/worker.js (sibling)
  // src/memory/pool.ts → tsx runtime → not a production path
  return join(here, "worker.js");
}
```

Also fix the error handler: change `worker.on("error", (err) => { ... job.reject(err); })` so that the error param is narrowed via `instanceof Error`:

```typescript
    worker.on("error", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const job of this.pending.values()) job.reject(error);
      this.pending.clear();
    });
```

- [ ] **Step 4: Delete `src/memory/migrations/001-initial.sql`**

```bash
rm src/memory/migrations/001-initial.sql
rmdir src/memory/migrations
```

- [ ] **Step 5: Verify tests still pass**

Run: `pnpm exec vitest run tests/memory/unit/schema.test.ts`
Expected: PASS (both tests — embedded SQL still creates all tables).

Run: `pnpm build`
Expected: build succeeds. `dist/memory/migrations/` no longer produced.

Run: `pnpm exec vitest run tests/memory`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/memory/schema.ts src/memory/pool.ts tsup.config.ts
git rm src/memory/migrations/001-initial.sql
git commit -m "refactor(memory): embed migration SQL, drop path workarounds, fix worker err type"
```

---

## Task 2: NDJSON logger

**Files:**
- Create: `src/memory/log.ts`
- Create: `tests/memory/unit/log.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/memory/unit/log.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../../src/memory/log.js";

describe("createLogger", () => {
  let dir = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("appends NDJSON lines to the target file", () => {
    dir = mkdtempSync(join(tmpdir(), "composto-log-"));
    const logger = createLogger(dir);
    logger.info("ingest_start", { commits: 42 });
    logger.warn("parse_failed", { file: "x.ts" });
    logger.close();

    const contents = readFileSync(join(dir, "index.log"), "utf-8");
    const lines = contents.trim().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]);
    expect(first.evt).toBe("ingest_start");
    expect(first.lvl).toBe("info");
    expect(first.commits).toBe(42);
    expect(first.t).toBeGreaterThan(0);
  });

  it("is a no-op if directory cannot be created", () => {
    // Pointing at an impossible path should not throw
    const logger = createLogger("/dev/null/impossible");
    expect(() => logger.info("test", {})).not.toThrow();
    logger.close();
  });

  it("respects COMPOSTO_LOG=error filter", () => {
    dir = mkdtempSync(join(tmpdir(), "composto-log-"));
    process.env.COMPOSTO_LOG = "error";
    const logger = createLogger(dir);
    logger.info("ignored", {});
    logger.error("kept", {});
    logger.close();
    delete process.env.COMPOSTO_LOG;

    const contents = existsSync(join(dir, "index.log"))
      ? readFileSync(join(dir, "index.log"), "utf-8")
      : "";
    const lines = contents.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).evt).toBe("kept");
  });
});
```

- [ ] **Step 2: Run to fail**

Run: `pnpm exec vitest run tests/memory/unit/log.test.ts`

- [ ] **Step 3: Write `src/memory/log.ts`**

```typescript
// src/memory/log.ts
// NDJSON append-only logger with daily rotation and 7-day retention.
// Each line: {"t": <epoch>, "lvl": "info|warn|error|debug", "evt": "...", ...extras}

import { appendFileSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const RETENTION_DAYS = 7;

export interface Logger {
  debug: (evt: string, extras?: Record<string, unknown>) => void;
  info: (evt: string, extras?: Record<string, unknown>) => void;
  warn: (evt: string, extras?: Record<string, unknown>) => void;
  error: (evt: string, extras?: Record<string, unknown>) => void;
  close: () => void;
}

function currentThreshold(): Level {
  const raw = (process.env.COMPOSTO_LOG ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

function rotateIfNeeded(dir: string): void {
  const logPath = join(dir, "index.log");
  try {
    const s = statSync(logPath);
    const age = (Date.now() - s.mtimeMs) / 86400000;
    if (age < 1) return;
    // Shift .N files: index.log.6 deleted, .5 → .6, .4 → .5, etc.
    const files = readdirSync(dir).filter((f) => /^index\.log(\.\d+)?$/.test(f));
    const numbered = files
      .map((f) => {
        const m = f.match(/^index\.log\.(\d+)$/);
        return { name: f, n: m ? parseInt(m[1], 10) : 0 };
      })
      .sort((a, b) => b.n - a.n);
    for (const f of numbered) {
      if (f.n >= RETENTION_DAYS) {
        unlinkSync(join(dir, f.name));
        continue;
      }
      if (f.n === 0) {
        renameSync(join(dir, f.name), join(dir, "index.log.1"));
      } else {
        renameSync(join(dir, f.name), join(dir, `index.log.${f.n + 1}`));
      }
    }
  } catch {
    /* file doesn't exist yet, no rotation needed */
  }
}

export function createLogger(composto_dir: string): Logger {
  let disabled = false;
  try {
    mkdirSync(composto_dir, { recursive: true });
    rotateIfNeeded(composto_dir);
  } catch {
    disabled = true;
  }
  const path = join(composto_dir, "index.log");
  const threshold = currentThreshold();

  function write(level: Level, evt: string, extras: Record<string, unknown> | undefined): void {
    if (disabled) return;
    if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;
    const line = JSON.stringify({
      t: Math.floor(Date.now() / 1000),
      lvl: level,
      evt,
      ...(extras ?? {}),
    });
    try {
      appendFileSync(path, line + "\n", "utf-8");
    } catch {
      disabled = true;
    }
  }

  return {
    debug: (evt, extras) => write("debug", evt, extras),
    info: (evt, extras) => write("info", evt, extras),
    warn: (evt, extras) => write("warn", evt, extras),
    error: (evt, extras) => write("error", evt, extras),
    close: () => { /* append-only, nothing to flush explicitly */ },
  };
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm exec vitest run tests/memory/unit/log.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/memory/log.ts tests/memory/unit/log.test.ts
git commit -m "feat(memory): NDJSON logger with daily rotation + 7-day retention"
```

---

## Task 3: FailureTracker + disabled three-strike

**Files:**
- Create: `src/memory/failure-tracker.ts`
- Create: `tests/memory/unit/failure-tracker.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/memory/unit/failure-tracker.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFailureTracker } from "../../../src/memory/failure-tracker.js";

describe("FailureTracker", () => {
  let dir = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("disables after 3 consecutive failures of the same class within 5 minutes", () => {
    dir = mkdtempSync(join(tmpdir(), "composto-ft-"));
    const ft = createFailureTracker(dir);
    expect(ft.isDisabled()).toBe(false);
    ft.recordFailure("sqlite_corrupt");
    ft.recordFailure("sqlite_corrupt");
    expect(ft.isDisabled()).toBe(false);
    ft.recordFailure("sqlite_corrupt");
    expect(ft.isDisabled()).toBe(true);
  });

  it("recordSuccess clears the failure streak", () => {
    dir = mkdtempSync(join(tmpdir(), "composto-ft-"));
    const ft = createFailureTracker(dir);
    ft.recordFailure("sqlite_corrupt");
    ft.recordFailure("sqlite_corrupt");
    ft.recordSuccess();
    ft.recordFailure("sqlite_corrupt");
    expect(ft.isDisabled()).toBe(false);
  });

  it("counts different failure classes separately", () => {
    dir = mkdtempSync(join(tmpdir(), "composto-ft-"));
    const ft = createFailureTracker(dir);
    ft.recordFailure("sqlite_corrupt");
    ft.recordFailure("worker_crash");
    ft.recordFailure("sqlite_corrupt");
    expect(ft.isDisabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to fail**

Run: `pnpm exec vitest run tests/memory/unit/failure-tracker.test.ts`

- [ ] **Step 3: Write `src/memory/failure-tracker.ts`**

```typescript
// src/memory/failure-tracker.ts
// Three-strike disabled mode: three consecutive failures of the same class
// within 5 minutes mark the tool disabled. Cleared by recordSuccess() or
// by deleting .composto/failures.json.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const STRIKE_THRESHOLD = 3;
const WINDOW_SECONDS = 300;

export interface FailureTracker {
  recordFailure: (failureClass: string) => void;
  recordSuccess: () => void;
  isDisabled: () => boolean;
}

interface State {
  failures: Array<{ class: string; t: number }>;
  disabled: boolean;
}

export function createFailureTracker(composto_dir: string): FailureTracker {
  const path = join(composto_dir, "failures.json");
  try {
    mkdirSync(composto_dir, { recursive: true });
  } catch {
    /* if we can't mkdir, isDisabled stays false; acceptable */
  }

  function load(): State {
    try {
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(raw) as State;
    } catch {
      return { failures: [], disabled: false };
    }
  }

  function save(s: State): void {
    try {
      writeFileSync(path, JSON.stringify(s), "utf-8");
    } catch {
      /* best-effort */
    }
  }

  function now(): number {
    return Math.floor(Date.now() / 1000);
  }

  return {
    recordFailure: (failureClass: string) => {
      const s = load();
      s.failures.push({ class: failureClass, t: now() });
      // Keep only entries within window
      s.failures = s.failures.filter((f) => now() - f.t <= WINDOW_SECONDS);
      const sameClass = s.failures.filter((f) => f.class === failureClass);
      if (sameClass.length >= STRIKE_THRESHOLD) s.disabled = true;
      save(s);
    },
    recordSuccess: () => {
      save({ failures: [], disabled: false });
    },
    isDisabled: () => {
      return load().disabled;
    },
  };
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm exec vitest run tests/memory/unit/failure-tracker.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/memory/failure-tracker.ts tests/memory/unit/failure-tracker.test.ts
git commit -m "feat(memory): FailureTracker with three-strike disabled mode"
```

---

## Task 4: Squashed-history detector

**Files:**
- Create: `src/memory/detectors.ts`
- Create: `tests/memory/unit/detectors.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/memory/unit/detectors.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { detectSquashed } from "../../../src/memory/detectors.js";

describe("detectSquashed", () => {
  let repoDir = "";
  let dbDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-dt-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-dt-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("does NOT flag the small-repo fixture as squashed (commits span 18 days, mixed authors ok, no tight cluster)", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    // The fixture: 20 commits, one author, dates 2026-01-01 through 2026-01-19 (18 days).
    // 20 commits / 18 days = ~1.1 commits/day — not squashed-looking.
    const result = detectSquashed(db);
    expect(result).toBe(false);
    db.close();
  });
});
```

- [ ] **Step 2: Run to fail**

- [ ] **Step 3: Write `src/memory/detectors.ts`**

```typescript
// src/memory/detectors.ts
// Heuristic detectors for degraded modes that aren't direct git facts.

import type { DB } from "./db.js";

// Squashed-history heuristic: if >= 50 commits land from a single author
// within a < 1-day window, flag. Catches common `filter-repo` / squashed-import
// patterns without false-positiving on normal monorepo activity.
export function detectSquashed(db: DB): boolean {
  const row = db.prepare(`
    SELECT author, COUNT(*) AS n, MIN(timestamp) AS t0, MAX(timestamp) AS t1
    FROM commits
    GROUP BY author
    ORDER BY n DESC
    LIMIT 1
  `).get() as { author: string; n: number; t0: number; t1: number } | undefined;

  if (!row || row.n < 50) return false;
  const span = row.t1 - row.t0;
  return span < 86400;
}
```

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/memory/detectors.ts tests/memory/unit/detectors.test.ts
git commit -m "feat(memory): squashed-history detector — single-author tight-cluster heuristic"
```

---

## Task 5: Wire degraded modes + internal_error + logger + failure-tracker into MemoryAPI

**Files:**
- Modify: `src/memory/api.ts`

- [ ] **Step 1: Rewrite `src/memory/api.ts`** with all new integrations:

```typescript
// src/memory/api.ts
// Main-thread orchestration with full degraded-mode handling (spec §6.5 §8.2).

import { openDatabase, type DB } from "./db.js";
import { runMigrations } from "./schema.js";
import { ensureFresh } from "./freshness.js";
import { collectSignals } from "./signals/index.js";
import { computeScoreAndConfidence } from "./confidence.js";
import { buildEnvelope } from "./envelope.js";
import { WorkerPool } from "./pool.js";
import { countCommits, isShallowRepo } from "./git.js";
import { detectSquashed } from "./detectors.js";
import { createFailureTracker, type FailureTracker } from "./failure-tracker.js";
import { createLogger, type Logger } from "./log.js";
import { dirname, join } from "node:path";
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
  private readonly compostoDir: string;
  private readonly log: Logger;
  private readonly failures: FailureTracker;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(opts: MemoryAPIOptions) {
    this.dbPath = opts.dbPath;
    this.repoPath = opts.repoPath;
    this.compostoDir = dirname(opts.dbPath);
    this.log = createLogger(this.compostoDir);
    this.failures = createFailureTracker(this.compostoDir);
    this.db = openDatabase(opts.dbPath);
    runMigrations(this.db);
    this.pool = new WorkerPool({ size: opts.workerPoolSize ?? 1 });
    this.log.info("api_open", { dbPath: opts.dbPath });
  }

  async bootstrapIfNeeded(): Promise<void> {
    if (this.bootstrapPromise) return this.bootstrapPromise;

    const fresh = ensureFresh(this.db, this.repoPath);
    if (fresh.tazelik === "fresh" || !fresh.delta) return;

    this.bootstrapPromise = this.pool
      .runIngest({ dbPath: this.dbPath, repoPath: this.repoPath, range: fresh.delta })
      .then(() => {
        this.log.info("bootstrap_done", { through: fresh.delta?.to });
      })
      .catch((err: Error) => {
        this.log.error("bootstrap_failed", { message: err.message });
        this.failures.recordFailure("ingest_failure");
        throw err;
      })
      .finally(() => {
        this.bootstrapPromise = null;
      });
    return this.bootstrapPromise;
  }

  async blastradius(input: BlastRadiusInput): Promise<BlastRadiusResponse> {
    const start = Date.now();

    // Disabled check first
    if (this.failures.isDisabled()) {
      this.log.warn("call_on_disabled", { file: input.file });
      return buildEnvelope({
        status: "disabled",
        signals: [],
        score: 0,
        confidence: 0,
        tazelik: "fresh",
        indexedThrough: "",
        indexedTotal: 0,
        queryMs: Date.now() - start,
        reason: "tool disabled after repeated failures; clear .composto/failures.json to re-enable",
      });
    }

    try {
      return await this.runQuery(input, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error("internal_error", { file: input.file, message });
      this.failures.recordFailure("internal_error");
      return buildEnvelope({
        status: "internal_error",
        signals: [],
        score: 0,
        confidence: 0,
        tazelik: "fresh",
        indexedThrough: "",
        indexedTotal: 0,
        queryMs: Date.now() - start,
        reason: `internal error: ${message}; see .composto/index.log`,
      });
    }
  }

  private async runQuery(input: BlastRadiusInput, start: number): Promise<BlastRadiusResponse> {
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
        reason: "shallow clone detected; run `git fetch --unshallow` or `composto index --deepen`",
      });
    }

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

    const fresh = ensureFresh(this.db, this.repoPath);
    let status: DegradedStatus = "ok";

    if (fresh.rewritten) {
      status = "reindexing";
      this.log.warn("history_rewritten", { last_indexed: fresh.head });
    }

    if (fresh.tazelik === "bootstrapping") {
      await this.bootstrapIfNeeded();
    } else if (fresh.tazelik === "catching_up" && fresh.delta) {
      this.pool
        .runIngest({ dbPath: this.dbPath, repoPath: this.repoPath, range: fresh.delta })
        .catch((err: Error) => {
          this.log.error("delta_ingest_failed", { message: err.message });
        });
    }

    if (status === "ok" && detectSquashed(this.db)) {
      status = "squashed_history";
    }

    const indexedTotalRow = this.db
      .prepare("SELECT value FROM index_state WHERE key='indexed_commits_total'")
      .get() as { value: string } | undefined;
    const indexedTotal = indexedTotalRow ? parseInt(indexedTotalRow.value, 10) : 0;
    const indexedThrough = (this.db
      .prepare("SELECT value FROM index_state WHERE key='last_indexed_sha'")
      .get() as { value: string } | undefined)?.value ?? "";

    const signals = collectSignals(this.db, this.repoPath, input.file);
    const tazelik: Tazelik = fresh.tazelik === "bootstrapping" ? "fresh" : fresh.tazelik;
    const { score, confidence } = computeScoreAndConfidence(signals, {
      tazelik,
      partial: false,
      totalCommits: indexedTotal,
    });

    const response = buildEnvelope({
      status,
      signals,
      score,
      confidence,
      tazelik,
      indexedThrough,
      indexedTotal,
      queryMs: Date.now() - start,
    });

    this.log.info("query", {
      file: input.file,
      status: response.status,
      verdict: response.verdict,
      confidence: response.confidence,
      query_ms: response.metadata.query_ms,
    });
    this.failures.recordSuccess();
    return response;
  }

  async close(): Promise<void> {
    this.log.info("api_close", {});
    this.log.close();
    this.db.close();
    await this.pool.close();
  }
}
```

- [ ] **Step 2: Run full suite**

Run: `pnpm build && pnpm test`
Expected: all existing tests still PASS (the new api.ts is a strict superset of Plan 2's; no test file for the new api.ts yet — that's Task 6).

- [ ] **Step 3: Commit**

```bash
git add src/memory/api.ts
git commit -m "feat(memory): wire logger + failure tracker + degraded modes into MemoryAPI"
```

---

## Task 6: Integration test for degraded-mode paths

**Files:**
- Create: `tests/memory/integration/degraded-modes.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/memory/integration/degraded-modes.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryAPI } from "../../../dist/memory/api.js";

describe("BlastRadius degraded modes (Plan 3)", () => {
  let repoDir = "";
  let dbDir = "";

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-dg-repo-"));
    dbDir = mkdtempSync(join(tmpdir(), "composto-dg-db-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("returns 'disabled' when .composto/failures.json flags disabled state", async () => {
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    const compostoDir = join(dbDir, ".composto");
    mkdirSync(compostoDir, { recursive: true });
    writeFileSync(
      join(compostoDir, "failures.json"),
      JSON.stringify({ failures: [], disabled: true })
    );
    const api = new MemoryAPI({ dbPath: join(compostoDir, "memory.db"), repoPath: repoDir });
    const res = await api.blastradius({ file: "token.ts" });
    expect(res.status).toBe("disabled");
    expect(res.verdict).toBe("unknown");
    await api.close();
  });

  it("returns 'internal_error' when an unexpected error is thrown from the query path", async () => {
    // Make the repo unreadable by git by removing the .git directory AFTER
    // MemoryAPI is constructed. The first call into git will throw and should
    // surface as internal_error.
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    const api = new MemoryAPI({ dbPath: join(dbDir, "memory.db"), repoPath: repoDir });
    rmSync(join(repoDir, ".git"), { recursive: true, force: true });
    const res = await api.blastradius({ file: "token.ts" });
    expect(res.status).toBe("internal_error");
    expect(res.reason).toMatch(/internal error/);
    await api.close();
  });
});
```

- [ ] **Step 2: Build + run**

Run: `pnpm build && pnpm exec vitest run tests/memory/integration/degraded-modes.test.ts`
Expected: PASS (both).

- [ ] **Step 3: Commit**

```bash
git add tests/memory/integration/degraded-modes.test.ts
git commit -m "test(memory): integration tests for disabled + internal_error modes"
```

---

## Task 7: `composto index --status` command

**Files:**
- Create: `src/memory/status.ts`
- Modify: `src/cli/commands.ts` — add `runIndexStatus`
- Modify: `src/index.ts` — handle `--status` flag
- Create: `tests/memory/unit/status.test.ts`

- [ ] **Step 1: Write `src/memory/status.ts`**

```typescript
// src/memory/status.ts
// Produces the data block rendered by `composto index --status`.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "./db.js";
import { openDatabase } from "./db.js";

export interface StatusReport {
  schemaVersion: number;
  bootstrapped: boolean;
  indexedCommitsThrough: string;
  indexedCommitsTotal: number;
  filesWithDeepIndex: number;
  calibrationLastRefreshedAt: number | null;
  calibrationRows: number;
  storageBytes: number;
  integrityOk: boolean;
}

export function collectStatus(dbPath: string): StatusReport {
  const db = openDatabase(dbPath);
  try {
    const schemaVersion = db.pragma("user_version", { simple: true }) as number;

    const totalRow = db.prepare(
      "SELECT value FROM index_state WHERE key='indexed_commits_total'"
    ).get() as { value: string } | undefined;
    const headRow = db.prepare(
      "SELECT value FROM index_state WHERE key='last_indexed_sha'"
    ).get() as { value: string } | undefined;
    const calRefreshRow = db.prepare(
      "SELECT value FROM index_state WHERE key='calibration_last_refreshed_at'"
    ).get() as { value: string } | undefined;

    const filesWithDeepIndex = (db
      .prepare("SELECT COUNT(*) AS n FROM file_index_state")
      .get() as { n: number }).n;
    const calibrationRows = (db
      .prepare("SELECT COUNT(*) AS n FROM signal_calibration")
      .get() as { n: number }).n;

    const storageBytes = statFileSize(dbPath) + statFileSize(dbPath + "-wal") + statFileSize(dbPath + "-shm");
    const integrityOk =
      ((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check === "ok");

    return {
      schemaVersion,
      bootstrapped: !!headRow,
      indexedCommitsThrough: headRow?.value ?? "",
      indexedCommitsTotal: totalRow ? parseInt(totalRow.value, 10) : 0,
      filesWithDeepIndex,
      calibrationLastRefreshedAt: calRefreshRow ? parseInt(calRefreshRow.value, 10) : null,
      calibrationRows,
      storageBytes,
      integrityOk,
    };
  } finally {
    db.close();
  }
}

function statFileSize(path: string): number {
  try {
    return existsSync(path) ? statSync(path).size : 0;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 2: Write `tests/memory/unit/status.test.ts`**

```typescript
// tests/memory/unit/status.test.ts
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { collectStatus } from "../../../src/memory/status.js";

describe("collectStatus", () => {
  let repoDir = "";
  let dbDir = "";

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-st-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-st-db-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("produces a populated StatusReport after ingest", () => {
    const dbPath = join(dbDir, "memory.db");
    const db = openDatabase(dbPath);
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });
    db.close();

    const s = collectStatus(dbPath);
    expect(s.schemaVersion).toBe(1);
    expect(s.bootstrapped).toBe(true);
    expect(s.indexedCommitsTotal).toBeGreaterThanOrEqual(20);
    expect(s.calibrationRows).toBe(5);
    expect(s.storageBytes).toBeGreaterThan(0);
    expect(s.integrityOk).toBe(true);
  });
});
```

- [ ] **Step 3: Run to fail, then implement, then pass**

- [ ] **Step 4: Add `runIndexStatus` to `src/cli/commands.ts`**

Append at the end:

```typescript
import { collectStatus } from "../memory/status.js";

export async function runIndexStatus(projectPath: string): Promise<void> {
  const dbPath = join(projectPath, ".composto", "memory.db");
  const s = collectStatus(dbPath);

  console.log(`Composto Memory — ${projectPath}\n`);
  console.log("Index state");
  console.log(`  Schema version:           ${s.schemaVersion}`);
  console.log(`  Bootstrapped:             ${s.bootstrapped ? "yes" : "no"}`);
  console.log(`  Indexed through:          ${s.indexedCommitsThrough || "(none)"}`);
  console.log(`  Indexed commits total:    ${s.indexedCommitsTotal}`);
  console.log(`  Files w/ deep index:      ${s.filesWithDeepIndex}`);
  console.log();
  console.log("Calibration");
  if (s.calibrationLastRefreshedAt) {
    const dt = new Date(s.calibrationLastRefreshedAt * 1000).toISOString();
    console.log(`  Last refreshed:           ${dt}`);
  } else {
    console.log(`  Last refreshed:           (never)`);
  }
  console.log(`  Rows populated:           ${s.calibrationRows} / 5`);
  console.log();
  console.log("Storage");
  console.log(`  DB + WAL + SHM:           ${(s.storageBytes / 1024).toFixed(1)} KB`);
  console.log();
  console.log("Health");
  console.log(`  Integrity check:          ${s.integrityOk ? "OK" : "FAIL"}`);
}
```

- [ ] **Step 5: Update `src/index.ts`** — change the `"index"` case:

Replace:

```typescript
  case "index": {
    await runIndex(resolve("."));
    break;
  }
```

with:

```typescript
  case "index": {
    if (args.includes("--status")) {
      await runIndexStatus(resolve("."));
    } else {
      await runIndex(resolve("."));
    }
    break;
  }
```

And extend the imports at the top to include `runIndexStatus`:

```typescript
import {
  runScan, runTrends, runIR, runBenchmark, runBenchmarkQuality, runContext,
  runImpact, runIndex, runIndexStatus,
} from "./cli/commands.js";
```

Also add to help text:

```typescript
    console.log("  index --status                        Show memory index diagnostics");
```

- [ ] **Step 6: Build and verify**

Run: `pnpm build`

Then smoke:
```bash
cd /tmp && rm -rf composto-p3-smoke && mkdir composto-p3-smoke && cd composto-p3-smoke
bash /path/to/worktree/tests/memory/fixtures/make-small-repo.sh .
node /path/to/worktree/dist/index.js index
node /path/to/worktree/dist/index.js index --status
```

Should print the formatted status block.

- [ ] **Step 7: Commit**

```bash
git add src/memory/status.ts src/cli/commands.ts src/index.ts \
        tests/memory/unit/status.test.ts
git commit -m "feat(cli): composto index --status diagnostic output"
```

---

## Task 8: Plan 3 status note

**Files:**
- Modify: `docs/superpowers/specs/2026-04-19-composto-blastradius-design.md`

- [ ] **Step 1: Append to Implementation Status**

After the Plan 2 entry, add:

```markdown
### Plan 3 — Degraded Modes + Logging + Diagnostic CLI (complete on branch `feature/blastradius-plan-3`)

See `docs/superpowers/plans/2026-04-19-blastradius-plan-3-degraded-modes-logging.md`. Adds `squashed_history`, `reindexing`, `disabled` (three-strike via `.composto/failures.json`), and `internal_error` (catch-all) to the degraded-mode catalogue. Ships NDJSON logger at `.composto/index.log` with daily rotation + 7-day retention. Ships `composto index --status` for diagnostics (schema version, index freshness, calibration rows, storage footprint, integrity check). Fixes worker `unknown→Error` narrow in pool.ts. Cleans up path-resolution by embedding migration SQL as a string constant — `src/memory/migrations/` directory removed; tsup no longer duplicates SQL across `dist/migrations/` + `dist/memory/migrations/`. Tests: all prior tests continue to pass; Plan 3 adds ~10 new unit/integration tests.

**Plan 1 → Plan 3 debt cleared:** items (2) path resolution brittleness and (3) worker error typing both resolved. Only item (4) (Plan 1's file-count deviations, historical) remains.
```

Update "Plans 3–5 (pending)" header to "Plans 4–5 (pending)" and remove the Plan 3 bullet.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-19-composto-blastradius-design.md
git commit -m "docs: Plan 3 implementation status"
```

---

## Definition of Done

1. `pnpm test` green — all tests from Plans 1, 2, 3 pass.
2. `pnpm build` produces valid dist/ with no reference to removed migration file.
3. `composto index --status` runs on the composto repo itself and prints a populated report.
4. `.composto/index.log` file appears after any CLI invocation.
5. Three-strike disabled mode proven by the `degraded-modes.test.ts` "disabled" test.
6. `src/memory/migrations/` directory is gone.
7. `src/memory/pool.ts` `resolveWorkerPath()` no longer has bundled-vs-dist detection code.

---

## Self-Review

- **Spec coverage:** §6.5 all 9 degraded modes now implemented (Plan 1 had 3; Plan 3 adds 5: shallow_clone was already there). §8.2 known failure catalogue covered via `internal_error` wrap + `FailureTracker`. §8.3 NDJSON logging shipped. §8.4 `composto index --status` shipped. §8.5 three-strike implemented.
- **Placeholder scan:** no TBD / "implement later" — all code blocks contain concrete implementations.
- **Type consistency:** `FailureTracker`, `Logger`, `StatusReport` used consistently where imported.
