import { runScan, runTrends, runIR, runBenchmark, runBenchmarkQuality, runContext } from "./cli/commands.js";
import { resolve } from "node:path";

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
    const projectPath = resolve(args[1] ?? ".");
    const budgetFlag = args.indexOf("--budget");
    const budget = budgetFlag !== -1 && args[budgetFlag + 1] ? parseInt(args[budgetFlag + 1], 10) : 4000;
    await runContext(projectPath, budget);
    break;
  }
  case "version":
    console.log("composto v0.1.0");
    break;
  default:
    console.log("composto v0.1.0 — less tokens, more insight\n");
    console.log("Commands:");
    console.log("  scan [path]          Scan codebase for issues");
    console.log("  trends [path]        Analyze codebase health trends");
    console.log("  ir <file> [layer]    Generate IR for a file (L0|L1|L2|L3)");
    console.log("  benchmark [path]     Benchmark IR token savings");
    console.log("  benchmark-quality <file>  Compare AI responses: raw vs IR");
    console.log("  context [path] --budget N  Smart context within token budget");
    console.log("  version              Show version");
    break;
}
