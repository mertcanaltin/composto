import picomatch from "picomatch";
import type { Finding, RouteRule, RouteDecision } from "../types.js";

export const DEFAULT_ROUTES: RouteRule[] = [
  { pattern: "**/auth/**", agents: ["reviewer"], irLayer: "L1" },
  { pattern: "**/*.test.*", agents: ["reviewer"], irLayer: "L0" },
  { pattern: "**/*.spec.*", agents: ["reviewer"], irLayer: "L0" },
  { pattern: "**/*.md", agents: ["fixer"], irLayer: "L0" },
  { pattern: "**/*.json", agents: ["fixer"], irLayer: "L0" },
  { pattern: "**/*.yaml", agents: ["fixer"], irLayer: "L0" },
  { pattern: "**/*.yml", agents: ["fixer"], irLayer: "L0" },
];

const FALLBACK: RouteDecision = {
  agents: ["fixer"],
  irLayer: "L1",
  deterministic: true,
};

export function route(finding: Finding, rules: RouteRule[]): RouteDecision {
  for (const rule of rules) {
    if (!picomatch.isMatch(finding.file, rule.pattern)) continue;

    if (rule.contentSignal) {
      const content = finding.message + (finding.file ?? "");
      if (!rule.contentSignal.test(content)) continue;
    }

    return {
      agents: rule.agents,
      irLayer: rule.irLayer,
      deterministic: true,
    };
  }

  return FALLBACK;
}
