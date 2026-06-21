import type { HealthAnnotation, DeltaContext } from "../types.js";
import { extractStructure } from "./structure.js";
import { fingerprintFile } from "./fingerprint.js";
import { annotateIR } from "./health.js";
import { astWalkIR } from "./ast-walker.js";
import { estimateTokens } from "../benchmark/tokenizer.js";

export function generateL0(code: string, filePath: string): string {
  const structure = extractStructure(code);
  const topLevel = structure.filter(
    (s) => s.indent === 0 && ["function-start", "type-start", "export"].includes(s.type)
  );

  const declarations = topLevel.map((s) => {
    const name = s.raw.match(
      /(?:function|class|interface|const|let|var|export\s+(?:default\s+)?(?:function|class|async\s+function))\s+(\w+)/
    )?.[1] ?? "unknown";
    return `  ${s.type === "type-start" ? "CLASS" : "FN"}:${name} L${s.line}`;
  });

  return `${filePath}\n${declarations.join("\n")}`;
}

export async function generateL1(code: string, filePath: string, health: HealthAnnotation | null): Promise<string> {
  const ir = await astWalkIR(code, filePath) ?? fingerprintFile(code, 0.75);
  // Fall back to the raw source when the IR is not a real win:
  //  - empty/whitespace-only: the engine found no structure (generated/data
  //    files). An empty IR is total information loss, not "100% compression".
  //  - not fewer TOKENS than the source. Token is the value metric, not chars:
  //    a char-shorter IR can still tokenize to more tokens (prefixes like
  //    USE:/FN: split into extra tokens).
  const irIsWin = ir.trim().length > 0 && estimateTokens(ir) < estimateTokens(code);
  const result = irIsWin ? ir : code;
  if (health) {
    return annotateIR(result, health);
  }
  return result;
}

export function generateL2(delta: DeltaContext, health: HealthAnnotation | null): string {
  const parts: string[] = [`FILE: ${delta.file}`];

  for (const hunk of delta.hunks) {
    if (hunk.functionScope) parts.push(`SCOPE: ${hunk.functionScope}`);
    parts.push(`CHANGED: ${hunk.changed.join("\n         ")}`);
    if (hunk.surroundingIR) parts.push(`CONTEXT: ${hunk.surroundingIR}`);
    if (hunk.blame) {
      parts.push(`BLAME: ${hunk.blame.author}, ${hunk.blame.date}, commit:"${hunk.blame.commitMessage}"`);
    }
  }

  const ir = parts.join("\n");
  if (health) return annotateIR(ir, health);
  return ir;
}

export function generateL3(code: string, startLine: number, endLine: number): string {
  const lines = code.split("\n");
  return lines.slice(startLine - 1, endLine).join("\n");
}

export type IRLayer = "L0" | "L1" | "L2" | "L3";

export async function generateLayer(
  layer: IRLayer,
  options: {
    code: string;
    filePath: string;
    health: HealthAnnotation | null;
    delta?: DeltaContext;
    lineRange?: { start: number; end: number };
  }
): Promise<string> {
  switch (layer) {
    case "L0":
      return generateL0(options.code, options.filePath);
    case "L1":
      return generateL1(options.code, options.filePath, options.health);
    case "L2":
      if (!options.delta) return generateL1(options.code, options.filePath, options.health);
      return generateL2(options.delta, options.health);
    case "L3":
      if (options.lineRange) {
        return generateL3(options.code, options.lineRange.start, options.lineRange.end);
      }
      return options.code;
  }
}
