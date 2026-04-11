import type { FingerprintResult } from "../types.js";

interface Pattern {
  match: RegExp;
  transform: (m: RegExpMatchArray) => string;
  confidence: number;
}

const PATTERNS: Pattern[] = [
  // import { x, y } from "module"
  {
    match: /^import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?\s*$/,
    transform: (m) => `USE:${m[2]}{${m[1].replace(/\s/g, "")}}`,
    confidence: 0.95,
  },
  // import x from "module"
  {
    match: /^import\s+(\w+)\s+from\s+["']([^"']+)["'];?\s*$/,
    transform: (m) => `USE:${m[2]}{${m[1]}}`,
    confidence: 0.95,
  },
  // const x = require("module")
  {
    match: /^(?:const|let|var)\s+(\w+)\s*=\s*require\(["']([^"']+)["']\);?\s*$/,
    transform: (m) => `USE:${m[2]}{${m[1]}}`,
    confidence: 0.95,
  },
  // export function name(params) {
  {
    match: /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*\S+\s*)?\{?\s*$/,
    transform: (m) => `OUT FN:${m[1]}(${m[2].replace(/\s/g, "")})`,
    confidence: 0.95,
  },
  // function name(params) {
  {
    match: /^(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*\S+\s*)?\{?\s*$/,
    transform: (m) => `FN:${m[1]}(${m[2].replace(/\s/g, "")})`,
    confidence: 0.95,
  },
  // export class Name extends Base {
  {
    match: /^export\s+class\s+(\w+)(?:\s+extends\s+(\w+))?\s*(?:implements\s+\S+\s*)?\{?\s*$/,
    transform: (m) => `OUT CLASS:${m[1]}${m[2] ? ` < ${m[2]}` : ""}`,
    confidence: 0.95,
  },
  // class Name extends Base {
  {
    match: /^class\s+(\w+)(?:\s+extends\s+(\w+))?\s*(?:implements\s+\S+\s*)?\{?\s*$/,
    transform: (m) => `CLASS:${m[1]}${m[2] ? ` < ${m[2]}` : ""}`,
    confidence: 0.95,
  },
  // if (cond) return expr;
  {
    match: /^if\s*\(([^)]+)\)\s*return\s+(.+);?\s*$/,
    transform: (m) => `IF:${m[1].trim()} -> RET ${m[2].trim().replace(/;$/, "")}`,
    confidence: 0.95,
  },
  // if (cond) {
  {
    match: /^if\s*\(([^)]+)\)\s*\{?\s*$/,
    transform: (m) => `IF:${m[1].trim()}`,
    confidence: 0.9,
  },
  // for (... of/in ...) {
  {
    match: /^for\s*\((?:const|let|var)\s+(\w+)\s+(?:of|in)\s+(\w+)\)\s*\{?\s*$/,
    transform: (m) => `LOOP:${m[2]} -> ${m[1]}`,
    confidence: 0.9,
  },
  // return expr
  {
    match: /^return\s+(.+);?\s*$/,
    transform: (m) => `RET ${m[1].trim().replace(/;$/, "")}`,
    confidence: 0.95,
  },
  // return;
  {
    match: /^return;?\s*$/,
    transform: () => "RET",
    confidence: 0.95,
  },
  // try {
  {
    match: /^try\s*\{\s*$/,
    transform: () => "TRY:",
    confidence: 0.9,
  },
  // catch (e) {
  {
    match: /^(?:\}\s*)?catch\s*\((\w+)\)\s*\{?\s*$/,
    transform: (m) => `CATCH:${m[1]}`,
    confidence: 0.9,
  },
  // const x = await expr;
  {
    match: /^(?:export\s+)?(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*await\s+(.+);?\s*$/,
    transform: (m) => {
      const prefix = m[0].startsWith("export") ? "OUT " : "";
      return `${prefix}AWAIT:VAR:${m[1]} = ${m[2].replace(/;$/, "").trim()}`;
    },
    confidence: 0.85,
  },
  // export const name = async (params) => {  OR  export const name = (params) => expr;
  {
    match: /^export\s+(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)\s*=>\s*(.*)$/,
    transform: (m) => {
      const asyncPrefix = m[2] ? "ASYNC " : "";
      const body = m[4].replace(/[{;]\s*$/, "").trim();
      return `OUT ${asyncPrefix}FN:${m[1]} = (${m[3].trim()}) => ${body || "{"}`;
    },
    confidence: 0.9,
  },
  // const name = async (params) => {  OR  const name = (params) => expr;
  {
    match: /^(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)\s*=>\s*(.*)$/,
    transform: (m) => {
      const asyncPrefix = m[2] ? "ASYNC " : "";
      const body = m[4].replace(/[{;]\s*$/, "").trim();
      return `${asyncPrefix}FN:${m[1]} = (${m[3].trim()}) => ${body || "{"}`;
    },
    confidence: 0.9,
  },
  // get name() {
  {
    match: /^\s*get\s+(\w+)\s*\(\)\s*(?::\s*\S+\s*)?\{?\s*$/,
    transform: (m) => `GET:${m[1]}()`,
    confidence: 0.9,
  },
  // set name(value) {
  {
    match: /^\s*set\s+(\w+)\s*\(([^)]*)\)\s*\{?\s*$/,
    transform: (m) => `SET:${m[1]}(${m[2].replace(/\s/g, "")})`,
    confidence: 0.9,
  },
  // methodName(params) {  (inside class body, indented)
  {
    match: /^\s*(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*\S+\s*)?\{\s*$/,
    transform: (m) => {
      const name = m[1];
      if (["if", "for", "while", "switch", "catch", "function"].includes(name)) return `${name}`;
      return `METHOD:${name}(${m[2].replace(/\s/g, "")})`;
    },
    confidence: 0.9,
  },
  // const [a, b] = expr (destructuring — before regular assignment)
  {
    match: /^(?:const|let|var)\s+\[([^\]]+)\]\s*=\s*(.+);?\s*$/,
    transform: (m) => `VAR:[${m[1].replace(/\s/g, "")}] = ${m[2].replace(/;$/, "").trim()}`,
    confidence: 0.65,
  },
  // const name = value;
  {
    match: /^(?:export\s+)?(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*(.+);?\s*$/,
    transform: (m) => {
      const prefix = m[0].startsWith("export") ? "OUT " : "";
      return `${prefix}VAR:${m[1]} = ${m[2].replace(/;$/, "").trim()}`;
    },
    confidence: 0.85,
  },
];

export function fingerprintLine(line: string): FingerprintResult {
  const trimmed = line.trim();

  if (trimmed === "" || trimmed === "{" || trimmed === "}" || trimmed === "});" || trimmed === ");") {
    return { type: "fingerprint", ir: "", confidence: 1.0 };
  }

  if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
    return { type: "fingerprint", ir: "", confidence: 1.0 };
  }

  for (const pattern of PATTERNS) {
    const match = trimmed.match(pattern.match);
    if (match) {
      const ir = pattern.transform(match);
      if (pattern.confidence > 0.9) {
        return { type: "fingerprint", ir, confidence: pattern.confidence };
      }
      return {
        type: "fingerprint+hint",
        ir,
        hint: trimmed,
        confidence: pattern.confidence,
      };
    }
  }

  return { type: "raw", ir: trimmed, confidence: 0.3 };
}

export function fingerprintFile(code: string, confidenceThreshold: number = 0.6): string {
  const lines = code.split("\n");
  const irLines: string[] = [];

  for (const line of lines) {
    const indent = line.search(/\S/);
    const indentStr = indent > 0 ? "  ".repeat(Math.floor(indent / 2)) : "";
    const result = fingerprintLine(line);

    if (result.ir === "") continue; // skip blanks, comments, braces

    if (result.confidence >= confidenceThreshold) {
      irLines.push(`${indentStr}${result.ir}`);
    } else {
      irLines.push(`${indentStr}${result.ir}`);
    }
  }

  return irLines.join("\n");
}
