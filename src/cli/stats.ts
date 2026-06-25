// `composto stats` — reports the cumulative token savings from the Read
// auto-compression hook (the one on-thesis telemetry: meaning/token). Reads
// the flat .composto/savings.json counter. All data is local; nothing leaves
// the repo. `--disable` writes the opt-out marker file.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSavings } from "../telemetry/savings.js";

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
  const compostoDir = join(opts.cwd, ".composto");

  if (opts.disable) {
    mkdirSync(compostoDir, { recursive: true });
    writeFileSync(join(compostoDir, "telemetry-disabled"), "");
    return { action: "disabled", output: DISABLE_NOTICE };
  }

  const savings = readSavings(compostoDir);
  if (opts.json) {
    return { action: "printed", output: JSON.stringify(savings, null, 2) };
  }

  if (savings.totalSavedTokens <= 0) {
    return {
      action: "printed",
      output:
        "No compression savings recorded yet — enable the Read hook with " +
        "`composto init --client=claude-code --with-compress`.",
    };
  }
  return {
    action: "printed",
    output: renderSavings(savings.totalSavedTokens, savings.compressedReads),
  };
}

// Sonnet input price, $3 / Mtok — the saving the compression hook represents.
const INPUT_PRICE_PER_MTOK = 3;

export function renderSavings(totalSavedTokens: number, compressedReads: number): string {
  if (totalSavedTokens <= 0) return "";
  const dollars = (totalSavedTokens / 1_000_000) * INPUT_PRICE_PER_MTOK;
  return (
    `compression hook:\n` +
    `  tokens saved:  ${totalSavedTokens.toLocaleString()} across ${compressedReads} reads` +
    ` (~$${dollars.toFixed(2)} at $${INPUT_PRICE_PER_MTOK}/Mtok input)`
  );
}
