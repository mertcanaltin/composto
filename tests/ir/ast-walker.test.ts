import { describe, it, expect } from "vitest";
import { astWalkIR } from "../../src/ir/ast-walker.js";

describe("astWalkIR", () => {
  describe("Tier 1 — structural declarations", () => {
    it("captures import statements", async () => {
      const code = 'import { useState, useEffect } from "react";';
      const ir = await astWalkIR(code, "app.ts");
      expect(ir).toContain("USE:");
      expect(ir).toContain("react");
    });

    it("captures import type statements", async () => {
      const code = 'import type { User } from "./types.js";';
      const ir = await astWalkIR(code, "app.ts");
      expect(ir).toContain("USE:");
    });

    it("captures exported function declarations", async () => {
      const code = "export function processData(input: string): string {\n  return input.trim();\n}";
      const ir = await astWalkIR(code, "utils.ts");
      expect(ir).toContain("OUT FN:processData");
    });

    it("captures async function declarations", async () => {
      const code = "export async function fetchUser(id: string) {\n  return await db.find(id);\n}";
      const ir = await astWalkIR(code, "api.ts");
      expect(ir).toContain("ASYNC");
      expect(ir).toContain("FN:fetchUser");
    });

    it("captures class declarations with generics", async () => {
      const code = "export class Repository<T extends Entity> {\n  find(id: string): T { return {} as T; }\n}";
      const ir = await astWalkIR(code, "repo.ts");
      expect(ir).toContain("CLASS:Repository<T extends Entity>");
    });

    it("captures interface declarations", async () => {
      const code = "export interface UserConfig {\n  name: string;\n  age: number;\n}";
      const ir = await astWalkIR(code, "types.ts");
      expect(ir).toContain("INTERFACE:UserConfig");
    });

    it("captures type alias declarations", async () => {
      const code = 'export type Status = "active" | "inactive";';
      const ir = await astWalkIR(code, "types.ts");
      expect(ir).toContain("TYPE:Status");
    });

    it("captures enum declarations", async () => {
      const code = "export enum Color {\n  Red,\n  Green,\n  Blue,\n}";
      const ir = await astWalkIR(code, "enums.ts");
      expect(ir).toContain("ENUM:Color");
    });

    it("returns null for unsupported languages", async () => {
      const ir = await astWalkIR("some code", "file.unknown");
      expect(ir).toBeNull();
    });
  });
});
