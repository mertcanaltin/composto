# Composto — notes for Claude Code sessions

## Strategic direction

Composto is mid-pivot from "AST-based token compressor" to **causal oracle / temporal memory layer for coding agents**. Compression (today's tagline) is demoted to a side effect; the defensible surface is the repo's queryable historical + causal state (git + AST + graph). Token compression is becoming a commodity as LLM context windows grow; the structural gap LLMs *cannot* close with more context is temporal/causal reasoning about *this specific repo*, and that is what this project is building.

Concretely this means: when scoping new work here, prefer features that feed the causal graph or expose causal primitives over features that only improve compression ratios.

## Current state (as of 2026-04-19)

- **Plan 1 (Foundation) landed on master.** Introduces `src/memory/` subsystem (SQLite causal graph, worker pool, Tier 1 ingest, freshness check), `revert_match` signal end-to-end, confidence + verdict math, envelope builder, new MCP tool `composto_blastradius` (feature-flagged via `COMPOSTO_BLASTRADIUS=1`), new CLI commands `composto impact <file>` and `composto index`. Full test suite 196/196.
- **Live canonical documents:**
  - Design spec: `docs/superpowers/specs/2026-04-19-composto-blastradius-design.md` (includes an "Implementation Status" section with technical debt carried into later plans)
  - Executed plan: `docs/superpowers/plans/2026-04-19-blastradius-plan-1-foundation.md`
- **Plans 2–5 pending.** Plan 2: real implementations of the 4 stub signals + repo-calibrated precision. Plan 3: full degraded-mode catalogue + logging + path-resolution cleanup. Plan 4: Tier 2 AST ingest (`diff` parameter). Plan 5: calibration backtest + ship gate.

## Known technical debt from Plan 1

Load-bearing stuff later plans should clean up:

1. `src/memory/confidence.ts` `coverage_factor` uses `strength > 0` only; spec §6.3/§7.3 specify `AND sample_size >= 20`. Plan 2 reverts to spec-strict once real signals land.
2. Path resolution for migrations + worker.js is held together by `splitting: false` (tsup) + `resolveWorkerPath()` bundled-mode detection in `src/memory/pool.ts` + migration SQL duplicated across `dist/migrations/` and `dist/memory/migrations/`. Plan 3 should replace this with a single strategy (embed SQL as strings, or resolve from package root).
3. `src/memory/pool.ts` `worker.on("error", err => job.reject(err))` has `err: unknown` vs `reject(Error)` type mismatch. Plan 3 error-handling pass cleans it up.

## Working style for this project

When the user delegates with phrases like "sence", "sen dersen", "principle engineer olarak": pick the principal-engineer-best option and proceed. Do not present A/B/C menus; a single-sentence rationale followed by action is the expected mode. Quality gates (TDD, subagent reviews during code changes, tests green before commit, specs before code) stay on — "no menus" means "no option theater", not "skip discipline".

Product/org-level decisions (tool names post-ship, release timing, remote pushes, external comms) are surfaced as working assumptions in commits/specs and can be revisited cheaply — but don't block on them. Truly irreversible actions (`git push --force`, force-push to master remote, destructive filesystem ops) still pause for explicit confirmation.

## Useful commands

```bash
pnpm test            # 196 tests
pnpm build           # ESM bundles to dist/
pnpm rebuild better-sqlite3   # if native bindings missing after clone/install

composto index                             # bootstrap .composto/memory.db
composto impact src/some/file.ts           # blastradius for a file
COMPOSTO_BLASTRADIUS=1 claude              # enable the MCP tool for a Claude Code session
```

The `.composto/` directory is gitignored; regenerate with `composto index` on any machine.

## Everything else

Check the spec and plan in `docs/superpowers/` before making changes to `src/memory/`. The spec's §"Implementation Status" section is updated at the end of each executed plan — keep that fresh or the picture drifts.
