import { describe, it, expect } from "vitest";
import { detectLanguage, SUPPORTED_EXTENSIONS } from "../../src/parser/languages.js";

describe("detectLanguage", () => {
  it("detects TypeScript", () => {
    expect(detectLanguage("app.ts")).toBe("typescript");
    expect(detectLanguage("component.tsx")).toBe("typescript");
  });

  it("detects JavaScript", () => {
    expect(detectLanguage("index.js")).toBe("javascript");
    expect(detectLanguage("app.jsx")).toBe("javascript");
  });

  it("detects Python", () => {
    expect(detectLanguage("main.py")).toBe("python");
  });

  it("detects Go", () => {
    expect(detectLanguage("main.go")).toBe("go");
  });

  it("detects Rust", () => {
    expect(detectLanguage("lib.rs")).toBe("rust");
  });

  it("returns null for unsupported extensions", () => {
    expect(detectLanguage("style.css")).toBeNull();
    expect(detectLanguage("data.json")).toBeNull();
  });
});

describe("SUPPORTED_EXTENSIONS", () => {
  it("includes all supported file extensions", () => {
    expect(SUPPORTED_EXTENSIONS).toContain(".ts");
    expect(SUPPORTED_EXTENSIONS).toContain(".py");
    expect(SUPPORTED_EXTENSIONS).toContain(".go");
    expect(SUPPORTED_EXTENSIONS).toContain(".rs");
  });
});
