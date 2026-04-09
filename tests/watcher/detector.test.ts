import { describe, it, expect } from "vitest";
import { runDetector, securityRule, consoleLogRule } from "../../src/watcher/detector.js";
import type { WatcherConfig } from "../../src/types.js";

describe("securityRule", () => {
  it("detects hardcoded secrets", () => {
    const code = 'const token = "sk-proj-abc123def456ghijklmn";';
    const findings = securityRule(code, "src/auth.ts", { "src/**": "critical" });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].message).toContain("hardcoded secret");
  });

  it("detects API keys", () => {
    const code = 'const key = "AKIA1234567890ABCDEF";';
    const findings = securityRule(code, "src/config.ts", { "src/**": "critical" });
    expect(findings).toHaveLength(1);
  });

  it("uses correct severity for test files", () => {
    const code = 'const token = "sk-test-abc123def456ghijklmno";';
    const findings = securityRule(code, "tests/auth.test.ts", { "tests/**": "info" });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
  });

  it("returns empty for clean code", () => {
    const code = "const token = process.env.TOKEN;";
    const findings = securityRule(code, "src/auth.ts", { "src/**": "critical" });
    expect(findings).toHaveLength(0);
  });
});

describe("consoleLogRule", () => {
  it("detects console.log in source", () => {
    const code = '  console.log("debug info");';
    const findings = consoleLogRule(code, "src/app.ts", { "src/**": "warning" });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
  });

  it("marks as info in test files", () => {
    const code = '  console.log("test output");';
    const findings = consoleLogRule(code, "tests/app.test.ts", { "tests/**": "info" });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
  });
});

describe("runDetector", () => {
  it("runs all enabled rules", () => {
    const code = 'const key = "sk-secret-12345678901234567890";\nconsole.log("debug");';
    const config: Record<string, WatcherConfig> = {
      security: { enabled: true, severity: { "src/**": "critical" } },
      consoleLog: { enabled: true, severity: { "src/**": "warning" } },
    };
    const findings = runDetector(code, "src/app.ts", config);
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });

  it("skips disabled rules", () => {
    const code = 'console.log("debug");';
    const config: Record<string, WatcherConfig> = {
      consoleLog: { enabled: false, severity: { "src/**": "warning" } },
    };
    const findings = runDetector(code, "src/app.ts", config);
    expect(findings).toHaveLength(0);
  });
});
