import { describe, it, expect } from "vitest";
import { detectInconsistencies } from "../../src/trends/inconsistency.js";
import type { GitLogEntry } from "../../src/types.js";

describe("detectInconsistencies", () => {
  it("detects multiple authors touching same file", () => {
    const entries: GitLogEntry[] = [
      { hash: "a1", author: "Alice", date: "2026-04-01", message: "feat: add auth", files: ["src/auth.ts"] },
      { hash: "a2", author: "Bob", date: "2026-04-02", message: "fix: auth null", files: ["src/auth.ts"] },
      { hash: "a3", author: "Carol", date: "2026-04-03", message: "refactor: auth flow", files: ["src/auth.ts"] },
    ];

    const result = detectInconsistencies(entries, 2);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("src/auth.ts");
    expect(result[0].patterns).toHaveLength(3);
  });

  it("ignores files with single author", () => {
    const entries: GitLogEntry[] = [
      { hash: "a1", author: "Alice", date: "2026-04-01", message: "feat: add", files: ["src/a.ts"] },
      { hash: "a2", author: "Alice", date: "2026-04-02", message: "fix: bug", files: ["src/a.ts"] },
    ];

    const result = detectInconsistencies(entries, 2);
    expect(result).toHaveLength(0);
  });
});
