import { describe, it, expect } from "vitest";
import { packContext, findTargetFile } from "../../src/context/packer.ts";

describe("packContext", () => {
  const files = [
    { path: "src/big.ts", code: "export function big() {\n  const x = 1;\n  return x;\n}", rawTokens: 500 },
    { path: "src/small.ts", code: "export function small() { return 1; }", rawTokens: 100 },
    { path: "src/medium.ts", code: "export function med() {\n  if (true) return 2;\n}", rawTokens: 300 },
  ];

  it("returns all L0 when budget is very small", async () => {
    // L0 representations are very compact (~5-6 tokens each).
    // Use a budget that fits L0 but leaves no room for L1 upgrades.
    const result = await packContext(files, { budget: 20, hotspots: [] });
    expect(result.entries.every(e => e.layer === "L0")).toBe(true);
    expect(result.totalTokens).toBeLessThanOrEqual(20);
  });

  it("upgrades files to L1 when budget allows", async () => {
    const result = await packContext(files, { budget: 5000, hotspots: [] });
    expect(result.entries.some(e => e.layer === "L1")).toBe(true);
    expect(result.totalTokens).toBeLessThanOrEqual(5000);
  });

  it("prioritizes hotspot files for L1 upgrade", async () => {
    const hotspots = [{ file: "src/small.ts", changesInLast30Commits: 15, bugFixRatio: 0.6, authorCount: 3 }];
    const result = await packContext(files, { budget: 300, hotspots });
    const smallEntry = result.entries.find(e => e.path === "src/small.ts");
    expect(smallEntry?.layer).toBe("L1");
  });

  it("never exceeds the budget", async () => {
    const result = await packContext(files, { budget: 50, hotspots: [] });
    expect(result.totalTokens).toBeLessThanOrEqual(50);
  });

  describe("with target", () => {
    const targetFiles = [
      { path: "src/auth.ts", code: "export function validateToken(token: string) {\n  if (!token) return false;\n  return true;\n}", rawTokens: 150 },
      { path: "src/other.ts", code: "export function otherFn() {\n  validateToken('x');\n  return 1;\n}", rawTokens: 80 },
      { path: "src/unrelated.ts", code: "export function hello() { return 'hi'; }", rawTokens: 50 },
    ];

    it("puts target file at L3 (raw) when budget allows", async () => {
      const result = await packContext(targetFiles, { budget: 1000, hotspots: [], target: "validateToken" });
      expect(result.targetFile).toBe("src/auth.ts");
      expect(result.filesAtL3).toBe(1);
      const targetEntry = result.entries.find(e => e.isTarget);
      expect(targetEntry?.layer).toBe("L3");
      expect(targetEntry?.ir).toContain("export function validateToken");
    });

    it("warns with targetDowngraded=true when target too large for L3", async () => {
      const bigTarget = [
        { path: "src/huge.ts", code: "export function huge() {\n" + "  const x = 1;\n".repeat(500) + "  return x;\n}", rawTokens: 5000 },
      ];
      const result = await packContext(bigTarget, { budget: 200, hotspots: [], target: "huge" });
      expect(result.targetDowngraded).toBe(true);
      expect(result.filesAtL3).toBe(0);
    });

    it("returns no targetFile when symbol is not found", async () => {
      const result = await packContext(targetFiles, { budget: 1000, hotspots: [], target: "nonExistentSymbol" });
      expect(result.targetFile).toBeUndefined();
      expect(result.filesAtL3).toBe(0);
    });

    it("still works without target (backward compat)", async () => {
      const result = await packContext(targetFiles, { budget: 1000, hotspots: [] });
      expect(result.targetFile).toBeUndefined();
      expect(result.filesAtL3).toBe(0);
      expect(result.entries.length).toBe(3);
    });
  });
});

describe("findTargetFile", () => {
  it("finds function declaration", () => {
    const files = [
      { path: "a.ts", code: "export function validateToken() { return true; }", rawTokens: 10 },
      { path: "b.ts", code: "import { validateToken } from './a.js';\nvalidateToken();", rawTokens: 10 },
    ];
    expect(findTargetFile(files, "validateToken")).toBe("a.ts");
  });

  it("prefers declaration over call site regardless of file order", () => {
    // Put the file with the call first — declaration should still win
    const files = [
      { path: "caller.ts", code: "import { myFn } from './x.js';\nmyFn();\nmyFn(1, 2);", rawTokens: 10 },
      { path: "decl.ts", code: "export function myFn() {}", rawTokens: 10 },
    ];
    expect(findTargetFile(files, "myFn")).toBe("decl.ts");
  });

  it("escapes regex special characters in target name", () => {
    // If we didn't escape, 'foo.bar' would match 'fooXbar' in unrelated files
    const files = [
      { path: "a.ts", code: "const fooXbar = 1;", rawTokens: 10 },
      { path: "b.ts", code: "const fooDotbar = 'foo.bar not here';", rawTokens: 10 },
    ];
    // Target 'foo.bar' shouldn't match either file (no literal foo.bar declaration)
    expect(findTargetFile(files, "foo.bar")).toBe(null);
  });

  it("finds class declarations", () => {
    const files = [{ path: "a.ts", code: "export class UserService { login() {} }", rawTokens: 20 }];
    expect(findTargetFile(files, "UserService")).toBe("a.ts");
  });

  it("finds Python def", () => {
    const files = [{ path: "a.py", code: "def load_config(path: str):\n  return {}", rawTokens: 15 }];
    expect(findTargetFile(files, "load_config")).toBe("a.py");
  });

  it("returns null for unknown symbol", () => {
    const files = [{ path: "a.ts", code: "function hello() {}", rawTokens: 10 }];
    expect(findTargetFile(files, "nonExistent")).toBe(null);
  });
});
