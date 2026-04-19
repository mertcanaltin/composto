import { describe, it, expect } from "vitest";
import { mapVerdict } from "../../../src/memory/verdict.js";

describe("mapVerdict", () => {
  it("returns 'unknown' whenever confidence < 0.3 regardless of score", () => {
    expect(mapVerdict(0.1, 0.2)).toBe("unknown");
    expect(mapVerdict(0.9, 0.29)).toBe("unknown");
  });

  it("returns 'low' for score < 0.3 at sufficient confidence", () => {
    expect(mapVerdict(0.1, 0.5)).toBe("low");
    expect(mapVerdict(0.29, 0.9)).toBe("low");
  });

  it("returns 'medium' for 0.3 <= score < 0.6 at sufficient confidence", () => {
    expect(mapVerdict(0.3, 0.5)).toBe("medium");
    expect(mapVerdict(0.59, 0.8)).toBe("medium");
  });

  it("returns 'high' for score >= 0.6 at sufficient confidence", () => {
    expect(mapVerdict(0.6, 0.5)).toBe("high");
    expect(mapVerdict(0.95, 1.0)).toBe("high");
  });
});
