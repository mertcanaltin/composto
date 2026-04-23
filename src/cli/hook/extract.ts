// Normalizes the target file path out of the wildly-varied tool_input
// shapes each platform emits in their PreToolUse / BeforeTool envelope.
// Returns null for tools that don't touch a specific file — the
// dispatcher uses null as "not our business, let the call through".

export type ToolInvocation = {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

const FILE_TOOLS: Record<string, string[]> = {
  Edit: ["file_path"],
  Write: ["file_path"],
  MultiEdit: ["file_path"],
  edit_file: ["path", "file_path"],
  write_file: ["path", "file_path"],
  replace: ["path", "file_path"],
};

export function extractFilePath(inv: ToolInvocation): string | null {
  const name = inv.tool_name;
  if (typeof name !== "string") return null;
  const candidates = FILE_TOOLS[name];
  if (!candidates) return null;
  const input = inv.tool_input;
  if (!input || typeof input !== "object") return null;
  for (const field of candidates) {
    const v = (input as Record<string, unknown>)[field];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
