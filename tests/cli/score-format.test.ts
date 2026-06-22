import { describe, it, expect } from "vitest";
import {
  dollarsFor,
  buildBadgeUrl,
  buildBadgeMarkdown,
  buildShareLine,
  INPUT_PRICE_PER_MTOK,
} from "../../src/cli/score-format.js";

describe("score-format", () => {
  it("computes dollars at the Sonnet input price", () => {
    expect(dollarsFor(1_000_000)).toBe(INPUT_PRICE_PER_MTOK);
    expect(dollarsFor(0)).toBe(0);
  });

  it("builds a shields.io badge URL with the rounded percent", () => {
    const url = buildBadgeUrl(83.7);
    expect(url).toContain("img.shields.io/badge/");
    expect(url).toContain(encodeURIComponent("84% smaller"));
  });

  it("wraps the badge URL in markdown", () => {
    expect(buildBadgeMarkdown(83.7)).toBe(`![Composto](${buildBadgeUrl(83.7)})`);
  });

  it("builds a shareable one-liner with the key numbers and the npx CTA", () => {
    const line = buildShareLine(66, 56928, 9279, 83.7);
    expect(line).toContain("66-file");
    expect(line).toContain("83.7%");
    expect(line).toContain("56,928");
    expect(line).toContain("9,279");
    expect(line).toContain("npx composto-ai score");
  });
});
