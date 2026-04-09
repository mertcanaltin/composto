import { describe, it, expect } from "vitest";
import { detectDecay } from "../../src/trends/decay.js";
import type { GitLogEntry } from "../../src/types.js";

describe("detectDecay", () => {
  it("detects increasing churn as declining signal", () => {
    const entries: GitLogEntry[] = [
      { hash: "a1", author: "A", date: "2026-03-01", message: "feat: x", files: ["src/a.ts"] },
      { hash: "a2", author: "A", date: "2026-03-15", message: "fix: x", files: ["src/a.ts"] },
      { hash: "a3", author: "A", date: "2026-03-20", message: "fix: x", files: ["src/a.ts"] },
      { hash: "a4", author: "A", date: "2026-03-25", message: "fix: x", files: ["src/a.ts"] },
      { hash: "a5", author: "A", date: "2026-03-28", message: "fix: x", files: ["src/a.ts"] },
      { hash: "a6", author: "A", date: "2026-04-01", message: "fix: x", files: ["src/a.ts"] },
    ];

    const decay = detectDecay(entries);
    expect(decay.length).toBeGreaterThan(0);
    const signal = decay.find((d) => d.file === "src/a.ts");
    expect(signal).toBeDefined();
    expect(signal!.trend).toBe("declining");
    expect(signal!.metric).toBe("churn");
  });

  it("returns empty for stable files", () => {
    const entries: GitLogEntry[] = [
      { hash: "a1", author: "A", date: "2026-03-01", message: "feat: x", files: ["src/a.ts"] },
    ];
    expect(detectDecay(entries)).toHaveLength(0);
  });
});
