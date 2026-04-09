import { describe, it, expect } from "vitest";
import { route, DEFAULT_ROUTES } from "../../src/router/router.js";
import type { Finding } from "../../src/types.js";

describe("route", () => {
  const baseFinding: Finding = {
    watcherId: "security",
    severity: "critical",
    file: "src/auth/login.ts",
    message: "hardcoded secret",
  };

  it("routes auth files to reviewer at L1", () => {
    const result = route(baseFinding, DEFAULT_ROUTES);
    expect(result.agents).toContain("reviewer");
    expect(result.irLayer).toBe("L1");
    expect(result.deterministic).toBe(true);
  });

  it("routes test files to reviewer at L0", () => {
    const finding: Finding = { ...baseFinding, file: "tests/auth.test.ts" };
    const result = route(finding, DEFAULT_ROUTES);
    expect(result.agents).toContain("reviewer");
    expect(result.irLayer).toBe("L0");
  });

  it("routes markdown to fixer at L0", () => {
    const finding: Finding = { ...baseFinding, file: "docs/README.md" };
    const result = route(finding, DEFAULT_ROUTES);
    expect(result.agents).toContain("fixer");
    expect(result.irLayer).toBe("L0");
  });

  it("falls back to fixer at L1 for unknown patterns", () => {
    const finding: Finding = { ...baseFinding, file: "src/utils/random.xyz" };
    const result = route(finding, DEFAULT_ROUTES);
    expect(result.agents).toContain("fixer");
    expect(result.deterministic).toBe(true);
  });
});
