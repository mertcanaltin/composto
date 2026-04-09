import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { CompostoConfig } from "../types.js";

export const DEFAULT_CONFIG: CompostoConfig = {
  watchers: {
    security: {
      enabled: true,
      severity: { "src/**": "warning", "tests/**": "info" },
    },
    deadCode: { enabled: true, trigger: "on-commit" },
    consoleLog: { enabled: true, severity: { "src/**": "warning", "tests/**": "info" } },
  },
  agents: {
    fixer: { enabled: true, model: "haiku" },
    reviewer: { enabled: false, model: "sonnet" },
  },
  ir: {
    deltaContextLines: 3,
    confidenceThreshold: 0.6,
    genericPatterns: "default",
  },
  trends: {
    enabled: true,
    hotspotThreshold: 10,
    bugFixRatioThreshold: 0.5,
    decayCheckTrigger: "on-commit",
    fullReportSchedule: "weekly",
  },
};

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] ?? {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function parseConfig(yamlContent: string): CompostoConfig {
  if (!yamlContent.trim()) return { ...DEFAULT_CONFIG };
  const parsed = parse(yamlContent) ?? {};
  return deepMerge(DEFAULT_CONFIG, parsed) as CompostoConfig;
}

export function loadConfig(projectPath: string): CompostoConfig {
  const configPath = join(projectPath, ".composto", "config.yaml");
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };
  const content = readFileSync(configPath, "utf-8");
  return parseConfig(content);
}
