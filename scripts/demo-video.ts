#!/usr/bin/env node
// Composto demo script for video recording
// Runs a live comparison: raw code vs Composto IR against Claude API
//
// Requirements: ANTHROPIC_API_KEY env var, run from composto repo root
// Usage: node scripts/demo-video.mjs

import { readFileSync } from 'node:fs';
import { generateLayer } from '../src/ir/layers.ts';
import { estimateTokens } from '../src/benchmark/tokenizer.ts';

const FILE = process.argv[2] ?? '/Users/mert/Desktop/enjoy/fastify/lib/reply.js';
const QUESTION = "Explain how this file handles payload dispatch. What are the main checks it performs?";

// Terminal colors for dramatic effect
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function printHeader(text, color = 'blue') {
  const bar = '═'.repeat(text.length + 4);
  console.log(`\n${c[color]}${c.bold}${bar}${c.reset}`);
  console.log(`${c[color]}${c.bold}  ${text}  ${c.reset}`);
  console.log(`${c[color]}${c.bold}${bar}${c.reset}\n`);
}

async function askClaude(prompt, apiKey) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const start = performance.now();
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });
  const elapsed = performance.now() - start;
  const text = response.content.find(b => b.type === 'text')?.text ?? '';
  return {
    tokens: response.usage.input_tokens,
    outTokens: response.usage.output_tokens,
    ms: elapsed,
    text,
  };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(`${c.red}ANTHROPIC_API_KEY not set${c.reset}`);
    process.exit(1);
  }

  printHeader('COMPOSTO LIVE DEMO', 'cyan');
  console.log(`${c.gray}File:${c.reset}  ${FILE.split('/').slice(-2).join('/')}`);
  console.log(`${c.gray}Model:${c.reset} claude-haiku-4-5`);
  console.log(`${c.gray}Task:${c.reset}  ${QUESTION}\n`);

  await sleep(2000);

  // ─────────────────────────────────────────────────────────
  // Round 1: Raw code
  // ─────────────────────────────────────────────────────────
  const code = readFileSync(FILE, 'utf-8');
  const rawTokens = estimateTokens(code);

  printHeader('Without Composto', 'red');
  console.log(`${c.gray}Sending raw code to Claude...${c.reset}`);
  console.log(`${c.gray}Tokens estimated:${c.reset} ${c.bold}${c.red}${rawTokens.toLocaleString()}${c.reset}\n`);

  await sleep(1500);

  const rawResult = await askClaude(`${QUESTION}\n\n${code}`, apiKey);

  console.log(`${c.gray}Actual input tokens:${c.reset}  ${c.bold}${c.red}${rawResult.tokens.toLocaleString()}${c.reset}`);
  console.log(`${c.gray}Output tokens:${c.reset}        ${rawResult.outTokens}`);
  console.log(`${c.gray}Response time:${c.reset}        ${(rawResult.ms / 1000).toFixed(1)}s\n`);

  console.log(`${c.dim}--- Claude's answer (excerpt) ---${c.reset}`);
  console.log(rawResult.text.split('\n').slice(0, 8).join('\n'));
  console.log(`${c.dim}--- end ---${c.reset}\n`);

  await sleep(3000);

  // ─────────────────────────────────────────────────────────
  // Round 2: Composto IR
  // ─────────────────────────────────────────────────────────
  const ir = await generateLayer('L1', { code, filePath: FILE, health: null });
  const irTokens = estimateTokens(ir);

  printHeader('With Composto', 'green');
  console.log(`${c.gray}Sending compressed IR to Claude...${c.reset}`);
  console.log(`${c.gray}Tokens estimated:${c.reset} ${c.bold}${c.green}${irTokens.toLocaleString()}${c.reset}\n`);

  await sleep(1500);

  const irResult = await askClaude(`${QUESTION}\n\n${ir}`, apiKey);

  console.log(`${c.gray}Actual input tokens:${c.reset}  ${c.bold}${c.green}${irResult.tokens.toLocaleString()}${c.reset}`);
  console.log(`${c.gray}Output tokens:${c.reset}        ${irResult.outTokens}`);
  console.log(`${c.gray}Response time:${c.reset}        ${(irResult.ms / 1000).toFixed(1)}s\n`);

  console.log(`${c.dim}--- Claude's answer (excerpt) ---${c.reset}`);
  console.log(irResult.text.split('\n').slice(0, 8).join('\n'));
  console.log(`${c.dim}--- end ---${c.reset}\n`);

  await sleep(3000);

  // ─────────────────────────────────────────────────────────
  // Final scoreboard
  // ─────────────────────────────────────────────────────────
  printHeader('RESULT', 'yellow');

  const saved = rawResult.tokens - irResult.tokens;
  const savedPct = ((saved / rawResult.tokens) * 100).toFixed(1);
  // Opus pricing: $15 / 1M input tokens
  const costRaw = (rawResult.tokens / 1_000_000) * 15;
  const costIr = (irResult.tokens / 1_000_000) * 15;
  const costSaved = costRaw - costIr;

  console.log(`${c.red}Without Composto:${c.reset}  ${rawResult.tokens.toLocaleString().padStart(7)} tokens   $${costRaw.toFixed(4)} per query (Opus)`);
  console.log(`${c.green}With Composto:${c.reset}     ${irResult.tokens.toLocaleString().padStart(7)} tokens   $${costIr.toFixed(4)} per query (Opus)`);
  console.log();
  console.log(`${c.bold}${c.yellow}  ${savedPct}% fewer tokens${c.reset}`);
  console.log(`${c.bold}${c.yellow}  $${costSaved.toFixed(4)} saved per query${c.reset}`);
  console.log(`${c.bold}${c.yellow}  $${(costSaved * 50 * 30).toFixed(2)} saved per month (50 calls/day)${c.reset}`);
  console.log();
  console.log(`${c.cyan}  npm i -g composto-ai${c.reset}`);
  console.log(`${c.cyan}  composto.dev${c.reset}\n`);
}

main().catch(err => {
  console.error(`${c.red}Error:${c.reset}`, err.message);
  process.exit(1);
});
