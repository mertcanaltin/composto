import { generateL1 } from "../../ir/layers.js";
import { estimateTokens } from "../../benchmark/tokenizer.js";
import { detectLanguage } from "../../parser/languages.js";

/**
 * Decide whether a Read tool result should be replaced with compressed IR
 * (PostToolUse `updatedToolOutput`). This is the safety core of the auto-save
 * hook: it must NEVER replace output in a way that silently breaks an edit, so
 * it is deliberately conservative.
 *
 * Skip (leave raw) when:
 *  - the Read was ranged (offset/limit present) — a targeted read signals
 *    precision/edit intent; the agent wants exact lines.
 *  - the file is not a supported code language (json/lock/markdown/etc).
 *  - the content is below a worth-it token threshold.
 *  - generateL1 returns the raw source (IR not a strict token win).
 *
 * When it does compress, it prepends an escape-hatch marker telling the agent
 * how to recover exact source (Read with a range, which this hook leaves raw).
 */

const MIN_TOKENS = 1200;

export interface ReadCompressionInput {
  filePath: string;
  content: string;
  hasRange: boolean;
}

export interface ReadCompressionResult {
  compress: boolean;
  output: string;
  rawTokens: number;
  outputTokens: number;
  savedTokens: number;
  reason: string;
}

export async function decideReadCompression(
  input: ReadCompressionInput
): Promise<ReadCompressionResult> {
  const rawTokens = estimateTokens(input.content);
  const noop = (reason: string): ReadCompressionResult => ({
    compress: false,
    output: input.content,
    rawTokens,
    outputTokens: rawTokens,
    savedTokens: 0,
    reason,
  });

  if (input.hasRange) return noop("ranged read (precision/edit intent)");
  if (!detectLanguage(input.filePath)) return noop("unsupported language");
  if (rawTokens < MIN_TOKENS) return noop("below token threshold");

  const ir = await generateL1(input.content, input.filePath, null);
  if (ir === input.content) return noop("IR not a token win");

  const marker =
    `[composto] Structural IR — compressed from ${rawTokens} tokens. ` +
    `For exact source (e.g. to edit), Read this file again with an offset/limit range.\n\n`;
  const output = marker + ir;
  const outputTokens = estimateTokens(output);

  // Guard: if the marker pushed it back over the raw size, don't bother.
  if (outputTokens >= rawTokens) return noop("net not a win after marker");

  return {
    compress: true,
    output,
    rawTokens,
    outputTokens,
    savedTokens: rawTokens - outputTokens,
    reason: "compressed",
  };
}
