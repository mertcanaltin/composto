import { describe, it, expect } from "vitest";
import { extractStructure, classifyLine } from "../../src/ir/structure.js";

describe("classifyLine", () => {
  it("classifies function declarations", () => {
    expect(classifyLine("function")).toBe("function-start");
    expect(classifyLine("async")).toBe("async");
    expect(classifyLine("export")).toBe("export");
  });

  it("classifies control flow", () => {
    expect(classifyLine("if")).toBe("branch");
    expect(classifyLine("else")).toBe("branch");
    expect(classifyLine("for")).toBe("loop");
    expect(classifyLine("while")).toBe("loop");
    expect(classifyLine("return")).toBe("exit");
  });

  it("classifies imports and assignments", () => {
    expect(classifyLine("import")).toBe("import");
    expect(classifyLine("const")).toBe("assignment");
    expect(classifyLine("let")).toBe("assignment");
  });

  it("classifies error handling", () => {
    expect(classifyLine("try")).toBe("error-handling");
    expect(classifyLine("catch")).toBe("error-handling");
  });

  it("returns unknown for unrecognized tokens", () => {
    expect(classifyLine("foo")).toBe("unknown");
    expect(classifyLine("myVariable")).toBe("unknown");
  });

  it("handles blank and comment lines", () => {
    expect(classifyLine("//")).toBe("comment");
    expect(classifyLine("/*")).toBe("comment");
    expect(classifyLine("#")).toBe("comment");
    expect(classifyLine("")).toBe("blank");
  });
});

describe("extractStructure", () => {
  it("extracts structure from TypeScript code", () => {
    const code = [
      'import { useState } from "react";',
      "",
      "export function UserProfile({ userId }) {",
      "  const [user, setUser] = useState(null);",
      "  if (loading) {",
      "    return null;",
      "  }",
      "  return user;",
      "}",
    ].join("\n");

    const result = extractStructure(code);

    expect(result).toHaveLength(9);
    expect(result[0]).toEqual({
      line: 1,
      indent: 0,
      type: "import",
      raw: 'import { useState } from "react";',
    });
    expect(result[2]).toEqual({
      line: 3,
      indent: 0,
      type: "export",
      raw: "export function UserProfile({ userId }) {",
    });
    expect(result[3].indent).toBe(2);
    expect(result[3].type).toBe("assignment");
    expect(result[4].type).toBe("branch");
    expect(result[4].indent).toBe(2);
    expect(result[5].type).toBe("exit");
    expect(result[5].indent).toBe(4);
  });

  it("handles empty input", () => {
    expect(extractStructure("")).toEqual([
      { line: 1, indent: -1, type: "blank", raw: "" },
    ]);
  });

  it("identifies function scope boundaries", () => {
    const code = [
      "function a() {",
      "  doStuff();",
      "}",
      "",
      "function b() {",
      "  doOther();",
      "}",
    ].join("\n");

    const result = extractStructure(code);
    expect(result[0].type).toBe("function-start");
    expect(result[0].indent).toBe(0);
    expect(result[4].type).toBe("function-start");
    expect(result[4].indent).toBe(0);
  });
});
