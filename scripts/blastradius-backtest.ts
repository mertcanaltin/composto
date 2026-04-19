#!/usr/bin/env tsx
// BlastRadius backtest — runs the production blastradius over every source
// file in a repo and measures precision/recall of the medium|high verdict
// band against the repo's fix_links ground truth.
//
// This is an approximation rather than a full time-travel backtest: we use
// the DB's current state and ask "among files whose blastradius flags
// medium|high today, how many have a real fix_link attached?" and "among
// files with a real fix_link, how many would we have flagged?". A full
// time-travel version would rewind each query to the pre-fix HEAD; that is
// Plan 5b scope. This v1 is enough to prove (or disprove) the shape of the
// product.
//
// Usage: tsx scripts/blastradius-backtest.ts [repoPath]

import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve, relative, join, extname } from "node:path";
import { MemoryAPI } from "../dist/memory/api.js";

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

async function main() {
  const repoPath = resolve(process.argv[2] ?? ".");
  const dbPath = join(repoPath, ".composto", "memory.db");

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
