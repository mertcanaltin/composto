import {
  runIR, runBenchmark, runBenchmarkQuality, runContext,
  runScore, writeProjectIndex,
} from "./cli/commands.js";
import { runInit, type InitClient } from "./cli/init.js";
import { runHookDispatch, type Platform, type Event as HookEvent } from "./cli/hook/dispatcher.js";
import { runStats } from "./cli/stats.js";
import { startProxy } from "./proxy/server.js";
import { startIndexDaemon } from "./daemon/index-server.js";
import { writeHandoff, readLatestHandoff, formatHandoff } from "./handoff/writer.js";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const PKG_VERSION = (() => {
  try {
    const req = createRequire(import.meta.url);
    return (req("../package.json") as { version: string }).version;
  } catch {
    return "0.0.0";
  }
})();

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
  case "score": {
    const projectPath = resolve(args[1] && !args[1].startsWith("--") ? args[1] : ".");
    await runScore(projectPath, args.includes("--json"));
    break;
  }
  case "reindex": {
    const projectPath = resolve(args[1] && !args[1].startsWith("--") ? args[1] : ".");
    const budgetStr = args.find(a => a.startsWith("--budget="))?.slice("--budget=".length);
    const budget = budgetStr ? parseInt(budgetStr, 10) : 6000;
    const outPath = join(projectPath, ".composto", "context.md");
    const r = await writeProjectIndex(projectPath, budget, outPath);
    console.log(`composto reindex — wrote .composto/context.md`);
    console.log(`  ${r.files} files → ~${r.tokens} tokens, generated at ${r.sha}`);
    console.log(`  Reference it in your agent: @.composto/context.md`);
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
  case "handoff": {
    const projectPath = resolve(args[1] && !args[1].startsWith("--") ? args[1] : ".");
    const json = args.includes("--json");
    const noSave = args.includes("--no-save");

    if (args.includes("--latest")) {
      const latest = readLatestHandoff(projectPath);
      if (!latest) {
        console.error("No saved handoff yet — run `composto handoff` first.");
        process.exit(1);
      }
      console.log(json ? JSON.stringify(latest) : formatHandoff(latest));
      break;
    }

    const h = await writeHandoff(projectPath, { noSave });
    if (json) {
      console.log(JSON.stringify(h));
    } else {
      console.log(formatHandoff(h));
      if (!noSave) console.log(`\n  saved   .composto/handoff.json  (combined ${h.combinedHash})`);
    }
    break;
  }
  case "start": {
    const projectPath = resolve(args[1] && !args[1].startsWith("--") ? args[1] : ".");
    const budgetStr = args.find(a => a.startsWith("--budget="))?.slice("--budget=".length);
    const budget = budgetStr ? parseInt(budgetStr, 10) : 6000;
    const outPath = join(projectPath, ".composto", "context.md");
    const handle = await startIndexDaemon({ projectPath, budget, outPath });
    const shutdown = () => { handle.stop(); console.log("\ncomposto: stopped"); process.exit(0); };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    break; // watcher keeps the process alive
  }
  case "proxy": {
    const portFlag = args.indexOf("--port");
    const port = portFlag >= 0 ? Number(args[portFlag + 1]) : Number(process.env.COMPOSTO_PROXY_PORT ?? 8787);
    if (!Number.isInteger(port) || port <= 0) {
      console.error("Usage: composto proxy [--port N]");
      process.exit(1);
    }
    startProxy(port);
    break; // server keeps the process alive
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
    const json = args.includes("--json");
    await runContext(projectPath, budget, target, json);
    break;
  }
  case "init": {
    const valid = ["cursor", "claude-code", "gemini-cli"] as const;
    const clientArg = args.find((a) => a.startsWith("--client="))?.slice("--client=".length);
    if (clientArg && !(valid as readonly string[]).includes(clientArg)) {
      console.error(`Unknown --client=${clientArg}. Valid: ${valid.join(", ")}`);
      process.exit(1);
    }
    const withRules = args.includes("--with-rules");
    const withMcp = args.includes("--with-mcp");
    const withCompress = args.includes("--with-compress");
    const result = runInit(resolve("."), {
      client: clientArg as InitClient | undefined,
      withRules,
      withMcp,
      withCompress,
    });
    console.log(`composto init — configured for ${result.client}\n`);
    for (const f of result.written) console.log(`  wrote   ${f}`);
    for (const f of result.merged) console.log(`  merged  ${f}`);
    for (const f of result.skipped) console.log(`  skipped ${f} (already exists)`);

    if (args.includes("--with-index")) {
      const outPath = join(resolve("."), ".composto", "context.md");
      const r = await writeProjectIndex(resolve("."), 6000, outPath);
      console.log(`  wrote   .composto/context.md (${r.files} files → ~${r.tokens} tokens, @ ${r.sha})`);
      console.log(`\nNavigation map ready. Tell your agent to consult it first:`);
      console.log(`  "@.composto/context.md to find files before searching the repo"`);
      console.log(`  Refresh after code changes: composto reindex`);
    }
    console.log("\nRestart your AI client and check that 'composto' MCP is green.");
    console.log(
      "Composto collects local-only hook telemetry to help you monitor agent behavior. " +
        "Disable with `composto stats --disable` at any time.",
    );
    break;
  }
  case "hook": {
    // composto hook <platform> <event> — reads the PostToolUse Read JSON from
    // stdin, emits the compress-read response envelope as JSON on stdout.
    // On ANY error → print '{"hookSpecificOutput":{}}' (universal passthrough).
    // Hooks MUST NEVER exit non-zero — that can hang the agent.
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
    console.log(`composto v${PKG_VERSION}`);
    break;
  default:
    console.log(`composto v${PKG_VERSION} — fast structural map, max meaning per token\n`);
    console.log("Commands:");
    console.log("  ir <file> [layer]                     Compress a file to structural IR (L0|L1|L2|L3)");
    console.log("  context [path] --budget N             Pack a directory's map into a token budget");
    console.log("  context [path] --target <symbol>      Target file as raw, surrounding as IR");
    console.log("  context [path] --json                Machine-readable output for piping into agents/scripts");
    console.log("  reindex [path] [--budget=N]          Write/refresh the navigation map at .composto/context.md (SHA-stamped)");
    console.log("  start [path] [--budget=N]            Keep the navigation map live: file watcher auto-refreshes .composto/context.md");
    console.log("  handoff [path] [--json] [--latest]   Cross-agent map artifact: layered prefix/delta + hashes, changed files as IR");
    console.log("  score [path] [--json]                Shareable scorecard: what your repo costs an AI");
    console.log("  benchmark [path]                      Benchmark IR token savings");
    console.log("  benchmark-quality <file>              Compare AI responses: raw vs IR");
    console.log("  init [--client=<name>] [--with-mcp] [--with-compress]");
    console.log("                                        Wire Composto into your agent (clients: claude-code, cursor, gemini-cli)");
    console.log("                                          --with-mcp       register the composto MCP server (ir/context/benchmark)");
    console.log("                                          --with-compress  auto-compress large code Reads to IR (claude-code; saves tokens, see `stats`)");
    console.log("                                          --with-index     generate .composto/context.md navigation map");
    console.log("  hook <platform> <event>               Run the compress-read hook (reads tool JSON from stdin)");
    console.log("  stats [--json] [--disable]            Show cumulative compression savings; --disable opts out");
    console.log("  proxy [--port N]                      Compression proxy, experimental (point your LLM base URL at it)");
    console.log("  version                               Show version");
    break;
}
