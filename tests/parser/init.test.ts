import { describe, it, expect } from "vitest";
import { getParser } from "../../src/parser/init.js";

describe("getParser", () => {
  it("returns a parser for typescript", async () => {
    const { parser, language } = await getParser("typescript");
    expect(parser).toBeDefined();
    expect(language).toBeDefined();
    const tree = parser.parse("const x = 1;");
    expect(tree.rootNode.type).toBe("program");
  });

  it("returns a parser for python", async () => {
    const { parser } = await getParser("python");
    expect(parser).toBeDefined();
  });

  it("returns a parser for go", async () => {
    const { parser } = await getParser("go");
    expect(parser).toBeDefined();
  });

  it("returns a parser for rust", async () => {
    const { parser } = await getParser("rust");
    expect(parser).toBeDefined();
  });

  it("reuses cached parser for same language", async () => {
    const p1 = await getParser("typescript");
    const p2 = await getParser("typescript");
    expect(p1).toBe(p2);
  });
});
