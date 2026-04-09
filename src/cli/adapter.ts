import type { CompostoMessage, CompostoProtocol, FileChangeEvent, Finding, TrendAnalysis } from "../types.js";

export class CLIAdapter implements CompostoProtocol {
  onFileChange(_event: FileChangeEvent): void {}
  onCommand(_cmd: string, _args: string[]): void {}
  onApproval(_proposalId: string, _approved: boolean): void {}

  notify(message: CompostoMessage): void {
    switch (message.type) {
      case "finding":
        this.printFinding(message.data);
        break;
      case "trend-report":
        this.printTrendReport(message.data);
        break;
      case "proposal":
        console.log(`\n  Proposal [${message.data.id}]: ${message.data.description}`);
        for (const f of message.data.findings) this.printFinding(f);
        break;
      case "edit":
        console.log(`  [EDIT] ${message.data.file}`);
        break;
      case "question":
        console.log(`  [?] ${message.data.text}`);
        if (message.data.options) {
          message.data.options.forEach((o, i) => console.log(`    ${i + 1}. ${o}`));
        }
        break;
    }
  }

  private printFinding(finding: Finding): void {
    const icon = finding.severity === "critical" ? "!!" : finding.severity === "warning" ? " !" : "  ";
    const loc = finding.line ? `:${finding.line}` : "";
    console.log(`  ${icon} [${finding.severity.toUpperCase()}] ${finding.file}${loc}`);
    console.log(`     ${finding.message}`);
  }

  private printTrendReport(trends: TrendAnalysis): void {
    if (trends.hotspots.length === 0 && trends.decaySignals.length === 0 && trends.inconsistencies.length === 0) {
      console.log("  Codebase is healthy. No trends to report.");
      return;
    }

    if (trends.hotspots.length > 0) {
      console.log("\n  Hotspots:");
      for (const h of trends.hotspots) {
        console.log(`    ${h.file} — ${h.changesInLast30Commits} changes, ${Math.round(h.bugFixRatio * 100)}% fixes, ${h.authorCount} authors`);
      }
    }

    if (trends.decaySignals.length > 0) {
      console.log("\n  Decay Signals:");
      for (const d of trends.decaySignals) {
        console.log(`    ${d.file} — ${d.metric} is ${d.trend}`);
      }
    }

    if (trends.inconsistencies.length > 0) {
      console.log("\n  Inconsistencies:");
      for (const ic of trends.inconsistencies) {
        console.log(`    ${ic.file} — ${ic.patterns.length} different patterns`);
      }
    }
  }
}
