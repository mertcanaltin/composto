#!/usr/bin/env tsx
// BlastRadius backtest — two modes:
//
//   (default, v1)  Runs the production blastradius over every source file
//                  at HEAD and measures precision/recall of medium|high
//                  against the repo's fix_links ground truth. Fast, but
//                  revert_match reads fix_links directly so it is circular
//                  with the ground truth — precision inflated.
//
//   --time-travel  Plan 5b mode. For each ground-truth event, rewinds the
//                  DB to the pre-fix ("suspected break") SHA and queries
//                  BlastRadius against that snapshot. revert_match is
//                  naturally 0 pre-break, so this is the honest eval.
//                  Supports --exclude-signal for sensitivity analysis.
//
// Usage:
//   tsx scripts/blastradius-backtest.ts [repoPath]
//   tsx scripts/blastradius-backtest.ts [repoPath] --time-travel
//   tsx scripts/blastradius-backtest.ts [repoPath] --time-travel \
//       --exclude-signal revert_match
//   tsx scripts/blastradius-backtest.ts [repoPath] --time-travel \
//       --max-events 80

import { readdirSync, statSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, relative, join, extname } from "node:path";
import { tmpdir } from "node:os";
import { MemoryAPI } from "../dist/memory/api.js";
import { runTimeTravelBacktest, type SignalType } from "./backtest/time-travel.js";

const DEFAULT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".composto", "grammars", "coverage", ".next"]);

function walk(root: string, repoRoot: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(root, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, repoRoot, out);
    else if (DEFAULT_EXTS.has(extname(entry))) out.push(relative(repoRoot, p));
  }
  return out;
}

interface Prediction {
  file: string;
  verdict: string;
  score: number;
  confidence: number;
  had_fix_link: boolean;
}

interface ParsedArgs {
  repoPath: string;
  timeTravel: boolean;
  excludeSignals: SignalType[];
  maxEvents: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let repoPath: string | null = null;
  let timeTravel = false;
  const excludeSignals: SignalType[] = [];
  let maxEvents = 40;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--time-travel") {
      timeTravel = true;
    } else if (a === "--exclude-signal") {
      const name = args[++i];
      if (!name) throw new Error("--exclude-signal requires a signal name");
      excludeSignals.push(name as SignalType);
    } else if (a === "--max-events") {
      const n = Number(args[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("--max-events requires a positive integer");
      }
      maxEvents = n;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else if (repoPath === null) {
      repoPath = a;
    } else {
      throw new Error(`unexpected argument: ${a}`);
    }
  }
  return {
    repoPath: resolve(repoPath ?? "."),
    timeTravel,
    excludeSignals,
    maxEvents,
  };
}

async function runTimeTravelMode(args: ParsedArgs): Promise<void> {
  const workDir = mkdtempSync(join(tmpdir(), "composto-tt-cli-"));
  console.error(`[backtest] mode: time-travel`);
  console.error(`[backtest] repo: ${args.repoPath}`);
  console.error(`[backtest] workDir: ${workDir}`);
  if (args.excludeSignals.length > 0) {
    console.error(`[backtest] exclude: ${args.excludeSignals.join(",")}`);
  }
  try {
    const result = await runTimeTravelBacktest({
      repoPath: args.repoPath,
      workDir,
      maxEvents: args.maxEvents,
      excludeSignals: args.excludeSignals,
      onProgress: (done, total) => {
        console.error(`[backtest] event ${done}/${total}`);
      },
    });
    const passedPrecision = result.precision >= 0.6;
    const passedRecall = result.recall >= 0.4;
    console.log(JSON.stringify({
      ...result,
      mode: "time-travel",
      ship_gate: {
        precision_target: 0.6,
        recall_target: 0.4,
        passed_precision: passedPrecision,
        passed_recall: passedRecall,
      },
    }, null, 2));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.timeTravel) {
    await runTimeTravelMode(args);
    return;
  }
  if (args.excludeSignals.length > 0) {
    throw new Error("--exclude-signal requires --time-travel");
  }
  const repoPath = args.repoPath;
  const dbPath = join(repoPath, ".composto", "memory.db");

  console.error(`[backtest] mode: head`);
  console.error(`[backtest] repo: ${repoPath}`);
  const api = new MemoryAPI({ dbPath, repoPath });
  try {
    console.error("[backtest] bootstrapping index...");
    await api.bootstrapIfNeeded();

    // Access the raw DB for ground-truth lookup. Technically MemoryAPI doesn't
    // expose db, so we read it directly through the same sqlite handle.
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });

    const filesWithFixLinks = new Set(
      (db.prepare(`
        SELECT DISTINCT ft.file_path
        FROM fix_links fl
        JOIN file_touches ft ON ft.commit_sha = fl.suspected_break_sha
      `).all() as Array<{ file_path: string }>).map((r) => r.file_path)
    );
    console.error(`[backtest] ground-truth files with fix_links: ${filesWithFixLinks.size}`);

    const files = walk(repoPath, repoPath);
    console.error(`[backtest] scanning ${files.length} source files...`);

    const predictions: Prediction[] = [];
    let i = 0;
    for (const file of files) {
      i++;
      if (i % 50 === 0) console.error(`[backtest] ${i}/${files.length}`);
      try {
        const res = await api.blastradius({ file });
        predictions.push({
          file,
          verdict: res.verdict,
          score: res.score,
          confidence: res.confidence,
          had_fix_link: filesWithFixLinks.has(file),
        });
      } catch (err) {
        console.error(`[backtest] skip ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const highOrMed = predictions.filter((p) => p.verdict === "medium" || p.verdict === "high");
    const lowOnly = predictions.filter((p) => p.verdict === "low");
    const hasGroundTruth = predictions.filter((p) => p.had_fix_link);

    const tp = highOrMed.filter((p) => p.had_fix_link).length;
    const fp = highOrMed.filter((p) => !p.had_fix_link).length;
    const fn = hasGroundTruth.filter((p) => p.verdict !== "medium" && p.verdict !== "high").length;

    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);

    console.log(JSON.stringify({
      mode: "head",
      repo: repoPath,
      total_files: files.length,
      scanned: predictions.length,
      ground_truth_files: filesWithFixLinks.size,
      verdicts: {
        high: predictions.filter((p) => p.verdict === "high").length,
        medium: predictions.filter((p) => p.verdict === "medium").length,
        low: lowOnly.length,
        unknown: predictions.filter((p) => p.verdict === "unknown").length,
      },
      confusion_matrix_medium_high_band: {
        tp,
        fp,
        fn,
        tn: predictions.length - tp - fp - fn,
      },
      precision: Number(precision.toFixed(3)),
      recall: Number(recall.toFixed(3)),
      ship_gate: {
        precision_target: 0.6,
        recall_target: 0.4,
        passed_precision: precision >= 0.6,
        passed_recall: recall >= 0.4,
      },
    }, null, 2));

    db.close();
  } finally {
    await api.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
