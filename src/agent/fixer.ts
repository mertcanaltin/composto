import type { Finding } from "../types.js";

export function applyAutoFix(code: string, line: number, fixType: string): string | null {
  switch (fixType) {
    case "remove-line": {
      const lines = code.split("\n");
      lines.splice(line - 1, 1);
      return lines.join("\n");
    }
    default:
      return null;
  }
}

export function formatFixerPrompt(finding: Finding, ir: string): string {
  return [
    `File: ${finding.file}`,
    finding.line ? `Line: ${finding.line}` : "",
    `Issue: ${finding.message}`,
    `Severity: ${finding.severity}`,
    "",
    "Code context (Health-Aware IR):",
    ir,
    "",
    "Provide a minimal fix. Output only the corrected code for the affected lines.",
    "If the code is in a fragile area (indicated by health annotations like HOT, FIX%, COV), suggest a test.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function callFixer(prompt: string, apiKey: string): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text ?? "";
}
