import { describe, it, expect } from "vitest";
import { extractStructure } from "../src/ir/structure.js";
import { fingerprintFile } from "../src/ir/fingerprint.js";
import { generateL0, generateL1 } from "../src/ir/layers.js";
import { buildHealthTag, annotateIR, computeHealthFromTrends } from "../src/ir/health.js";
import { runDetector } from "../src/watcher/detector.js";
import { route, DEFAULT_ROUTES } from "../src/router/router.js";
import { parseConfig } from "../src/config/loader.js";
import { detectHotspots } from "../src/trends/hotspot.js";
import type { GitLogEntry, TrendAnalysis } from "../src/types.js";

describe("End-to-end: Health-Aware IR pipeline", () => {
  const sampleCode = [
    'import { useState, useEffect } from "react";',
    'import { fetchUser } from "../api";',
    "",
    "export function UserProfile({ userId }) {",
    "  const [user, setUser] = useState(null);",
    "  const [loading, setLoading] = useState(true);",
    '  console.log("debug: loading user", userId);',
    "  useEffect(() => {",
    "    fetchUser(userId).then((u) => {",
    "      setUser(u);",
    "      setLoading(false);",
    "    });",
    "  }, [userId]);",
    "  if (loading) return null;",
    "  if (!user) return null;",
    "  return user.name;",
    "}",
  ].join("\n");

  it("L0: generates compact structure map", () => {
    const l0 = generateL0(sampleCode, "src/UserProfile.tsx");
    expect(l0).toContain("src/UserProfile.tsx");
    expect(l0).toContain("UserProfile");
  });

  it("L1: generates IR with health", async () => {
    const health = {
      churn: 15, fixRatio: 0.67, coverageTrend: "down" as const,
      staleness: "", authorCount: 3, consistency: "low" as const,
    };

    const l1 = await generateL1(sampleCode, "src/UserProfile.tsx", health);
    expect(l1).toContain("[HOT:15/30 FIX:67% COV:↓ INCON]");

    // Token comparison (rough word count as proxy)
    const rawTokenEstimate = sampleCode.split(/\s+/).length;
    const irTokenEstimate = l1.split(/\s+/).length;
    const savings = 1 - irTokenEstimate / rawTokenEstimate;
    expect(savings).toBeGreaterThan(0.1);
  });

  it("Detector: finds console.log in source file", () => {
    const config = parseConfig(`
watchers:
  consoleLog:
    enabled: true
    severity:
      "src/**": warning
`);
    const findings = runDetector(sampleCode, "src/UserProfile.tsx", config.watchers);
    expect(findings.some((f) => f.watcherId === "consoleLog")).toBe(true);
  });

  it("Router: routes finding to correct agent", () => {
    const finding = {
      watcherId: "consoleLog",
      severity: "warning" as const,
      file: "src/UserProfile.tsx",
      line: 7,
      message: "console.log detected",
    };
    const decision = route(finding, DEFAULT_ROUTES);
    expect(decision.deterministic).toBe(true);
  });

  it("Trends -> Health -> IR: full pipeline", () => {
    const entries: GitLogEntry[] = Array.from({ length: 15 }, (_, i) => ({
      hash: `h${i}`,
      author: i % 3 === 0 ? "Alice" : i % 3 === 1 ? "Bob" : "Carol",
      date: `2026-04-${String(i + 1).padStart(2, "0")}`,
      message: i % 2 === 0 ? "fix: something" : "feat: something",
      files: ["src/UserProfile.tsx"],
    }));

    const trends: TrendAnalysis = {
      hotspots: detectHotspots(entries, { threshold: 10, fixRatioThreshold: 0.4 }),
      decaySignals: [],
      inconsistencies: [],
    };

    expect(trends.hotspots).toHaveLength(1);
    expect(trends.hotspots[0].file).toBe("src/UserProfile.tsx");

    const health = computeHealthFromTrends("src/UserProfile.tsx", trends);
    expect(health.churn).toBe(15);

    const tag = buildHealthTag(health);
    expect(tag).toContain("HOT:");

    const ir = fingerprintFile(sampleCode, 0.6);
    const annotated = annotateIR(ir, health);
    expect(annotated).toContain("[HOT:");
  });
});
