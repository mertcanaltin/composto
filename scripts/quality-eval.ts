/**
 * Quality eval — does an agent reason as well over IR/hybrid context as over
 * raw, and at what token cost? Battlefield is MULTI-FILE reasoning (where raw
 * bloats the attention budget), not single-file (where raw trivially wins).
 *
 * Honest design: fact-checklist scoring, not holistic 0-10 (kills judge drift).
 * For each task we author a ground-truth checklist; a blind judge marks each
 * fact present/correct in the answer. Score = fraction correct. The judge never
 * sees which condition (raw/ir/hybrid) produced the answer.
 *
 * Needs ANTHROPIC_API_KEY. Run: ANTHROPIC_API_KEY=sk-... npx tsx scripts/quality-eval.ts
 */
import { readFileSync } from "node:fs";
import { generateL1 } from "../src/ir/layers.js";
import { estimateTokens } from "../src/benchmark/tokenizer.js";

const MODEL = process.env.COMPOSTO_EVAL_MODEL ?? "claude-sonnet-4-6";

interface Task {
  id: string;
  question: string;
  files: string[];
  target: string; // file kept RAW in the hybrid condition
  facts: string[]; // ground-truth checklist the ideal answer must contain
}

const TASKS: Task[] = [
  {
    id: "ir-fallback",
    question:
      "In this codebase, how does L1 IR generation decide whether to emit the compressed IR or fall back to the raw source? State the exact condition and what happens to health annotations.",
    files: ["src/ir/layers.ts", "src/ir/ast-walker.ts", "src/benchmark/tokenizer.ts"],
    target: "src/ir/layers.ts",
    facts: [
      "IR is used only when it is a strict token win (estimateTokens(ir) < estimateTokens(code))",
      "IR must also be non-empty / not whitespace-only",
      "otherwise it falls back to the raw source code",
      "health annotation (annotateIR) is applied after the IR-vs-raw choice, only when health is provided",
    ],
  },
  {
    id: "proxy-compress",
    question:
      "How does the compression proxy rewrite an incoming request, and what prevents it from ever making a code block LARGER (token bloat)?",
    files: ["src/proxy/compress-context.ts", "src/ir/layers.ts"],
    target: "src/proxy/compress-context.ts",
    facts: [
      "it finds fenced code blocks and resolves a filePath from the fence info (path or language)",
      "each block's body is passed through generateL1 to produce IR",
      "a block is only rewritten when the IR differs from the body (generateL1 already returns raw when IR is not a token win)",
      "unsupported (non-code) fences are left untouched",
    ],
  },
  {
    id: "collapse-fidelity",
    question:
      "When a long expression must be truncated in the IR, how are the decision values (e.g. ternary string literals like \"declining\"/\"improving\") preserved instead of being cut off?",
    files: ["src/ir/ast-walker.ts"],
    target: "src/ir/ast-walker.ts",
    facts: [
      "collapseExpr truncates the head but appends trailing string literals that fall past the cut",
      "literals already present in the head are not duplicated",
      "it is applied at the expression-truncation sites (conditions, switch, return, throw)",
    ],
  },
];

async function ask(system: string, user: string): Promise<{ text: string; inTok: number; outTok: number }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  return { text, inTok: resp.usage.input_tokens, outTok: resp.usage.output_tokens };
}

async function buildContext(task: Task, mode: "raw" | "ir" | "hybrid"): Promise<string> {
  const parts: string[] = [];
  for (const f of task.files) {
    const code = readFileSync(f, "utf8");
    if (mode === "raw" || (mode === "hybrid" && f === task.target)) {
      parts.push(`// FILE: ${f}\n${code}`);
    } else {
      parts.push(`// FILE: ${f} (IR)\n${await generateL1(code, f, null)}`);
    }
  }
  return parts.join("\n\n");
}

async function judge(task: Task, answer: string): Promise<{ correct: number; verdicts: boolean[] }> {
  const checklist = task.facts.map((f, i) => `${i + 1}. ${f}`).join("\n");
  const sys =
    "You are a strict grader. For each numbered fact, decide if the ANSWER states it correctly. " +
    "Reply with ONLY a JSON array of booleans, one per fact, in order. No prose.";
  const user = `FACTS:\n${checklist}\n\nANSWER:\n${answer}`;
  const { text } = await ask(sys, user);
  let verdicts: boolean[] = [];
  try {
    verdicts = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
  } catch {
    verdicts = task.facts.map(() => false);
  }
  return { correct: verdicts.filter(Boolean).length, verdicts };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required.");
    process.exit(1);
  }
  console.log(`model: ${MODEL}\n`);
  const modes = ["raw", "ir", "hybrid"] as const;
  const totals: Record<string, { tok: number; correct: number; facts: number }> = {
    raw: { tok: 0, correct: 0, facts: 0 },
    ir: { tok: 0, correct: 0, facts: 0 },
    hybrid: { tok: 0, correct: 0, facts: 0 },
  };

  for (const task of TASKS) {
    console.log(`\n### ${task.id} — ${task.files.length} files`);
    for (const mode of modes) {
      const ctx = await buildContext(task, mode);
      const ctxTok = estimateTokens(ctx);
      const { text } = await ask(
        "You are a senior engineer. Answer ONLY from the provided context. Be precise.",
        `${task.question}\n\n--- CONTEXT ---\n${ctx}`
      );
      const { correct } = await judge(task, text);
      totals[mode].tok += ctxTok;
      totals[mode].correct += correct;
      totals[mode].facts += task.facts.length;
      console.log(`  ${mode.padEnd(7)} ctx=${String(ctxTok).padStart(5)} tok   facts ${correct}/${task.facts.length}`);
    }
  }

  console.log(`\n=== AGGREGATE ===`);
  const rawTok = totals.raw.tok;
  for (const mode of modes) {
    const t = totals[mode];
    const quality = ((100 * t.correct) / t.facts).toFixed(0);
    const save = mode === "raw" ? "" : `  (${Math.round((100 * (rawTok - t.tok)) / rawTok)}% fewer tokens)`;
    console.log(`  ${mode.padEnd(7)} ${t.tok} ctx tok   quality ${quality}% (${t.correct}/${t.facts})${save}`);
  }
  console.log(
    `\nThesis check: does ir/hybrid hold quality at a fraction of tokens? ` +
      `Compare quality% columns vs token savings. Equal-ish quality + big token cut = thesis holds.`
  );
}

main();
