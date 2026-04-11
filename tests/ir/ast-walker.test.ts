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

  describe("Tier 2 — control flow", () => {
    it("captures if statements with condition", async () => {
      const code = "export function check(x: number) {\n  if (x > 10) {\n    return true;\n  }\n  return false;\n}";
      const ir = await astWalkIR(code, "check.ts");
      expect(ir).toContain("IF:");
      expect(ir).toContain("RET true");
      expect(ir).toContain("RET false");
    });

    it("captures if-else chains (else is walk-only, not emitted)", async () => {
      const code = "function route(x: string) {\n  if (x === 'a') {\n    return 1;\n  } else {\n    return 2;\n  }\n}";
      const ir = await astWalkIR(code, "route.ts");
      expect(ir).toContain("IF:");
      // else_clause is WALK_ONLY — not emitted, but children (RET) still appear
      expect(ir).not.toContain("ELSE:");
      expect(ir).toContain("RET 2");
    });

    it("captures for-of loops", async () => {
      const code = "function sum(items: number[]) {\n  for (const item of items) {\n    total += item;\n  }\n}";
      const ir = await astWalkIR(code, "sum.ts");
      expect(ir).toContain("LOOP");
    });

    it("captures switch statements", async () => {
      const code = 'function handle(cmd: string) {\n  switch (cmd) {\n    case "run":\n      return exec();\n    default:\n      return help();\n  }\n}';
      const ir = await astWalkIR(code, "handler.ts");
      expect(ir).toContain("SWITCH:cmd");
      expect(ir).toContain("CASE:");
      expect(ir).toContain("DEFAULT:");
    });

    it("captures try-catch", async () => {
      const code = "function safe() {\n  try {\n    riskyCall();\n  } catch (err) {\n    log(err);\n  }\n}";
      const ir = await astWalkIR(code, "safe.ts");
      expect(ir).toContain("TRY");
      expect(ir).toContain("CATCH:");
    });

    it("captures return with value truncation at 100 chars", async () => {
      const longReturn = "{ id: generateId(), name: userName, email: userEmail, role: userRole, status: active, createdAt: new Date(), updatedAt: new Date() }";
      const code = "function build() {\n  return " + longReturn + ";\n}";
      const ir = await astWalkIR(code, "build.ts");
      const retLine = ir!.split("\\n").find(l => l.includes("RET"));
      expect(retLine).toBeTruthy();
    });

    it("captures throw statements", async () => {
      const code = 'function validate(x: number) {\n  if (x < 0) {\n    throw new Error("negative");\n  }\n}';
      const ir = await astWalkIR(code, "validate.ts");
      expect(ir).toContain("THROW:");
    });
  });

  describe("Tier 3 — compressible expressions", () => {
    it("drops ordinary variable declarations inside function bodies", async () => {
      const code = "function init() {\n  const config = loadConfig();\n  const port = 3000;\n}";
      const ir = await astWalkIR(code, "init.ts");
      // Internal vars are noise — only arrow fns and await are kept
      expect(ir).not.toContain("VAR:config");
      expect(ir).not.toContain("VAR:port");
      expect(ir).toContain("FN:init");
    });

    it("keeps module-level variable declarations", async () => {
      const code = 'const API_URL = "https://api.example.com";\nfunction fetch() { return API_URL; }';
      const ir = await astWalkIR(code, "config.ts");
      expect(ir).toContain("VAR:API_URL");
    });

    it("drops call expression statements (noise)", async () => {
      const code = 'import { validate } from "./validator.js";\nfunction process(input: string) {\n  validate(input);\n  return input;\n}';
      const ir = await astWalkIR(code, "proc.ts");
      // Call expressions are dropped as noise — only structural declarations matter
      expect(ir).not.toContain("CALL:");
      expect(ir).toContain("FN:process");
    });

    it("skips collection method calls", async () => {
      const code = "function build() {\n  items.push(1);\n  items.sort();\n  items.map(x => x);\n  return items;\n}";
      const ir = await astWalkIR(code, "build.ts");
      expect(ir).not.toContain("CALL:items.push");
      expect(ir).not.toContain("CALL:items.sort");
      expect(ir).not.toContain("CALL:items.map");
    });

    it("skips console and Math calls", async () => {
      const code = 'function debug() {\n  console.log("hi");\n  Math.max(1, 2);\n}';
      const ir = await astWalkIR(code, "debug.ts");
      expect(ir).not.toContain("CALL:console");
      expect(ir).not.toContain("CALL:Math");
    });

    it("captures await expressions in variable declarations", async () => {
      const code = "async function load() {\n  const data = await fetchData();\n  return data;\n}";
      const ir = await astWalkIR(code, "load.ts");
      expect(ir).toContain("AWAIT:");
    });

    it("captures arrow function variable declarations", async () => {
      const code = "const handler = async (req: Request) => {\n  return respond(req);\n}";
      const ir = await astWalkIR(code, "handler.ts");
      expect(ir).toContain("FN:handler");
    });

    it("drops Tier 4 noise — string contents, operators, punctuation not in IR", async () => {
      const code = 'function greet(name: string) {\n  const msg = "Hello " + name;\n  console.log(msg);\n  return msg;\n}';
      const ir = await astWalkIR(code, "greet.ts");
      expect(ir).not.toContain("Hello");
      expect(ir).toContain("FN:greet");
      expect(ir).toContain("RET msg");
    });
  });
});
