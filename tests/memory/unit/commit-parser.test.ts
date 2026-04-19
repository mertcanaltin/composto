import { describe, it, expect } from "vitest";
import { parseCommit } from "../../../src/memory/commit-parser.js";

describe("parseCommit", () => {
  it("detects fix-style subjects", () => {
    expect(parseCommit("fix: null pointer in auth", "").is_fix).toBe(true);
    expect(parseCommit("hotfix: race in session refresh", "").is_fix).toBe(true);
    expect(parseCommit("bug: login fails on empty body", "").is_fix).toBe(true);
    expect(parseCommit("Fixes #123: crash on startup", "").is_fix).toBe(true);
  });

  it("does not flag non-fix subjects", () => {
    expect(parseCommit("feat: add OTP login", "").is_fix).toBe(false);
    expect(parseCommit("refactor: extract helper", "").is_fix).toBe(false);
    expect(parseCommit("docs: update README", "").is_fix).toBe(false);
  });

  it("detects revert subjects and extracts reverted SHA", () => {
    const body = 'This reverts commit abc1234567890abcdef.\n\nReason: flaky.';
    const r = parseCommit('Revert "feat: add OTP login"', body);
    expect(r.is_revert).toBe(true);
    expect(r.reverts_sha).toBe("abc1234567890abcdef");
  });

  it("returns reverts_sha = null when no SHA is present", () => {
    const r = parseCommit("Revert: something", "no reference here");
    expect(r.is_revert).toBe(true);
    expect(r.reverts_sha).toBeNull();
  });

  it("handles multiline subjects safely", () => {
    const r = parseCommit("fix(auth): token leak\n\nmore context here", "");
    expect(r.is_fix).toBe(true);
    expect(r.is_revert).toBe(false);
  });
});
