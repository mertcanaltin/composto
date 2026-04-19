# Composto — notes for Claude Code sessions

## Strategic direction

Composto is mid-pivot from "AST-based token compressor" to **causal oracle / temporal memory layer for coding agents**. Compression (today's tagline) is demoted to a side effect; the defensible surface is the repo's queryable historical + causal state (git + AST + graph). Token compression is becoming a commodity as LLM context windows grow; the structural gap LLMs *cannot* close with more context is temporal/causal reasoning about *this specific repo*, and that is what this project is building.

Concretely this means: when scoping new work here, prefer features that feed the causal graph or expose causal primitives over features that only improve compression ratios.

## Current state (as of 2026-04-19 — Plans 1, 2, 3 + 5 v1 all landed on master)

- **Plan 1 (Foundation)** — `src/memory/` subsystem, Tier 1 ingest, `revert_match` signal, confidence + verdict math, envelope builder, `composto_blastradius` MCP tool (`COMPOSTO_BLASTRADIUS=1`), `composto impact` + `composto index` CLI.
- **Plan 2 (Signals + Calibration)** — real implementations of the 4 other signals (hotspot, fix_ratio, coverage_decline, author_churn), `signal_calibration` self-validation wired into tier1 ingest, envelope auto-flips to `repo-calibrated`, `coverage_factor` back to spec-strict AND.
- **Plan 3 (Degraded Modes + Logging + Diagnostic CLI)** — full degraded-mode catalogue (shallow_clone, squashed_history, reindexing, disabled three-strike, internal_error), NDJSON logger at `.composto/index.log`, `composto index --status`, embedded migration SQL, worker error typing cleaned up.
- **Plan 5 v1 (Ship-gate proof)** — `scripts/blastradius-backtest.ts` + `docs/blastradius-proof.md`; single-repo confusion matrix on composto: precision **93.9%**, recall **100%** on medium|high band. Ship gate passes with honest caveats.
- **Current test suite:** 221 tests across 49 files; all green.
- **Still pending:** Plan 4 (Tier 2 AST ingest / `diff` parameter), Plan 5b (three-repo time-travel backtest).

### Live canonical documents

- Design spec: `docs/superpowers/specs/2026-04-19-composto-blastradius-design.md` — includes an "Implementation Status" section kept fresh at the end of each plan.
- Plan documents: `docs/superpowers/plans/2026-04-19-blastradius-plan-{1,2,3}-*.md`.
- Proof: `docs/blastradius-proof.md`.

## Known technical debt

Historical from Plan 1 — most cleared:

1. ~~`coverage_factor` strength-only hack~~ — **cleared in Plan 2.**
2. ~~Path resolution triple-workaround~~ — **partially cleared in Plan 3** (migration SQL embedded; tsup no longer duplicates). The two-branch `resolveWorkerPath()` bundled-mode detection in `src/memory/pool.ts` remains because removing it breaks the `dist/index.js` → worker path resolution with tsup's `splitting: false` + multi-entry config.
3. ~~Worker `err: unknown` → `reject(Error)`~~ — **cleared in Plan 3.**
4. Plan 1 file-count deviations (fixture touch count, etc.) — historical, non-blocking.

## Working style for this project

When the user delegates with phrases like "sence", "sen dersen", "principle engineer olarak": pick the principal-engineer-best option and proceed. Do not present A/B/C menus; a single-sentence rationale followed by action is the expected mode. Quality gates (TDD, subagent reviews during code changes, tests green before commit, specs before code) stay on — "no menus" means "no option theater", not "skip discipline".

Product/org-level decisions (tool names post-ship, release timing, remote pushes, external comms) are surfaced as working assumptions in commits/specs and can be revisited cheaply — but don't block on them. Truly irreversible actions (`git push --force`, force-push to master remote, destructive filesystem ops) still pause for explicit confirmation.

## Useful commands

```bash
pnpm test            # 221 tests
pnpm build           # ESM bundles to dist/
pnpm rebuild better-sqlite3   # if native bindings missing after clone/install

composto index                             # bootstrap .composto/memory.db
composto index --status                    # diagnostic: schema, freshness, calibration, storage
composto impact src/some/file.ts           # blastradius for a file
COMPOSTO_BLASTRADIUS=1 claude              # enable the MCP tool for a Claude Code session

pnpm exec tsx scripts/blastradius-backtest.ts .   # ship-gate proof harness
```

The `.composto/` directory is gitignored; regenerate with `composto index` on any machine.

## Everything else

Check the spec and plan in `docs/superpowers/` before making changes to `src/memory/`. The spec's §"Implementation Status" section is updated at the end of each executed plan — keep that fresh or the picture drifts.
