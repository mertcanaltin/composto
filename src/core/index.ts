/**
 * @composto/core — the stable embedding API for the Composto engine.
 *
 * Use this to build token-efficient context inside your own agent loop, compress
 * LLM requests in-flight, or generate structural IR — without the CLI. This is
 * the public surface; everything else under src/ is internal and may change.
 *
 *   import { generateIR, buildContext, compressMessages, estimateTokens } from "composto-ai/core";
 */
import { generateLayer, type IRLayer } from "../ir/layers.js";
import { packContext, resolveTarget, type FileInput, type PackResult } from "../context/packer.js";
import { estimateTokens } from "../benchmark/tokenizer.js";

export { estimateTokens, resolveTarget };
export {
  compressMessages,
  compressRequestBody,
  compressFencedBlocks,
  type CompressionStats,
} from "../proxy/compress-context.js";
export type { IRLayer, PackResult };

export interface SourceFile {
  path: string;
  code: string;
}

/**
 * Compress one file to Composto IR.
 * Layers: L0 = structure map (~names only), L1 = full IR (default),
 * L2 = delta, L3 = raw. L1 falls back to raw automatically when IR is not a
 * strict token win, so it is never lossy-without-benefit.
 */
export async function generateIR(
  code: string,
  filePath: string,
  layer: IRLayer = "L1",
): Promise<string> {
  return generateLayer(layer, { code, filePath, health: null });
}

/**
 * Pack a set of files into a token budget. The proven hybrid: a `target`
 * file (or hotspots) come back as detailed/raw context, the rest as compressed
 * IR — maximizing information per token. Returns entries + total token count.
 */
export async function buildContext(
  files: SourceFile[],
  opts: { budget?: number; target?: string } = {},
): Promise<PackResult> {
  const inputs: FileInput[] = files.map((f) => ({
    path: f.path,
    code: f.code,
    rawTokens: estimateTokens(f.code),
  }));
  return packContext(inputs, {
    budget: opts.budget ?? 4000,
    hotspots: [],
    target: opts.target,
  });
}
