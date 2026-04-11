import { describe, it, expect } from "vitest";
import { fingerprintLine, fingerprintFile } from "../../src/ir/fingerprint.js";

describe("fingerprintLine", () => {
  it("fingerprints import statements with high confidence", () => {
    const result = fingerprintLine('import { useState, useEffect } from "react";');
    expect(result.type).toBe("fingerprint");
    expect(result.ir).toBe("USE:react{useState,useEffect}");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("fingerprints require statements", () => {
    const result = fingerprintLine('const express = require("express");');
    expect(result.type).toBe("fingerprint");
    expect(result.ir).toBe("USE:express{express}");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("fingerprints function declarations", () => {
    const result = fingerprintLine("export function handleLogin(req, res) {");
    expect(result.type).toBe("fingerprint");
    expect(result.ir).toBe("OUT FN:handleLogin(req,res)");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("fingerprints simple variable assignments", () => {
    const result = fingerprintLine("const count = 0;");
    expect(result.ir).toContain("VAR:count = 0");
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it("fingerprints if-return statements", () => {
    const result = fingerprintLine("if (loading) return <Spinner />;");
    expect(result.type).toBe("fingerprint");
    expect(result.ir).toBe("IF:loading -> RET <Spinner />");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("fingerprints class declarations", () => {
    const result = fingerprintLine("export class UserService extends BaseService {");
    expect(result.type).toBe("fingerprint");
    expect(result.ir).toBe("OUT CLASS:UserService < BaseService");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("returns raw for unrecognized lines", () => {
    const result = fingerprintLine("  someComplexExpression.chain().map(x => x.y)");
    expect(result.type).toBe("raw");
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("fingerprints destructuring assignments", () => {
    const result = fingerprintLine("const [user, setUser] = useState(null);");
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.ir).toContain("VAR:");
  });

  it("skips blank lines and braces", () => {
    expect(fingerprintLine("").ir).toBe("");
    expect(fingerprintLine("{").ir).toBe("");
    expect(fingerprintLine("}").ir).toBe("");
  });

  it("skips comments", () => {
    expect(fingerprintLine("// this is a comment").ir).toBe("");
    expect(fingerprintLine("/* block comment */").ir).toBe("");
  });

  it("fingerprints named arrow functions", () => {
    const result = fingerprintLine("const fetchUser = (id) => {");
    expect(result.ir).toBe("FN:fetchUser = (id) => {");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("fingerprints exported arrow functions", () => {
    const result = fingerprintLine("export const handler = async (req, res) => {");
    expect(result.ir).toBe("OUT ASYNC FN:handler = (req, res) => {");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("fingerprints single-line arrow functions", () => {
    const result = fingerprintLine("const double = (x) => x * 2;");
    expect(result.ir).toBe("FN:double = (x) => x * 2");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("fingerprints method definitions", () => {
    const result = fingerprintLine("  handleClick(event) {");
    expect(result.ir).toBe("METHOD:handleClick(event)");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("fingerprints getter definitions", () => {
    const result = fingerprintLine("  get fullName() {");
    expect(result.ir).toBe("GET:fullName()");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("fingerprints setter definitions", () => {
    const result = fingerprintLine("  set fullName(value) {");
    expect(result.ir).toBe("SET:fullName(value)");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe("fingerprintFile", () => {
  it("fingerprints a complete file", () => {
    const code = [
      'import { useState } from "react";',
      "",
      "export function App() {",
      "  const count = 0;",
      "  return count;",
      "}",
    ].join("\n");

    const result = fingerprintFile(code, 0.6);
    expect(result).toContain("USE:react{useState}");
    expect(result).toContain("OUT FN:App()");
    expect(result).toContain("RET count");
  });

  it("preserves indentation in output", () => {
    const code = [
      "function test() {",
      "  const x = 1;",
      "  return x;",
      "}",
    ].join("\n");

    const result = fingerprintFile(code, 0.6);
    const lines = result.split("\n");
    expect(lines[0]).not.toMatch(/^\s/); // FN:test() — no indent
    expect(lines[1]).toMatch(/^\s/); // VAR:x — indented
  });
});
