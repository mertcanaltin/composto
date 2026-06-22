import { describe, it, expect } from "vitest";
import { resolveTarget, findTargetFile } from "../../src/context/packer.js";
import type { FileInput } from "../../src/context/packer.js";

function fi(path: string, code: string): FileInput {
  return { path, code, rawTokens: 0 };
}

describe("resolveTarget — robust target matching", () => {
  it("matches a kebab-case target to a PascalCase declaration", () => {
    const files = [fi("src/widgets/WidgetListV2.ts", "export class WidgetListV2 {}")];
    const r = resolveTarget(files, "widget-list-v2");
    expect(r?.path).toBe("src/widgets/WidgetListV2.ts");
    expect(r?.matchedBy).toBe("declaration");
  });

  it("matches by filename when there is no symbol declaration", () => {
    const files = [fi("src/fragments/widget-list-v2.ts", "const x = 1;\nregister(x);")];
    const r = resolveTarget(files, "widget-list-v2");
    expect(r?.path).toBe("src/fragments/widget-list-v2.ts");
    expect(r?.matchedBy).toBe("filename");
  });

  it("falls back to a string-literal / reference match (registration key)", () => {
    const files = [
      fi("src/registry.ts", `registerFragment("widget-list-v2", handler);`),
      fi("src/other.ts", "export const y = 2;"),
    ];
    const r = resolveTarget(files, "widget-list-v2");
    expect(r?.path).toBe("src/registry.ts");
    expect(r?.matchedBy).toBe("reference");
  });

  it("prefers a declaration over a filename over a reference", () => {
    const files = [
      fi("src/ref.ts", `use("widget-list-v2")`),
      fi("src/widget-list-v2.ts", "const a = 1;"),
      fi("src/decl.ts", "export class WidgetListV2 {}"),
    ];
    expect(resolveTarget(files, "widget-list-v2")?.matchedBy).toBe("declaration");
  });

  it("still matches an exact identifier (no regression)", () => {
    const files = [fi("a.ts", "export function validateToken() {}")];
    const r = resolveTarget(files, "validateToken");
    expect(r?.path).toBe("a.ts");
    expect(r?.matchedBy).toBe("declaration");
  });

  it("returns null when nothing matches", () => {
    const files = [fi("a.ts", "export const x = 1;")];
    expect(resolveTarget(files, "totallyAbsent")).toBeNull();
  });

  it("findTargetFile still returns just the path (back-compat)", () => {
    const files = [fi("a.ts", "export function validateToken() {}")];
    expect(findTargetFile(files, "validateToken")).toBe("a.ts");
    expect(findTargetFile(files, "totallyAbsent")).toBe(null);
  });
});
