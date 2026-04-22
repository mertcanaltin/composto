import {
  runScan, runTrends, runIR, runBenchmark, runBenchmarkQuality, runContext,
  runImpact, runIndex, runIndexStatus,
} from "./cli/commands.js";
import { runInit, type InitClient } from "./cli/init.js";
import { runHookDispatch, type Platform, type Event as HookEvent } from "./cli/hook/dispatcher.js";
import { runStats } from "./cli/stats.js";
import { openDatabase } from "./memory/db.js";
import { runMigrations } from "./memory/schema.js";
import { recordInvocation } from "./memory/telemetry/hook-invocations.js";
import { join, resolve } from "node:path";

async function readStdin(): Promise<string> {
  // Hook adapters expect a small JSON payload on stdin. If stdin is a TTY
  // (interactive), return "" so the dispatcher short-circuits via its
  // parse-failure passthrough.
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "scan": {
    const projectPath = resolve(args[1] ?? ".");
    runScan(projectPath);
    break;
  }
  case "trends": {
    const projectPath = resolve(args[1] ?? ".");
    runTrends(projectPath);
    break;
  }
  case "ir": {
    const filePath = args[1];
    const layer = args[2] ?? "L1";
    if (!filePath) {
      console.error("Usage: composto ir <file> [L0|L1|L2|L3]");
      process.exit(1);
    }
    await runIR(resolve("."), resolve(filePath), layer);
    break;
  }
  case "benchmark": {
    const projectPath = resolve(args[1] ?? ".");
    await runBenchmark(projectPath);
    break;
  }
  case "benchmark-quality": {
    const filePath = args[1];
    if (!filePath) {
      console.error("Usage: composto benchmark-quality <file>");
      process.exit(1);
    }
    await runBenchmarkQuality(resolve("."), resolve(filePath));
    break;
  }
  case "context": {
    const projectPath = resolve(args[1] && !args[1].startsWith("--") ? args[1] : ".");

    // Support both --flag value and --flag=value
    function parseFlag(name: string): string | undefined {
      const equalsForm = args.find(a => a.startsWith(`--${name}=`));
      if (equalsForm) return equalsForm.slice(name.length + 3);
      const idx = args.indexOf(`--${name}`);
      if (idx !== -1 && args[idx + 1]) return args[idx + 1];
      return undefined;
    }

    const budgetStr = parseFlag("budget");
    const budget = budgetStr ? parseInt(budgetStr, 10) : 4000;
    const target = parseFlag("target");
    await runContext(projectPath, budget, target);
    break;
  }
  case "impact": {
    const filePath = args[1];
    if (!filePath) {
      console.error("Usage: composto impact <file> [--intent=bugfix] [--level=detail]");
      process.exit(1);
    }
    const intentArg = args.find((a) => a.startsWith("--intent="));
    const levelArg = args.find((a) => a.startsWith("--level="));
    await runImpact(resolve("."), filePath, {
      intent: intentArg?.slice("--intent=".length),
      level: levelArg?.slice("--level=".length),
    });
    break;
  }
  case "index": {
    if (args.includes("--status")) {
      await runIndexStatus(resolve("."));
    } else {
      const sinceArg = args.find((a) => a.startsWith("--since="))?.slice("--since=".length);
      await runIndex(resolve("."), { since: sinceArg });
    }
    break;
  }
  case "init": {
    const valid = ["cursor", "claude-code", "gemini-cli"] as const;
    const clientArg = args.find((a) => a.startsWith("--client="))?.slice("--client=".length);
    if (clientArg && !(valid as readonly string[]).includes(clientArg)) {
      console.error(`Unknown --client=${clientArg}. Valid: ${valid.join(", ")}`);
      process.exit(1);
    }
    const result = runInit(resolve("."), { client: clientArg as InitClient | undefined });
    console.log(`composto init — configured for ${result.client}\n`);
    for (const f of result.written) console.log(`  wrote   ${f}`);
    for (const f of result.merged) console.log(`  merged  ${f}`);
    for (const f of result.skipped) console.log(`  skipped ${f} (already exists)`);
    console.log("\nRestart your AI client and check that 'composto' MCP is green.");
    console.log(
      "Composto collects local-only hook telemetry to help you monitor agent behavior. " +
        "Disable with `composto stats --disable` at any time.",
    );
    break;
  }
  case "hook": {
    // composto hook <platform> <event> — reads PreToolUse/BeforeTool JSON from
    // stdin, emits the platform's hook response envelope as JSON on stdout.
    // On ANY error → print '{"hookSpecificOutput":{}}' (universal passthrough).
    // Hooks MUST NEVER exit non-zero — that can hang the agent.
    //
    // After emitting the envelope, best-effort-writes one row to
    // hook_invocations for `composto stats`. Telemetry failures never
    // propagate.
    const hookStart = Date.now();
    try {
      const platform = args[1] as Platform | undefined;
      const event = args[2] as HookEvent | undefined;
      if (!platform || !event) {
        console.log('{"hookSpecificOutput":{}}');
        break;
      }
      const stdin = await readStdin();
      const result = await runHookDispatch({
        platform,
        event,
        stdin,
        cwd: process.cwd(),
      });
      console.log(JSON.stringify(result.envelope));

      // Telemetry — best-effort. Never throws.
      try {
        const dbPath = join(process.cwd(), ".composto", "memory.db");
        const db = openDatabase(dbPath);
        try {
          runMigrations(db);
          recordInvocation(db, {
            timestamp: Math.floor(Date.now() / 1000),
            platform,
            event,
            filePath: result.metadata.filePath,
            verdict: result.metadata.verdict,
            score: result.metadata.score,
            confidence: result.metadata.confidence,
            latencyMs: Date.now() - hookStart,
            cacheHit: false,
          });
        } finally {
          db.close();
        }
      } catch {
        /* telemetry best-effort */
      }
    } catch {
      console.log('{"hookSpecificOutput":{}}');
    }
    break;
  }
  case "stats": {
    const json = args.includes("--json");
    const disable = args.includes("--disable");
    const res = runStats({ cwd: resolve("."), json, disable });
    console.log(res.output);
    break;
  }
  case "version":
    console.log("composto v0.4.2");
    break;
  default:
    console.log("composto v0.4.2 — less tokens, more insight\n");
    console.log("Commands:");
    console.log("  scan [path]                           Scan codebase for issues");
    console.log("  trends [path]                         Analyze codebase health trends");
    console.log("  ir <file> [layer]                     Generate IR for a file (L0|L1|L2|L3)");
    console.log("  benchmark [path]                      Benchmark IR token savings");
    console.log("  benchmark-quality <file>              Compare AI responses: raw vs IR");
    console.log("  context [path] --budget N             Smart context within token budget");
    console.log("  context [path] --target <symbol>      Target file as raw, surrounding as IR");
    console.log("  impact <file>                         Show historical blast radius for a file");
    console.log("  index [--since=YYYY-MM-DD]            Build or refresh the memory index (--since bounds work for huge repos)");
    console.log("  index --status                        Show memory index diagnostics");
    console.log("  init [--client=<name>]                Configure Composto MCP + hooks for an AI client");
    console.log("                                          (clients: cursor, claude-code, gemini-cli)");
    console.log("  hook <platform> <event>               Run BlastRadius hook (reads tool JSON from stdin)");
    console.log("  stats [--json] [--disable]            Show hook telemetry (last 7d); --disable opts out");
    console.log("  version                               Show version");
    break;
}
