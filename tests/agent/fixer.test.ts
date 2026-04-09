import { describe, it, expect } from "vitest";
import { applyAutoFix, formatFixerPrompt } from "../../src/agent/fixer.js";
import type { Finding } from "../../src/types.js";

describe("applyAutoFix", () => {
  it("removes a line for remove-line action", () => {
    const code = 'const a = 1;\nconsole.log("debug");\nconst b = 2;';
    const result = applyAutoFix(code, 2, "remove-line");
    expect(result).toBe("const a = 1;\nconst b = 2;");
  });

  it("returns null for unknown fix type", () => {
    const result = applyAutoFix("code", 1, "unknown-action");
    expect(result).toBeNull();
  });
});

describe("formatFixerPrompt", () => {
  it("formats finding + IR into compact prompt", () => {
    const finding: Finding = {
      watcherId: "security",
      severity: "critical",
      file: "src/auth.ts",
      line: 5,
      message: "Potential hardcoded secret detected",
    };
    const ir = 'FN:handleAuth({creds}) [HOT:12/30 FIX:67%]\n  VAR:token = "sk-secret-123"';

    const prompt = formatFixerPrompt(finding, ir);
    expect(prompt).toContain("src/auth.ts");
    expect(prompt).toContain("Line: 5");
    expect(prompt).toContain("hardcoded secret");
    expect(prompt).toContain("HOT:12/30");
    expect(prompt).toContain("FN:handleAuth");
  });
});
