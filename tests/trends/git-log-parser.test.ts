import { describe, it, expect } from "vitest";
import {
  parseGitLogOutput,
  parseGitBlameOutput,
  isBugFixCommit,
} from "../../src/trends/git-log-parser.js";

describe("isBugFixCommit", () => {
  it("detects fix keywords", () => {
    expect(isBugFixCommit("fix: resolve auth issue")).toBe(true);
    expect(isBugFixCommit("bugfix: handle null case")).toBe(true);
    expect(isBugFixCommit("hotfix: patch security hole")).toBe(true);
    expect(isBugFixCommit("Fix typo in login")).toBe(true);
  });

  it("rejects non-fix commits", () => {
    expect(isBugFixCommit("feat: add login page")).toBe(false);
    expect(isBugFixCommit("refactor: simplify auth")).toBe(false);
    expect(isBugFixCommit("docs: update readme")).toBe(false);
  });
});

describe("parseGitLogOutput", () => {
  it("parses git log --format output", () => {
    const output = [
      "abc123|Alice|2026-04-01|feat: add auth",
      "src/auth.ts",
      "src/login.ts",
      "",
      "def456|Bob|2026-04-02|fix: handle null user",
      "src/auth.ts",
      "",
    ].join("\n");

    const entries = parseGitLogOutput(output);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      hash: "abc123",
      author: "Alice",
      date: "2026-04-01",
      message: "feat: add auth",
      files: ["src/auth.ts", "src/login.ts"],
    });
    expect(entries[1]).toEqual({
      hash: "def456",
      author: "Bob",
      date: "2026-04-02",
      message: "fix: handle null user",
      files: ["src/auth.ts"],
    });
  });

  it("handles empty input", () => {
    expect(parseGitLogOutput("")).toEqual([]);
    expect(parseGitLogOutput("\n")).toEqual([]);
  });
});

describe("parseGitBlameOutput", () => {
  it("parses git blame --porcelain output", () => {
    const output = [
      "abc1234 1 1 1",
      "author Alice",
      "author-time 1712000000",
      "summary feat: add auth",
      "\tconst x = 1;",
    ].join("\n");

    const result = parseGitBlameOutput(output, 1);
    expect(result).toEqual({
      author: "Alice",
      date: expect.any(String),
      commitMessage: "feat: add auth",
    });
  });

  it("returns null for invalid input", () => {
    expect(parseGitBlameOutput("", 1)).toBeNull();
  });
});
