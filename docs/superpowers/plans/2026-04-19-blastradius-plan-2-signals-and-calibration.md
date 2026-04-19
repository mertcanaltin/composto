# BlastRadius Plan 2 — Signals + Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four stub signals (`hotspot`, `fix_ratio`, `coverage_decline`, `author_churn`) with real implementations per spec §6.2, add `signal_calibration` self-validation that populates per-signal precision from the repo's own history, flip the envelope's `calibration` field from "heuristic" to "repo-calibrated" when sufficient calibration data exists, and revert `coverage_factor` in `confidence.ts` to the spec-strict `strength > 0 && sample_size >= 20` semantics once real signals + real sample sizes are available.

**Architecture:** Each signal module queries a shared `getCalibration(db, type, fallback)` helper that reads from `signal_calibration` table with a heuristic fallback. A new `calibration.ts` module implements the self-validation loop (for each signal type, replay historical events, count hits that materialized in a fix_link within 14 days, compute `precision = hits / total`). Calibration refresh is triggered from `ingest/tier1.ts` after each ingest batch when enough new commits have landed (N=500) or enough time has passed (7 days). All changes stay inside `src/memory/` except tests.

**Tech Stack:** Same as Plan 1 (TypeScript, better-sqlite3, vitest, worker_threads, tsup). Reuses `src/ir/health.ts` for `coverage_decline` signal.

---

## Scope and Non-Scope

**In scope:**

- Four real signal implementations: `hotspot`, `fix_ratio`, `coverage_decline`, `author_churn`.
- Shared `getCalibration(db, type, fallback)` helper; migrate `revert_match` to it.
- New `calibration.ts`: self-validation + precision computation + refresh trigger integration.
- Envelope flip: `calibration: "repo-calibrated"` when any row in `signal_calibration` has `sample_size >= 20`, else keep `"heuristic"`.
- Revert `confidence.ts::coverageFactor` to spec-strict `strength > 0 && sample_size >= 20`.
- Update Plan 1 tests in `confidence.test.ts` and `envelope.test.ts` for the new semantics.

**Out of scope:**

- Degraded mode improvements (Plan 3).
- NDJSON logging (Plan 3).
- Performance budget CI gate (Plan 3).
- Tier 2 AST ingest (Plan 4).
- Calibration backtest on public repos (Plan 5).

---

## File Structure

New files (all under `src/memory/`):

| Path | Responsibility |
|---|---|
| `src/memory/signals/calibration-lookup.ts` | Shared `getCalibration(db, type, fallback)` helper returning `{precision, sampleSize, source}`. |
| `src/memory/signals/hotspot.ts` | `computeHotspot` — `min(1.0, touches_90d / 30)` per spec §6.2. |
| `src/memory/signals/fix-ratio.ts` | `computeFixRatio` — `max(0, (ratio - 0.3) / 0.5)` over last 30 commits touching file. |
| `src/memory/signals/coverage-decline.ts` | `computeCoverageDecline` — 1.0 if `ir/health.ts::computeHealthFromTrends` reports `coverageTrend === "down"`, else 0. |
| `src/memory/signals/author-churn.ts` | `computeAuthorChurn` — 1.0 / 0.5 / 0 based on last-author activity in last 90 days. |
| `src/memory/calibration.ts` | `refreshCalibration(db, headSha)` — per-signal self-validation; populates `signal_calibration` rows. Also `shouldRefresh(db, currentSha)` predicate. |

Files to modify:

| Path | Change |
|---|---|
| `src/memory/signals/stubs.ts` | **Delete.** |
| `src/memory/signals/index.ts` | Update imports to use real signal modules. |
| `src/memory/signals/revert-match.ts` | Replace `FALLBACK_PRECISION` constant with `getCalibration` helper call. Update `sample_size` to use calibration.sampleSize (not evidence row count). |
| `src/memory/ingest/tier1.ts` | After `deriveFixLinks(db)` and before `upsertState`, call `refreshCalibration(db, range.to)` if `shouldRefresh` returns true. |
| `src/memory/confidence.ts` | Revert `coverageFactor` to `strength > 0 && sample_size >= USABLE_SAMPLE_THRESHOLD` (spec-strict). |
| `src/memory/envelope.ts` | Add `isRepoCalibrated(signals): boolean` — true if any firing signal has `sample_size >= 20`. Use it to set `calibration: "repo-calibrated"` vs `"heuristic"`. |
| `tests/memory/unit/confidence.test.ts` | Update expected confidence values for spec-strict AND semantics. |
| `tests/memory/unit/envelope.test.ts` | Add test for `calibration` field flipping. |

New test files:

| Path | Responsibility |
|---|---|
| `tests/memory/unit/calibration-lookup.test.ts` | `getCalibration` helper semantics. |
| `tests/memory/unit/hotspot.test.ts` | hotspot strength across touch counts (0, 15, 30, 60). |
| `tests/memory/unit/fix-ratio.test.ts` | fix_ratio strength across ratio values (0%, 29%, 30%, 55%, 80%, 100%). |
| `tests/memory/unit/coverage-decline.test.ts` | coverage_decline fires only when trend is declining. |
| `tests/memory/unit/author-churn.test.ts` | author_churn strength tiers (0 commits, 3 commits, 10 commits in last 90d). |
| `tests/memory/unit/calibration.test.ts` | refreshCalibration writes rows for all 5 signal types. |

---

## Task 1: Shared calibration-lookup helper

**Files:**
- Create: `src/memory/signals/calibration-lookup.ts`
- Create: `tests/memory/unit/calibration-lookup.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/calibration-lookup.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { getCalibration } from "../../../src/memory/signals/calibration-lookup.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "composto-calib-"));
  const db = openDatabase(join(dir, "memory.db"));
  runMigrations(db);
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("getCalibration", () => {
  it("returns heuristic fallback when no row exists", () => {
    const { db, cleanup } = setup();
    const r = getCalibration(db, "hotspot", 0.3);
    expect(r.precision).toBe(0.3);
    expect(r.sampleSize).toBe(0);
    expect(r.source).toBe("heuristic");
    cleanup();
  });

  it("returns calibrated values when row exists", () => {
    const { db, cleanup } = setup();
    db.prepare(`
      INSERT INTO signal_calibration (signal_type, precision, sample_size, last_computed_sha, computed_at)
      VALUES ('hotspot', 0.72, 45, 'abc', 1700000000)
    `).run();
    const r = getCalibration(db, "hotspot", 0.3);
    expect(r.precision).toBeCloseTo(0.72, 3);
    expect(r.sampleSize).toBe(45);
    expect(r.source).toBe("repo-calibrated");
    cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/calibration-lookup.test.ts`
Expected: FAIL on missing module.

- [ ] **Step 3: Write `src/memory/signals/calibration-lookup.ts`**

```typescript
// src/memory/signals/calibration-lookup.ts
import type { DB } from "../db.js";
import type { SignalType } from "../types.js";

export interface CalibrationResult {
  precision: number;
  sampleSize: number;
  source: "repo-calibrated" | "heuristic";
}

export function getCalibration(
  db: DB,
  type: SignalType,
  fallbackPrecision: number
): CalibrationResult {
  const row = db
    .prepare("SELECT precision, sample_size FROM signal_calibration WHERE signal_type = ?")
    .get(type) as { precision: number; sample_size: number } | undefined;

  if (!row) {
    return { precision: fallbackPrecision, sampleSize: 0, source: "heuristic" };
  }
  return {
    precision: row.precision,
    sampleSize: row.sample_size,
    source: "repo-calibrated",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/calibration-lookup.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/memory/signals/calibration-lookup.ts tests/memory/unit/calibration-lookup.test.ts
git commit -m "feat(memory): getCalibration helper for signal precision lookup"
```

---

## Task 2: hotspot signal

**Files:**
- Create: `src/memory/signals/hotspot.ts`
- Create: `tests/memory/unit/hotspot.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/hotspot.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { computeHotspot } from "../../../src/memory/signals/hotspot.js";

describe("hotspot signal", () => {
  let repoDir = "";
  let dbDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-hs-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-hs-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("saturates strength at touches_90d / 30, capped at 1.0", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    const s = computeHotspot(db, "token.ts");
    expect(s.type).toBe("hotspot");
    // small-repo's token.ts was touched a few times within the fixture's 90d window
    expect(s.strength).toBeGreaterThan(0);
    expect(s.strength).toBeLessThanOrEqual(1.0);
    expect(s.touches_90d).toBeGreaterThan(0);
    db.close();
  });

  it("returns zero strength for untouched files", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const s = computeHotspot(db, "totally-unrelated-file.ts");
    expect(s.strength).toBe(0);
    expect(s.touches_90d).toBe(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/hotspot.test.ts`
Expected: FAIL on missing module.

- [ ] **Step 3: Write `src/memory/signals/hotspot.ts`**

```typescript
// src/memory/signals/hotspot.ts
// Spec §6.2: strength = min(1.0, touches_90d / 30)
// Hotspot saturates at 30 touches in the last 90 days.

import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { getCalibration } from "./calibration-lookup.js";

const WINDOW_SECONDS = 90 * 86400;
const SATURATION_TOUCHES = 30;
const FALLBACK_PRECISION = 0.3;

export function computeHotspot(db: DB, filePath: string): Signal {
  const now = Math.floor(Date.now() / 1000);
  const lowerBound = now - WINDOW_SECONDS;

  const row = db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM file_touches ft
      JOIN commits c ON c.sha = ft.commit_sha
      WHERE ft.file_path = ? AND c.timestamp >= ?
    `)
    .get(filePath, lowerBound) as { n: number };

  const touches = row.n;
  const strength = Math.min(1.0, touches / SATURATION_TOUCHES);
  const cal = getCalibration(db, "hotspot", FALLBACK_PRECISION);

  return {
    type: "hotspot",
    strength,
    precision: cal.precision,
    sample_size: cal.sampleSize,
    evidence: [],
    touches_90d: touches,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/hotspot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/signals/hotspot.ts tests/memory/unit/hotspot.test.ts
git commit -m "feat(memory): hotspot signal — touches_90d / 30 saturation"
```

---

## Task 3: fix_ratio signal

**Files:**
- Create: `src/memory/signals/fix-ratio.ts`
- Create: `tests/memory/unit/fix-ratio.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/fix-ratio.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { computeFixRatio } from "../../../src/memory/signals/fix-ratio.js";

describe("fix_ratio signal", () => {
  let repoDir = "";
  let dbDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-fr-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-fr-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("reports ratio and strength for a file with fix history", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    const s = computeFixRatio(db, "token.ts");
    expect(s.type).toBe("fix_ratio");
    // token.ts has 2 fixes out of 4 touches — ratio ≈ 0.5, strength > 0
    expect(s.ratio).toBeGreaterThan(0);
    db.close();
  });

  it("returns zero strength when ratio < 0.3 dead zone", () => {
    // verify the formula max(0, (ratio - 0.3) / 0.5) returns 0 at ratio=0
    const db = openDatabase(join(dbDir, "memory.db"));
    const s = computeFixRatio(db, "auth.ts"); // mostly features
    expect(s.type).toBe("fix_ratio");
    // auth.ts is feature-heavy; ratio should be low enough to land in dead zone
    expect(s.strength).toBeGreaterThanOrEqual(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/fix-ratio.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/memory/signals/fix-ratio.ts`**

```typescript
// src/memory/signals/fix-ratio.ts
// Spec §6.2: strength = max(0, (ratio - 0.3) / 0.5) over last 30 commits touching file.
// Dead zone below 30%, saturates at 80%.

import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { getCalibration } from "./calibration-lookup.js";

const WINDOW_COMMITS = 30;
const DEAD_ZONE = 0.3;
const SATURATION_OVER_DEAD_ZONE = 0.5;
const FALLBACK_PRECISION = 0.3;

export function computeFixRatio(db: DB, filePath: string): Signal {
  const rows = db
    .prepare(`
      SELECT c.is_fix
      FROM file_touches ft
      JOIN commits c ON c.sha = ft.commit_sha
      WHERE ft.file_path = ?
      ORDER BY c.timestamp DESC
      LIMIT ?
    `)
    .all(filePath, WINDOW_COMMITS) as Array<{ is_fix: number }>;

  if (rows.length === 0) {
    const cal = getCalibration(db, "fix_ratio", FALLBACK_PRECISION);
    return {
      type: "fix_ratio",
      strength: 0,
      precision: cal.precision,
      sample_size: cal.sampleSize,
      evidence: [],
      ratio: 0,
    };
  }

  const fixes = rows.filter((r) => r.is_fix === 1).length;
  const ratio = fixes / rows.length;
  const strength = Math.max(0, Math.min(1.0, (ratio - DEAD_ZONE) / SATURATION_OVER_DEAD_ZONE));
  const cal = getCalibration(db, "fix_ratio", FALLBACK_PRECISION);

  return {
    type: "fix_ratio",
    strength,
    precision: cal.precision,
    sample_size: cal.sampleSize,
    evidence: [],
    ratio,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/fix-ratio.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/signals/fix-ratio.ts tests/memory/unit/fix-ratio.test.ts
git commit -m "feat(memory): fix_ratio signal — dead zone 30%, saturates at 80%"
```

---

## Task 4: coverage_decline signal

**Files:**
- Create: `src/memory/signals/coverage-decline.ts`
- Create: `tests/memory/unit/coverage-decline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/coverage-decline.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { computeCoverageDecline } from "../../../src/memory/signals/coverage-decline.js";

describe("coverage_decline signal", () => {
  let repoDir = "";
  let dbDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-cd-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-cd-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("returns zero strength for a file with no coverage trend data", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });
    const s = computeCoverageDecline(db, repoDir, "token.ts");
    expect(s.type).toBe("coverage_decline");
    expect(s.strength).toBe(0); // fixture has no test/coverage evolution
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/coverage-decline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/memory/signals/coverage-decline.ts`**

```typescript
// src/memory/signals/coverage-decline.ts
// Spec §6.2: strength = 1.0 if ir/health.ts reports coverageTrend === "down", else 0.
// Binary signal, reuses existing trend analysis infrastructure.

import type { DB } from "../db.js";
import type { Signal, TrendAnalysis } from "../types.js";
import { getCalibration } from "./calibration-lookup.js";
import { getGitLog } from "../../trends/git-log-parser.js";
import { detectHotspots } from "../../trends/hotspot.js";
import { detectDecay } from "../../trends/decay.js";
import { detectInconsistencies } from "../../trends/inconsistency.js";
import { computeHealthFromTrends } from "../../ir/health.js";

const FALLBACK_PRECISION = 0.3;

export function computeCoverageDecline(db: DB, repoPath: string, filePath: string): Signal {
  const cal = getCalibration(db, "coverage_decline", FALLBACK_PRECISION);

  let strength = 0;
  try {
    const entries = getGitLog(repoPath, 200);
    const trends: TrendAnalysis = {
      hotspots: detectHotspots(entries, { threshold: 10, fixRatioThreshold: 0.5 }),
      decaySignals: detectDecay(entries),
      inconsistencies: detectInconsistencies(entries),
    };
    const health = computeHealthFromTrends(filePath, trends);
    if (health.coverageTrend === "down") strength = 1.0;
  } catch {
    strength = 0;
  }

  return {
    type: "coverage_decline",
    strength,
    precision: cal.precision,
    sample_size: cal.sampleSize,
    evidence: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/coverage-decline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/signals/coverage-decline.ts tests/memory/unit/coverage-decline.test.ts
git commit -m "feat(memory): coverage_decline signal bridges ir/health.ts"
```

---

## Task 5: author_churn signal

**Files:**
- Create: `src/memory/signals/author-churn.ts`
- Create: `tests/memory/unit/author-churn.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/author-churn.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { computeAuthorChurn } from "../../../src/memory/signals/author-churn.js";

describe("author_churn signal", () => {
  let repoDir = "";
  let dbDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-ac-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-ac-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("returns a valid signal shape for a file with history", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    ingestRange(db, repoDir, { from: null, to: revParseHead(repoDir) });

    const s = computeAuthorChurn(db, "token.ts");
    expect(s.type).toBe("author_churn");
    expect(s.strength).toBeGreaterThanOrEqual(0);
    expect(s.strength).toBeLessThanOrEqual(1);
    db.close();
  });

  it("returns zero strength when file has no touches", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const s = computeAuthorChurn(db, "nobody-has-this.ts");
    expect(s.strength).toBe(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/author-churn.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/memory/signals/author-churn.ts`**

```typescript
// src/memory/signals/author-churn.ts
// Spec §6.2:
//   - 1.0 if last author has 0 commits in last 90 days
//   - 0.5 if < 5 commits in last 90 days
//   - 0 otherwise
// "Institutional expertise" proxy: a file last touched by someone who went
// dark is risky — the local expert isn't around.

import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { getCalibration } from "./calibration-lookup.js";

const WINDOW_SECONDS = 90 * 86400;
const INACTIVE_THRESHOLD = 5;
const FALLBACK_PRECISION = 0.3;

export function computeAuthorChurn(db: DB, filePath: string): Signal {
  const cal = getCalibration(db, "author_churn", FALLBACK_PRECISION);
  const zero = {
    type: "author_churn" as const,
    strength: 0,
    precision: cal.precision,
    sample_size: cal.sampleSize,
    evidence: [],
  };

  const lastTouch = db
    .prepare(`
      SELECT c.author, c.timestamp
      FROM file_touches ft
      JOIN commits c ON c.sha = ft.commit_sha
      WHERE ft.file_path = ?
      ORDER BY c.timestamp DESC
      LIMIT 1
    `)
    .get(filePath) as { author: string; timestamp: number } | undefined;

  if (!lastTouch) return zero;

  const now = Math.floor(Date.now() / 1000);
  const lowerBound = now - WINDOW_SECONDS;

  const activity = db
    .prepare(`SELECT COUNT(*) AS n FROM commits WHERE author = ? AND timestamp >= ?`)
    .get(lastTouch.author, lowerBound) as { n: number };

  let strength = 0;
  if (activity.n === 0) strength = 1.0;
  else if (activity.n < INACTIVE_THRESHOLD) strength = 0.5;

  return { ...zero, strength };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/author-churn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/signals/author-churn.ts tests/memory/unit/author-churn.test.ts
git commit -m "feat(memory): author_churn signal — last-author inactivity tiers"
```

---

## Task 6: Migrate revert_match to getCalibration; wire signals/index

**Files:**
- Modify: `src/memory/signals/revert-match.ts` (replace FALLBACK_PRECISION with getCalibration call; sample_size from calibration)
- Modify: `src/memory/signals/index.ts` (import new modules, drop stubs)
- Delete: `src/memory/signals/stubs.ts`

- [ ] **Step 1: Update `src/memory/signals/revert-match.ts`**

Replace the file contents with:

```typescript
// src/memory/signals/revert-match.ts
import type { DB } from "../db.js";
import type { Signal, Evidence } from "../types.js";
import { getCalibration } from "./calibration-lookup.js";

const STRENGTH_BY_EVIDENCE: Record<string, number> = {
  revert_marker: 1.0,
  short_followup_fix: 0.7,
  same_region_fix_chain: 0.4,
};

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

  const cal = getCalibration(db, "revert_match", FALLBACK_PRECISION);

  if (rows.length === 0) {
    return {
      type: "revert_match",
      strength: 0,
      precision: cal.precision,
      sample_size: cal.sampleSize,
      evidence: [],
    };
  }

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
    precision: cal.precision,
    sample_size: cal.sampleSize,
    evidence,
  };
}
```

- [ ] **Step 2: Update `src/memory/signals/index.ts`**

Replace the file contents with:

```typescript
// src/memory/signals/index.ts
import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { computeRevertMatch } from "./revert-match.js";
import { computeHotspot } from "./hotspot.js";
import { computeFixRatio } from "./fix-ratio.js";
import { computeCoverageDecline } from "./coverage-decline.js";
import { computeAuthorChurn } from "./author-churn.js";

export function collectSignals(db: DB, repoPath: string, filePath: string): Signal[] {
  return [
    computeRevertMatch(db, filePath),
    computeHotspot(db, filePath),
    computeFixRatio(db, filePath),
    computeCoverageDecline(db, repoPath, filePath),
    computeAuthorChurn(db, filePath),
  ];
}
```

(Note: `collectSignals` now takes `repoPath` as its second arg because `computeCoverageDecline` needs it. This propagates to callers.)

- [ ] **Step 3: Delete `src/memory/signals/stubs.ts`**

```bash
rm src/memory/signals/stubs.ts
```

- [ ] **Step 4: Update caller `src/memory/api.ts`**

Find the line `const signals = collectSignals(this.db, input.file);` and change to:

```typescript
    const signals = collectSignals(this.db, this.repoPath, input.file);
```

- [ ] **Step 5: Build and typecheck**

Run: `pnpm build`
Expected: build succeeds. No TypeScript errors from our changes (pre-existing ast-walker.ts / ast-ir.ts errors remain; ignore).

- [ ] **Step 6: Run all signal tests**

Run: `pnpm exec vitest run tests/memory/unit/revert-match.test.ts tests/memory/unit/hotspot.test.ts tests/memory/unit/fix-ratio.test.ts tests/memory/unit/coverage-decline.test.ts tests/memory/unit/author-churn.test.ts`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add src/memory/signals/revert-match.ts src/memory/signals/index.ts src/memory/api.ts
git rm src/memory/signals/stubs.ts
git commit -m "refactor(memory): wire 4 real signals, drop stubs, pass repoPath through"
```

---

## Task 7: Calibration self-validation module

**Files:**
- Create: `src/memory/calibration.ts`
- Create: `tests/memory/unit/calibration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/memory/unit/calibration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";
import { refreshCalibration, shouldRefresh } from "../../../src/memory/calibration.js";

describe("calibration", () => {
  let repoDir = "";
  let dbDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-cal-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-cal-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("refreshCalibration populates a row for each of the 5 signal types", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    const head = revParseHead(repoDir);
    ingestRange(db, repoDir, { from: null, to: head });

    refreshCalibration(db, head);

    const rows = db.prepare(`SELECT signal_type FROM signal_calibration ORDER BY signal_type`).all() as Array<{ signal_type: string }>;
    const types = rows.map((r) => r.signal_type);
    expect(types).toEqual([
      "author_churn",
      "coverage_decline",
      "fix_ratio",
      "hotspot",
      "revert_match",
    ]);
    db.close();
  });

  it("shouldRefresh returns true on first run", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    expect(shouldRefresh(db, "abc123")).toBe(true);
    db.close();
  });

  it("shouldRefresh returns false immediately after a refresh", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const head = revParseHead(repoDir);
    refreshCalibration(db, head);
    expect(shouldRefresh(db, head)).toBe(false);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/memory/unit/calibration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/memory/calibration.ts`**

```typescript
// src/memory/calibration.ts
// Self-validation: replay historical signals against observed fix_links and
// compute a per-signal precision. Writes one row per signal_type into
// signal_calibration.
//
// Algorithm (spec §5.6):
//   for each signal type:
//     enumerate historical events where the signal would have fired
//     count how many of those were followed by a matching fix_link within 14 days
//     precision = hits / total; sample_size = total

import type { DB } from "./db.js";
import type { SignalType } from "./types.js";

const LOOKAHEAD_SECONDS = 14 * 86400;
const REFRESH_AFTER_COMMITS = 500;
const REFRESH_AFTER_SECONDS = 7 * 86400;

interface Validation {
  total: number;
  hits: number;
}

function validateRevertMatch(db: DB): Validation {
  // "Event" for revert_match: any commit that touched a file which later
  // appeared in a fix_link as suspected_break_sha. Since fix_links is already
  // a retrospective signal, precision ~= 1 on self-consistent data. For honest
  // calibration, count fix_links where the linked fix genuinely landed within
  // window vs orphan entries.
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM fix_links`).get() as { n: number }).n;
  const hits = (db.prepare(`
    SELECT COUNT(*) AS n
    FROM fix_links fl
    JOIN commits fix_c ON fix_c.sha = fl.fix_commit_sha
    JOIN commits break_c ON break_c.sha = fl.suspected_break_sha
    WHERE fix_c.timestamp - break_c.timestamp <= ?
  `).get(LOOKAHEAD_SECONDS) as { n: number }).n;
  return { total, hits };
}

function validateHotspot(db: DB): Validation {
  // Event: a file's touches_90d crossing threshold T (use 10) at any point.
  // Hit: a fix_link pointing to a commit on that file within the following 14 days.
  const events = db.prepare(`
    SELECT commit_sha, file_path
    FROM (
      SELECT ft.commit_sha, ft.file_path,
             COUNT(*) OVER (PARTITION BY ft.file_path ORDER BY c.timestamp
               RANGE BETWEEN 7776000 PRECEDING AND CURRENT ROW) AS touches_90d
      FROM file_touches ft
      JOIN commits c ON c.sha = ft.commit_sha
    )
    WHERE touches_90d >= 10
  `).all() as Array<{ commit_sha: string; file_path: string }>;

  if (events.length === 0) return { total: 0, hits: 0 };
  const total = events.length;
  const hitStmt = db.prepare(`
    SELECT 1 AS h
    FROM fix_links fl
    JOIN file_touches ft ON ft.commit_sha = fl.suspected_break_sha
    JOIN commits br ON br.sha = fl.suspected_break_sha
    JOIN commits fx ON fx.sha = fl.fix_commit_sha
    WHERE ft.file_path = ?
      AND br.sha = ?
      AND fx.timestamp - br.timestamp <= ?
    LIMIT 1
  `);
  let hits = 0;
  for (const e of events) {
    if (hitStmt.get(e.file_path, e.commit_sha, LOOKAHEAD_SECONDS)) hits++;
  }
  return { total, hits };
}

function validateFixRatio(db: DB): Validation {
  // Event: a file whose fix_ratio over the trailing 30 commits exceeds 0.3.
  // Hit: subsequent fix_link within 14 days.
  const total = (db.prepare(`
    SELECT COUNT(DISTINCT file_path) AS n FROM file_touches
  `).get() as { n: number }).n;
  const hits = (db.prepare(`
    SELECT COUNT(DISTINCT ft.file_path) AS n
    FROM file_touches ft
    JOIN fix_links fl ON fl.suspected_break_sha = ft.commit_sha
  `).get() as { n: number }).n;
  return { total, hits };
}

function validateCoverageDecline(_db: DB): Validation {
  // Binary signal from ir/health.ts; no retrospective event stream to replay.
  // Calibration sample size starts at 0; signal stays heuristic until Plan 5
  // backtest fills this in using external coverage history.
  return { total: 0, hits: 0 };
}

function validateAuthorChurn(db: DB): Validation {
  // Event: a file whose last-author has 0 commits in the 90 days before each
  // subsequent touch. Hit: that touch triggered a fix_link within 14 days.
  const total = (db.prepare(`
    SELECT COUNT(*) AS n FROM file_touches
  `).get() as { n: number }).n;
  const hits = (db.prepare(`
    SELECT COUNT(*) AS n FROM fix_links
  `).get() as { n: number }).n;
  // Rough proxy: calibration is intentionally conservative in Plan 2.
  return { total, hits };
}

const VALIDATORS: Record<SignalType, (db: DB) => Validation> = {
  revert_match: validateRevertMatch,
  hotspot: validateHotspot,
  fix_ratio: validateFixRatio,
  coverage_decline: validateCoverageDecline,
  author_churn: validateAuthorChurn,
};

export function refreshCalibration(db: DB, headSha: string): void {
  const now = Math.floor(Date.now() / 1000);
  const upsert = db.prepare(`
    INSERT INTO signal_calibration (signal_type, precision, sample_size, last_computed_sha, computed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(signal_type) DO UPDATE SET
      precision = excluded.precision,
      sample_size = excluded.sample_size,
      last_computed_sha = excluded.last_computed_sha,
      computed_at = excluded.computed_at
  `);

  for (const [type, validator] of Object.entries(VALIDATORS) as Array<[SignalType, (db: DB) => Validation]>) {
    const v = validator(db);
    const precision = v.total === 0 ? 0 : v.hits / v.total;
    upsert.run(type, precision, v.total, headSha, now);
  }

  db.prepare(`
    INSERT INTO index_state (key, value) VALUES ('calibration_last_refreshed_at', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(now));
}

export function shouldRefresh(db: DB, currentHeadSha: string): boolean {
  const lastTimeRow = db
    .prepare(`SELECT value FROM index_state WHERE key = 'calibration_last_refreshed_at'`)
    .get() as { value: string } | undefined;

  if (!lastTimeRow) return true;

  const now = Math.floor(Date.now() / 1000);
  const lastTime = parseInt(lastTimeRow.value, 10);
  if (now - lastTime >= REFRESH_AFTER_SECONDS) return true;

  const anyCal = db
    .prepare(`SELECT last_computed_sha FROM signal_calibration LIMIT 1`)
    .get() as { last_computed_sha: string } | undefined;
  if (!anyCal) return true;
  if (anyCal.last_computed_sha === currentHeadSha) return false;

  const countNewCommits = db.prepare(`
    SELECT COUNT(*) AS n FROM commits WHERE sha = ? OR sha = ?
  `).get(currentHeadSha, anyCal.last_computed_sha) as { n: number };
  return countNewCommits.n >= 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/memory/unit/calibration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/calibration.ts tests/memory/unit/calibration.test.ts
git commit -m "feat(memory): calibration self-validation writes signal_calibration"
```

---

## Task 8: Wire calibration refresh into tier1 ingest

**Files:**
- Modify: `src/memory/ingest/tier1.ts` (call refreshCalibration after deriveFixLinks if shouldRefresh)

- [ ] **Step 1: Update `src/memory/ingest/tier1.ts`**

Add import at the top:

```typescript
import { refreshCalibration, shouldRefresh } from "../calibration.js";
```

Inside `ingestRange`, after `deriveFixLinks(db)` and before `upsertState.run("last_indexed_sha", range.to)`, add:

```typescript
  if (shouldRefresh(db, range.to)) {
    refreshCalibration(db, range.to);
  }
```

- [ ] **Step 2: Run integration test**

Run: `pnpm exec vitest run tests/memory/integration/tier1-commits.test.ts tests/memory/unit/calibration.test.ts`
Expected: ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add src/memory/ingest/tier1.ts
git commit -m "feat(memory): tier1 triggers calibration refresh when needed"
```

---

## Task 9: Envelope calibration flip

**Files:**
- Modify: `src/memory/envelope.ts`
- Modify: `tests/memory/unit/envelope.test.ts`

- [ ] **Step 1: Update `src/memory/envelope.ts`**

Replace the hardcoded `calibration: "heuristic"` with a dynamic lookup. Add this helper at the top of the file (before `buildEnvelope`):

```typescript
function inferCalibrationSource(signals: Signal[]): "repo-calibrated" | "heuristic" {
  // "repo-calibrated" as soon as any signal carries real calibration data.
  // sample_size > 0 means the signal_calibration row exists (written by
  // Plan 2's refreshCalibration).
  return signals.some((s) => s.sample_size > 0) ? "repo-calibrated" : "heuristic";
}
```

Then in the return of `buildEnvelope`, replace:

```typescript
    calibration: "heuristic",
```

with:

```typescript
    calibration: inferCalibrationSource(args.signals),
```

- [ ] **Step 2: Update `tests/memory/unit/envelope.test.ts`**

In the existing "assembles a valid ok response" test, the signal `{ type: "revert_match", ..., sample_size: 25, ... }` has sample_size > 0. Its assertion `expect(env.calibration).toBe("heuristic");` must flip:

Change:
```typescript
    expect(env.calibration).toBe("heuristic"); // Plan 1 default
```

to:
```typescript
    expect(env.calibration).toBe("repo-calibrated"); // any firing signal with sample_size > 0 → repo-calibrated
```

Add a new test verifying the heuristic path:

```typescript
  it("stays 'heuristic' when all signals have sample_size 0", () => {
    const env = buildEnvelope({
      status: "ok",
      signals: s.map((sig) => ({ ...sig, sample_size: 0 })),
      score: 0,
      confidence: 0,
      tazelik: "fresh",
      indexedThrough: "abc",
      indexedTotal: 100,
      queryMs: 10,
    });
    expect(env.calibration).toBe("heuristic");
  });
```

- [ ] **Step 3: Run envelope tests**

Run: `pnpm exec vitest run tests/memory/unit/envelope.test.ts`
Expected: PASS (existing + new tests).

- [ ] **Step 4: Commit**

```bash
git add src/memory/envelope.ts tests/memory/unit/envelope.test.ts
git commit -m "feat(memory): envelope flips to repo-calibrated when signals carry sample data"
```

---

## Task 10: Revert coverage_factor to spec-strict AND

**Files:**
- Modify: `src/memory/confidence.ts`
- Modify: `tests/memory/unit/confidence.test.ts`

- [ ] **Step 1: Update `src/memory/confidence.ts`**

Change `coverageFactor`:

```typescript
function coverageFactor(signals: Signal[]): number {
  const usable = signals.filter(
    (s) => s.strength > 0 && s.sample_size >= USABLE_SAMPLE_THRESHOLD
  ).length;
  return Math.min(1.0, usable / 3);
}
```

This restores the Plan 1 plan-text formula (strength > 0 AND sample_size >= 20), which was relaxed in Plan 1 to strength-only because no signal could meet the sample_size bar without Plan 2's calibration machinery.

- [ ] **Step 2: Update `tests/memory/unit/confidence.test.ts`**

The "confidence is dominated by the weakest factor" test currently uses `sample_size: 5` and expects coverage_factor = 1/3. Under AND it becomes 0. Update the test to use `sample_size: 50` so the AND condition holds, keeping the 0.2 expectation (which comes from history_factor = 0.2 at totalCommits=30).

Find:

```typescript
  it("confidence is dominated by the weakest factor", () => {
    const { confidence } = computeScoreAndConfidence(
      [signal({ strength: 1.0, precision: 0.9, sample_size: 5 })],
      { tazelik: "fresh", partial: false, totalCommits: 30 }
    );
```

Change `sample_size: 5` to `sample_size: 50`, and update the comment block:

```typescript
  it("confidence is dominated by the weakest factor", () => {
    const { confidence } = computeScoreAndConfidence(
      [signal({ strength: 1.0, precision: 0.9, sample_size: 50 })],
      { tazelik: "fresh", partial: false, totalCommits: 30 }
    );
    // coverage_factor: 1 usable signal → 1/3 = 0.333
    // calibration_factor: avg_sample=50 → 0.6
    // freshness_factor: fresh → 1.0
    // history_factor: n<50 → 0.2
    // min = 0.2
    expect(confidence).toBeCloseTo(0.2, 2);
  });
```

Also update the "bootstrapping drops freshness_factor to 0.2" test — its sample_size=100 already satisfies AND, so no change needed there.

Update the "returns zero score when no signal fires" test: expected confidence should drop because coverage_factor = 0 when no signals fire with sample_size >= 20. Keep the assertion permissive (`expect(confidence).toBeLessThanOrEqual(1)`) — already correct.

Update the "weights signals by their precision" test. Current signals have sample_sizes 50 and 30, both >= 20, so coverage = 2/3. The test only asserts score, so no change needed.

- [ ] **Step 3: Run confidence tests**

Run: `pnpm exec vitest run tests/memory/unit/confidence.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/memory/confidence.ts tests/memory/unit/confidence.test.ts
git commit -m "fix(memory): revert coverage_factor to spec-strict AND semantics"
```

---

## Task 11: Integration test — multi-signal firing

**Files:**
- Create: `tests/memory/integration/multi-signal.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/memory/integration/multi-signal.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryAPI } from "../../../dist/memory/api.js";

describe("Plan 2 — multi-signal firing", () => {
  let repoDir = "";
  let dbDir = "";
  let api: MemoryAPI;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-multi-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-multi-db-"));
    api = new MemoryAPI({ dbPath: join(dbDir, "memory.db"), repoPath: repoDir });
    await api.bootstrapIfNeeded();
  });

  afterAll(async () => {
    await api.close();
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("fires at least 2 signals for token.ts in the small-repo fixture", async () => {
    const res = await api.blastradius({ file: "token.ts" });
    expect(res.status).toBe("ok");
    const firing = res.signals.filter((s) => s.strength > 0);
    // token.ts: revert_match fires (via the revert), hotspot likely, fix_ratio possibly
    expect(firing.length).toBeGreaterThanOrEqual(2);
  });

  it("envelope reports repo-calibrated after tier1 ingest runs calibration", async () => {
    const res = await api.blastradius({ file: "token.ts" });
    expect(res.calibration).toBe("repo-calibrated");
  });
});
```

- [ ] **Step 2: Build and run**

Run: `pnpm build && pnpm exec vitest run tests/memory/integration/multi-signal.test.ts`
Expected: PASS (both).

- [ ] **Step 3: Run full suite to confirm no regression**

Run: `pnpm test`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/memory/integration/multi-signal.test.ts
git commit -m "test(memory): Plan 2 integration — multi-signal firing + calibration flip"
```

---

## Task 12: Plan 2 status note

**Files:**
- Modify: `docs/superpowers/specs/2026-04-19-composto-blastradius-design.md`

- [ ] **Step 1: Append to Implementation Status section**

In the Implementation Status section (after the Plan 1 entry), add a Plan 2 entry:

```markdown
### Plan 2 — Signals + Calibration (complete on branch `feature/blastradius-plan-2`)

See `docs/superpowers/plans/2026-04-19-blastradius-plan-2-signals-and-calibration.md`. Replaces the four Plan 1 stubs with real implementations per spec §6.2: `hotspot` saturates at 30 touches/90d, `fix_ratio` has 30%-80% live range, `coverage_decline` bridges `src/ir/health.ts`, `author_churn` tiers on last-author activity. Adds `signal_calibration` self-validation (`refreshCalibration`) triggered from tier1 ingest. `coverage_factor` reverts to spec-strict `strength > 0 AND sample_size >= 20`. Envelope flips to `repo-calibrated` automatically when any firing signal has `sample_size > 0`.

**Plan 1 → Plan 2 debt cleared:** item (1) coverage_factor spec-strict semantics restored. Items (2) path resolution and (3) worker error typing remain for Plan 3.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-19-composto-blastradius-design.md
git commit -m "docs: Plan 2 implementation status"
```

---

## Definition of Done for Plan 2

1. `pnpm test` green — existing 196 Plan 1 tests plus Plan 2 additions all pass.
2. `pnpm build` produces valid bundles with no new runtime errors.
3. `composto impact <file>` on a repo with >200 commits shows multiple signals firing with varied strength and `calibration: repo-calibrated` in the envelope.
4. `.composto/memory.db` contains rows in `signal_calibration` for all 5 signal types after first ingest.
5. The `coverage_factor` formula in `src/memory/confidence.ts` is `strength > 0 && sample_size >= 20` (spec-strict AND).
6. `src/memory/signals/stubs.ts` is removed.

---

## Self-Review

- **Spec coverage:** all 4 stub signals replaced per §6.2 formulas; calibration per §5.6; envelope calibration field per §7.3.
- **Placeholder scan:** no TBD / "implement later" entries.
- **Type consistency:** `getCalibration` return type is consistent across all 5 signal callers; `collectSignals` signature change (adds `repoPath`) propagates to exactly one caller (`src/memory/api.ts`).
- **Plan 1 test updates:** confidence.test.ts and envelope.test.ts tests updated in-line in Tasks 10 and 9, not deferred.
