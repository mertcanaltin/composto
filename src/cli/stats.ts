// `composto stats` — reads .composto/memory.db and prints hook invocation
// telemetry (last 7d by default). Also handles `--disable` to write the
// opt-out marker file that `recordInvocation` respects. All data is local;
// nothing leaves the repo.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../memory/db.js";
import { runMigrations } from "../memory/schema.js";
import { recentSummary, type Summary } from "../memory/telemetry/hook-invocations.js";

export interface StatsOpts {
  cwd: string;
  json?: boolean;
  disable?: boolean;
}

export interface StatsResult {
  action: "printed" | "disabled";
  output: string;
}

const DISABLE_NOTICE =
  "Composto telemetry disabled. Delete .composto/telemetry-disabled to re-enable.";

export function runStats(opts: StatsOpts): StatsResult {
  const composstoDir = join(opts.cwd, ".composto");

  if (opts.disable) {
    mkdirSync(composstoDir, { recursive: true });
    writeFileSync(join(composstoDir, "telemetry-disabled"), "");
    return { action: "disabled", output: DISABLE_NOTICE };
  }

  const dbPath = join(composstoDir, "memory.db");
  if (!existsSync(dbPath)) {
    const msg = "No .composto/memory.db yet — run `composto index` or trigger a hook first.";
    if (opts.json) {
      return {
        action: "printed",
        output: JSON.stringify({ total: 0, note: msg }, null, 2),
      };
    }
    return { action: "printed", output: msg };
  }

  const db = openDatabase(dbPath);
  try {
    runMigrations(db);
    const summary = recentSummary(db);
    return {
      action: "printed",
      output: opts.json ? JSON.stringify(summary, null, 2) : renderSummary(summary),
    };
  } finally {
    db.close();
  }
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

export function renderSummary(s: Summary): string {
  const lines: string[] = [];
  lines.push(`hook invocations (last 7d):  ${s.total}`);

  if (s.total === 0) {
    lines.push("  no hook firings recorded yet.");
    return lines.join("\n");
  }

  const verdictOrder = ["low", "medium", "high", "unknown", "passthrough"];
  const verdictKeys = [
    ...verdictOrder.filter((k) => k in s.byVerdict),
    ...Object.keys(s.byVerdict).filter((k) => !verdictOrder.includes(k)),
  ];
  const verdictParts = verdictKeys.map(
    (k) => `${k} ${pct(s.byVerdict[k], s.total)}`,
  );
  lines.push(`  by verdict:  ${verdictParts.join(" / ")}`);

  const platformParts = Object.entries(s.byPlatform).map(([k, v]) => `${k} ${v}`);
  lines.push(`  by platform: ${platformParts.join(", ")}`);

  lines.push(`  latency:     p50 ${s.latencyP50}ms, p95 ${s.latencyP95}ms`);
  lines.push(
    `  cache:       hit rate ${Math.round(s.cacheHitRate * 100)}% (cache feature deferred — see Phase 1 plan)`,
  );
  return lines.join("\n");
}
