import { describe, it, expect } from "vitest";
import { extractFilePath } from "../../../src/cli/hook/extract.js";

describe("extractFilePath — cross-platform tool_input shape normalization", () => {
  it("extracts Claude Code Edit tool_input.file_path", () => {
    const fp = extractFilePath({
      tool_name: "Edit",
      tool_input: { file_path: "src/a.ts", old_string: "x", new_string: "y" },
    });
    expect(fp).toBe("src/a.ts");
  });

  it("extracts Claude Code Write tool_input.file_path", () => {
    const fp = extractFilePath({
      tool_name: "Write",
      tool_input: { file_path: "src/a.ts", content: "..." },
    });
    expect(fp).toBe("src/a.ts");
  });

  it("extracts Cursor Edit (same shape, different casing envelope)", () => {
    const fp = extractFilePath({
      tool_name: "Edit",
      tool_input: { file_path: "src/a.ts", old_string: "x", new_string: "y" },
    });
    expect(fp).toBe("src/a.ts");
  });

  it("extracts Gemini CLI edit_file args", () => {
    const fp = extractFilePath({
      tool_name: "edit_file",
      tool_input: { path: "src/a.ts", patch: "..." },
    });
    expect(fp).toBe("src/a.ts");
  });

  it("extracts Gemini CLI write_file args", () => {
    const fp = extractFilePath({
      tool_name: "write_file",
      tool_input: { path: "src/a.ts", content: "..." },
    });
    expect(fp).toBe("src/a.ts");
  });

  it("returns null for tools that don't touch a specific file", () => {
    expect(extractFilePath({ tool_name: "Bash", tool_input: { command: "ls" } })).toBeNull();
    expect(extractFilePath({ tool_name: "Grep", tool_input: { pattern: "foo" } })).toBeNull();
    expect(extractFilePath({ tool_name: "run_shell_command", tool_input: { cmd: "ls" } })).toBeNull();
  });

  it("returns null on malformed input", () => {
    expect(extractFilePath({})).toBeNull();
    expect(extractFilePath({ tool_name: "Edit" })).toBeNull();
    expect(extractFilePath({ tool_name: "Edit", tool_input: {} })).toBeNull();
  });
});
