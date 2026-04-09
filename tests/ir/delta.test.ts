import { describe, it, expect } from "vitest";
import { parseDiffOutput, buildDeltaContext } from "../../src/ir/delta.js";

describe("parseDiffOutput", () => {
  it("parses unified diff into hunks", () => {
    const diff = [
      "diff --git a/src/auth.ts b/src/auth.ts",
      "--- a/src/auth.ts",
      "+++ b/src/auth.ts",
      "@@ -10,3 +10,4 @@ function handleLogin() {",
      "   const user = getUser();",
      "+  const token = 'sk-hardcoded-123';",
      "   return user;",
    ].join("\n");

    const hunks = parseDiffOutput(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].startLine).toBe(10);
    expect(hunks[0].added).toContain("  const token = 'sk-hardcoded-123';");
    expect(hunks[0].context).toContain("  const user = getUser();");
  });

  it("handles multiple hunks", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -5,2 +5,3 @@",
      " line5",
      "+added1",
      "@@ -20,2 +21,3 @@",
      " line20",
      "+added2",
    ].join("\n");

    const hunks = parseDiffOutput(diff);
    expect(hunks).toHaveLength(2);
  });

  it("returns empty for no diff", () => {
    expect(parseDiffOutput("")).toEqual([]);
  });
});

describe("buildDeltaContext", () => {
  it("builds delta context from parsed hunks", () => {
    const hunks = [{
      startLine: 10, endLine: 13,
      added: ["  const token = 'hardcoded';"],
      removed: [],
      context: ["  const user = getUser();", "  return user;"],
    }];

    const result = buildDeltaContext("src/auth.ts", hunks);
    expect(result.file).toBe("src/auth.ts");
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].changed).toContain("  const token = 'hardcoded';");
  });
});
