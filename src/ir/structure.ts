import type { LineType, StructureLine, StructureMap } from "../types.js";

const CLASSIFIERS: [RegExp, LineType][] = [
  [/^(function|def|fn|func)\b/, "function-start"],
  [/^(class|struct|interface)\b/, "type-start"],
  [/^(if|else|elif|switch|match|case)\b/, "branch"],
  [/^(for|while|loop|do)\b/, "loop"],
  [/^(return|yield)\b/, "exit"],
  [/^(import|require|use|from)\b/, "import"],
  [/^(export|pub|public)\b/, "export"],
  [/^(const|let|var|val|mut)\b/, "assignment"],
  [/^(try|catch|except|finally)\b/, "error-handling"],
  [/^(async|await)\b/, "async"],
  [/^(\/\/|\/\*|#)/, "comment"],
];

export function classifyLine(firstToken: string): LineType {
  if (firstToken === "") return "blank";
  for (const [pattern, type] of CLASSIFIERS) {
    if (pattern.test(firstToken)) return type;
  }
  return "unknown";
}

export function extractStructure(code: string): StructureMap {
  const lines = code.split("\n");
  return lines.map((raw, i) => {
    const indent = raw.search(/\S/);
    const trimmed = raw.trim();
    const firstToken = trimmed.split(/[\s({<]/)[0];
    const type = classifyLine(firstToken);

    return {
      line: i + 1,
      indent: indent === -1 ? -1 : indent,
      type,
      raw,
    };
  });
}
