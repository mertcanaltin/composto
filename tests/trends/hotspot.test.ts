import { describe, it, expect } from "vitest";
import { detectHotspots } from "../../src/trends/hotspot.js";
import type { GitLogEntry } from "../../src/types.js";

describe("detectHotspots", () => {
  it("identifies files with high churn and fix ratio", () => {
    const entries: GitLogEntry[] = [
      { hash: "a1", author: "Alice", date: "2026-04-01", message: "feat: add auth", files: ["src/auth.ts"] },
      { hash: "a2", author: "Bob", date: "2026-04-02", message: "fix: null check", files: ["src/auth.ts"] },
      { hash: "a3", author: "Alice", date: "2026-04-03", message: "fix: session bug", files: ["src/auth.ts"] },
      { hash: "a4", author: "Carol", date: "2026-04-04", message: "fix: token expiry", files: ["src/auth.ts"] },
      { hash: "a5", author: "Alice", date: "2026-04-05", message: "feat: add page", files: ["src/page.ts"] },
    ];

    const hotspots = detectHotspots(entries, { threshold: 3, fixRatioThreshold: 0.5 });
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0].file).toBe("src/auth.ts");
    expect(hotspots[0].changesInLast30Commits).toBe(4);
    expect(hotspots[0].bugFixRatio).toBeCloseTo(0.75);
    expect(hotspots[0].authorCount).toBe(3);
  });

  it("returns empty for healthy codebase", () => {
    const entries: GitLogEntry[] = [
      { hash: "a1", author: "Alice", date: "2026-04-01", message: "feat: add auth", files: ["src/auth.ts"] },
      { hash: "a2", author: "Alice", date: "2026-04-02", message: "feat: add page", files: ["src/page.ts"] },
    ];

    const hotspots = detectHotspots(entries, { threshold: 3, fixRatioThreshold: 0.5 });
    expect(hotspots).toHaveLength(0);
  });
});
