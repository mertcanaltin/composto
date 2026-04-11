import { generateLayer } from "../ir/layers.js";
import { estimateTokens } from "./tokenizer.js";

export interface BenchmarkPrompt {
  id: string;
  label: string;
  template: string;
}

export const BENCHMARK_PROMPTS: BenchmarkPrompt[] = [
  {
    id: "understand",
    label: "Comprehension",
    template: "What does this code do? List the main functions/classes and briefly describe each one's purpose and dependencies.\n\n{code}",
  },
  {
    id: "fix-bug",
    label: "Bug Detection",
    template: "Review this code for potential bugs, edge cases, or error handling issues. List any problems you find.\n\n{code}",
  },
  {
    id: "review",
    label: "Code Review",
    template: "Do a code review of this file. Comment on code quality, naming, structure, and any improvements you'd suggest.\n\n{code}",
  },
  {
    id: "explain",
    label: "Explanation",
    template: "Explain this code to a developer who is new to the codebase. Focus on how the pieces fit together.\n\n{code}",
  },
  {
    id: "refactor",
    label: "Refactoring",
    template: "How would you refactor this code for better maintainability and testability? Suggest specific changes.\n\n{code}",
  },
];

interface QualityResult {
  label: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  responseTimeMs: number;
  response: string;
}

export interface QualityBenchmark {
  file: string;
  raw: QualityResult;
  ir: QualityResult;
  savedPercent: number;
}

async function askClaude(context: string, prompt: string, apiKey: string): Promise<QualityResult & { usageInput: number; usageOutput: number }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const userMessage = prompt.replace("{code}", context);
  const estimatedInput = estimateTokens(userMessage);

  const start = performance.now();
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: userMessage }],
  });
  const elapsed = performance.now() - start;

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock?.text ?? "";

  return {
    label: "",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    responseTimeMs: elapsed,
    response: text,
    usageInput: response.usage.input_tokens,
    usageOutput: response.usage.output_tokens,
  };
}

export async function runQualityBenchmark(
  code: string,
  filePath: string,
  apiKey: string,
  promptId: string = "understand"
): Promise<QualityBenchmark> {
  const irL1 = await generateLayer("L1", { code, filePath, health: null });
  const prompt = BENCHMARK_PROMPTS.find(p => p.id === promptId) ?? BENCHMARK_PROMPTS[0];

  // Run both in parallel
  const [rawResult, irResult] = await Promise.all([
    askClaude(code, prompt.template, apiKey),
    askClaude(irL1, prompt.template, apiKey),
  ]);

  rawResult.label = "Raw Code";
  irResult.label = "IR (L1)";

  const savedPercent = rawResult.totalTokens > 0
    ? ((rawResult.totalTokens - irResult.totalTokens) / rawResult.totalTokens) * 100
    : 0;

  return { file: filePath, raw: rawResult, ir: irResult, savedPercent };
}
