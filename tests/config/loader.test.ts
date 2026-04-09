import { describe, it, expect } from "vitest";
import { parseConfig, DEFAULT_CONFIG } from "../../src/config/loader.js";

describe("parseConfig", () => {
  it("parses valid YAML config", () => {
    const yaml = `
watchers:
  security:
    enabled: true
    severity:
      "src/**": warning
      "tests/**": info
agents:
  fixer:
    enabled: true
    model: haiku
ir:
  deltaContextLines: 3
  confidenceThreshold: 0.6
  genericPatterns: default
trends:
  enabled: true
  hotspotThreshold: 10
  bugFixRatioThreshold: 0.5
  decayCheckTrigger: on-commit
  fullReportSchedule: weekly
`;
    const config = parseConfig(yaml);
    expect(config.watchers.security.enabled).toBe(true);
    expect(config.watchers.security.severity?.["src/**"]).toBe("warning");
    expect(config.agents.fixer.model).toBe("haiku");
    expect(config.ir.confidenceThreshold).toBe(0.6);
    expect(config.trends.hotspotThreshold).toBe(10);
  });

  it("returns defaults for empty input", () => {
    const config = parseConfig("");
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial config with defaults", () => {
    const yaml = `
watchers:
  security:
    enabled: false
`;
    const config = parseConfig(yaml);
    expect(config.watchers.security.enabled).toBe(false);
    expect(config.agents.fixer.enabled).toBe(true);
    expect(config.ir.deltaContextLines).toBe(3);
  });
});
