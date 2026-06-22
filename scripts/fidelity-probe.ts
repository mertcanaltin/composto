/**
 * Deterministic fidelity probe (no API needed).
 *
 * Silent proxy compression is only safe if the IR retains the facts a model
 * would need to answer well. This probe extracts semantically-important tokens
 * from the RAW source and measures what fraction survive in the L1 IR — broken
 * down by the categories the prior blind eval flagged as lossy (constants,
 * branch values). Low retention in a category = silent-loss risk = gate it.
 */
import { readFileSync } from "node:fs";
import { generateL1 } from "../src/ir/layers.js";

interface CategoryScore {
  total: number;
  kept: number;
  missing: string[];
}

function pct(s: CategoryScore): string {
  if (s.total === 0) return "n/a";
  return ((100 * s.kept) / s.total).toFixed(0) + "%";
}

function score(items: string[], ir: string): CategoryScore {
  const uniq = [...new Set(items)];
  const missing = uniq.filter((x) => !ir.includes(x));
  return { total: uniq.length, kept: uniq.length - missing.length, missing };
}

function probe(code: string, ir: string) {
  // Identifier names of declarations (the structural skeleton).
  const names = [...code.matchAll(/(?:function|class|interface|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);

  // Constant VALUES — `const X = <value>` numeric/string literals.
  const constVals = [...code.matchAll(/(?:const|let|var)\s+[A-Za-z_$][\w$]*(?::[^=]+)?=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?)/g)].map((m) => m[1]);

  // Branch VALUES — case labels and === comparison literals (guard/switch).
  const caseVals = [...code.matchAll(/case\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?)/g)].map((m) => m[1]);
  const cmpVals = [...code.matchAll(/[=!]==\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?)/g)].map((m) => m[1]);

  return {
    names: score(names, ir),
    constValues: score(constVals, ir),
    branchValues: score([...caseVals, ...cmpVals], ir),
  };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: tsx scripts/fidelity-probe.ts <file...>");
  process.exit(1);
}

const agg = {
  names: { total: 0, kept: 0 },
  constValues: { total: 0, kept: 0 },
  branchValues: { total: 0, kept: 0 },
};

for (const f of files) {
  const code = readFileSync(f, "utf8");
  const ir = await generateL1(code, f, null);
  const isRawFallback = ir === code;
  const r = probe(code, ir);

  console.log(`\n${f}${isRawFallback ? "  (raw-fallback, no compression)" : ""}`);
  console.log(`  names         ${pct(r.names).padStart(4)}  (${r.names.kept}/${r.names.total})`);
  console.log(`  const values  ${pct(r.constValues).padStart(4)}  (${r.constValues.kept}/${r.constValues.total})${r.constValues.missing.length ? "  missing: " + r.constValues.missing.slice(0, 5).join(", ") : ""}`);
  console.log(`  branch values ${pct(r.branchValues).padStart(4)}  (${r.branchValues.kept}/${r.branchValues.total})${r.branchValues.missing.length ? "  missing: " + r.branchValues.missing.slice(0, 5).join(", ") : ""}`);

  for (const k of ["names", "constValues", "branchValues"] as const) {
    agg[k].total += r[k].total;
    agg[k].kept += r[k].kept;
  }
}

const aggPct = (k: keyof typeof agg) => (agg[k].total ? ((100 * agg[k].kept) / agg[k].total).toFixed(0) + "%" : "n/a");
console.log(`\n=== AGGREGATE (${files.length} files) ===`);
console.log(`  names         ${aggPct("names").padStart(4)}  (${agg.names.kept}/${agg.names.total})`);
console.log(`  const values  ${aggPct("constValues").padStart(4)}  (${agg.constValues.kept}/${agg.constValues.total})`);
console.log(`  branch values ${aggPct("branchValues").padStart(4)}  (${agg.branchValues.kept}/${agg.branchValues.total})`);
