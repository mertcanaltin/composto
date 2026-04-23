# v0.6.0 — Hook-enforced BlastRadius injection

**Tagline:** Catches the bug your agent is about to reintroduce.

**Release day:** TBD — pending dogfood validation + demo video.

---

## What changed

Coding agents have no memory. They see the current code, not the story behind it. Yesterday you reverted a change; today the agent confidently suggests the same change again. It can't know — current code doesn't tell the story.

v0.6.0 wires BlastRadius into a PreToolUse hook so the agent consults Composto **before every Edit / Write / MultiEdit**, automatically. When the verdict is `medium` or `high`, a `<composto_blastradius>` block is injected into the agent's context — surfacing revert history, fix clusters, and author churn that existing code can't express.

You install it once, forget it exists, and notice that your agent stops making confident mistakes on risky files.

## Install (one command)

```bash
cd your-project
composto init --client=claude-code    # or cursor, or gemini-cli
```

That writes the MCP server registration + a `PreToolUse` hook entry into your platform's settings file. Restart your AI client and the hook is live. Re-running `composto init` is idempotent.

Observe what's happening any time:

```bash
composto stats            # invocations, verdict distribution, p50/p95 latency
composto stats --json     # machine-readable
composto stats --disable  # local-only opt-out (writes .composto/telemetry-disabled)
```

## Platform support

| Platform | Strategy |
|---|---|
| Claude Code | Full `PreToolUse` hook — `additionalContext` on `medium`/`high`/`unknown`, passthrough on `low` |
| Cursor | Hybrid — deny-on-high via `permissionDecision`; `medium`/`low` carried by the existing `.cursor/rules/composto.mdc` rule (Cursor's `additional_context` is dropped per [forum #155689](https://forum.cursor.com/t/native-posttooluse-hooks-accept-and-log-additional-context-successfully-but-the-injected-context-is-not-surfaced-to-the-model/155689)) |
| Gemini CLI | Full `BeforeTool` hook — same shape as Claude Code |
| Claude Desktop | MCP-only — no hook API yet |

## What's inside (developer-visible changes)

**New CLI surface:**
- `composto hook <platform> <event>` — PreToolUse / BeforeTool dispatcher (reads stdin, emits platform envelope)
- `composto init --client=<cc|cursor|gemini-cli>` — extended to write hook blocks alongside MCP config
- `composto stats` + `--json` / `--disable` — local-only telemetry reader

**New internals:**
- `src/cli/hook/extract.ts` — normalizes `tool_input` shapes across platforms (Edit, Write, MultiEdit, edit_file, write_file, replace)
- `src/cli/hook/api-deps.ts` — dependency-injection seam so adapter tests can mock `MemoryAPI.blastradius` instead of spinning up fixture repos
- Three adapters (`claude-code.ts`, `cursor.ts`, `gemini-cli.ts`) returning `{envelope, metadata}` so the CLI writes telemetry from structured metadata, not regex-parsed strings
- Shared `formatBlastRadiusContext` — one edit changes the verdict block across all adapters
- SQLite schema v3 adds `hook_invocations` table with `cache_hit` column wired but always-0 (reserves capability for a future verdict cache without re-migration)

**Privacy posture:**
- Telemetry is **local-only**. Writes to `.composto/memory.db` in your repo. Nothing leaves your machine. No account, no user ID, no cloud sync.
- `composto stats --disable` creates `.composto/telemetry-disabled`; `recordInvocation` silently returns when the marker is present.
- No default outbound traffic introduced by this release.

## Numbers

- **325 → ~326 tests** (74 added for hook surface, init wiring, telemetry, dispatcher)
- **p95 hook round-trip: ~100ms warm** on composto's own repo (well under the 200ms budget — verdict cache [Task P1.3] was deliberately deferred pending measurement, and measurement says it isn't needed yet)
- **Hook signal carried by v0.5.0's honest 4-signal foundation** — `revert_match` does the heavy lifting; `hotspot` / `fix_ratio` / `author_churn` contribute secondary signal. See [`docs/blastradius-proof-v2.md`](docs/blastradius-proof-v2.md) for the honest time-travel backtest.

## What this ISN'T (yet)

- Not a "causal oracle" — the `composto_query` primitive that would let agents script against the graph is [Phase 2](docs/superpowers/plans/2026-04-20-composto-revolution-program.md). v0.6.0 is the memory layer; the full query surface comes later.
- Not a signal-quality breakthrough — `revert_match` is doing most of the work. Improving the other three signals (particularly `hotspot`'s strength curve) is an open follow-on tracked as Plan 5c.
- Not a multi-repo analytics surface — the graph is per-repo. Team-wide patterns require layering above; not in scope for v0.6.0.

## Demo

> [2-3 minute screen recording embedded here. Scenario: agent about to refactor `scripts/demo-video.ts`, hook fires showing revert_match strength 1.0, agent adjusts approach and asks for confirmation before changing reverted logic.]

## Thanks

Context Mode ([github.com/mksglu/context-mode](https://github.com/mksglu/context-mode)) by Mert Köseoğlu shipped the "context saving" half of the agent-ergonomics problem and inspired Composto's structural-enforcement-via-hooks posture. Different halves, same root observation: coding agents need infrastructure, not just bigger models.

## Full changelog

See the [v0.5.0…v0.6.0 diff](https://github.com/mertcanaltin/composto/compare/v0.5.0...v0.6.0).

Highlights (merge commit `5143328`):
- `1f88766` — extract helper + Claude Code PreToolUse adapter
- `bc356fa` — Cursor adapter + DI seam for mock-based tests
- `271e00d` — Gemini CLI BeforeTool adapter
- `9ac1b04` — dispatcher + CLI registration + shared formatter
- `d16a835` — `composto init` extends to wire hooks across 3 platforms
- `78048e5` — CLI flag exposure + HOME write error boundary
- `9660749` — telemetry log + `composto stats` subcommand
- `c2cdae4` — README hook quickstart + platform matrix

---

## Launch checklist (internal — remove before publishing)

- [ ] Demo video recorded (2-3 min, scenario in `docs/demo-video-scenario.md`)
- [ ] YouTube unlisted upload, embed link replaces `[2-3 minute screen recording...]` placeholder above
- [ ] Dogfood ≥ 50 invocations on composto repo; `composto stats` output added as evidence block
- [ ] `npm version 0.6.0 -m "%s: hook-enforced BlastRadius injection"` + `git push origin master v0.6.0`
- [ ] `npm publish` (verify `npm whoami` first)
- [ ] `gh release create v0.6.0 --title "..." --notes-file docs/release-notes-v0.6.0.md --target master` (and REMOVE this checklist section first)
- [ ] Tweet scheduled with demo link
- [ ] HN submission prepared (not posted same day as tweet — spread 2-3 days)
- [ ] Update strategic memory: Phase 1 closed, Phase 2 trigger open
