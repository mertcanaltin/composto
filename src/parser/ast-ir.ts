import { Query } from "web-tree-sitter";
import { getParser } from "./init.js";
import { detectLanguage } from "./languages.js";
import { getQueries } from "./queries.js";
import type { SyntaxNode } from "web-tree-sitter";

function extractCondition(node: SyntaxNode): string {
  // Condition is typically the parenthesized_expression or first meaningful child
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === "parenthesized_expression" || child.type === "condition") {
      const text = child.text.replace(/[()]/g, "").trim();
      return text.length > 60 ? text.slice(0, 57) + "..." : text;
    }
  }
  // Fallback: second child (after keyword)
  const cond = node.child(1);
  if (cond) {
    const text = cond.text.replace(/[()]/g, "").trim();
    return text.length > 60 ? text.slice(0, 57) + "..." : text;
  }
  return "...";
}

function summarizeFnBody(fnNode: SyntaxNode): string[] {
  const lines: string[] = [];
  const baseCol = fnNode.startPosition.column;

  function walk(node: SyntaxNode) {
    const indent = "  " + "  ".repeat(Math.max(0, Math.floor((node.startPosition.column - baseCol) / 2)));

    switch (node.type) {
      case "if_statement":
      case "if_expression":
        lines.push(`${indent}IF:${extractCondition(node)}`);
        break;
      case "for_statement":
      case "for_in_statement":
      case "for_expression":
        lines.push(`${indent}LOOP`);
        break;
      case "while_statement":
        lines.push(`${indent}WHILE:${extractCondition(node)}`);
        break;
      case "return_statement":
      case "return_expression": {
        const retVal = node.childCount > 1 ? node.child(1)?.text ?? "" : "";
        const short = retVal.length > 100 ? retVal.slice(0, 97) + "..." : retVal;
        lines.push(`${indent}RET ${short}`.trimEnd());
        break;
      }
      case "try_statement":
        lines.push(`${indent}TRY`);
        break;
      case "match_expression":
        lines.push(`${indent}MATCH`);
        break;
      case "call_expression": {
        // Only capture top-level calls (direct children of expression_statement)
        // Skip nested calls inside arguments, chains, etc.
        if (node.parent?.type !== "expression_statement") break;
        const callee = node.child(0)?.text ?? "";
        const skip = ["console.", "Math.", "Object.", "Array.", "JSON.", "String.", "Number.", "Promise."];
        if (callee && !skip.some(s => callee.startsWith(s))) {
          const shortCallee = callee.length > 40 ? callee.slice(0, 37) + "..." : callee;
          lines.push(`${indent}CALL:${shortCallee}`);
        }
        break;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i)!);
    }
  }

  // Find the body block
  const body = fnNode.childForFieldName("body")
    ?? fnNode.descendantsOfType("statement_block")[0]
    ?? fnNode.descendantsOfType("block")[0];

  if (body) walk(body);
  return lines;
}

function safeQuery(lang: any, pattern: string, root: SyntaxNode): { captures: { name: string; node: SyntaxNode }[] }[] {
  if (!pattern) return [];
  try {
    const q = new Query(lang, pattern);
    return q.matches(root);
  } catch {
    return [];
  }
}

export async function generateAstIR(code: string, filePath: string): Promise<string | null> {
  const lang = detectLanguage(filePath);
  if (!lang) return null;

  const { parser, language } = await getParser(lang);
  const tree = parser.parse(code);
  const queries = getQueries(lang);
  const root = tree.rootNode;

  const irParts: string[] = [];

  // Imports
  for (const match of safeQuery(language, queries.imports, root)) {
    const importNode = match.captures.find(c => c.name === "import");
    if (importNode) {
      const text = importNode.node.text.replace(/\n/g, " ").trim();
      const short = text.length > 80 ? text.slice(0, 77) + "..." : text;
      irParts.push(`USE:${short}`);
    }
  }

  // Classes / Types / Structs
  for (const match of safeQuery(language, queries.classes, root)) {
    const nameCapture = match.captures.find(c => c.name === "name");
    const typeCapture = match.captures.find(c => ["class", "interface", "type", "struct", "enum", "trait", "impl"].includes(c.name));
    if (nameCapture && typeCapture) {
      const label = typeCapture.name.toUpperCase();
      // Look for type_parameters child on the declaration node
      let typeParams = "";
      for (let i = 0; i < typeCapture.node.childCount; i++) {
        const child = typeCapture.node.child(i)!;
        if (child.type === "type_parameters") {
          typeParams = child.text;
          break;
        }
      }
      const isExported = typeCapture.node.parent?.type === "export_statement";
      const exportPrefix = isExported ? "OUT " : "";
      irParts.push(`${exportPrefix}${label}:${nameCapture.node.text}${typeParams}`);
    }
  }

  // Functions
  for (const match of safeQuery(language, queries.functions, root)) {
    const nameCapture = match.captures.find(c => c.name === "name");
    const fnCapture = match.captures.find(c => c.name === "fn");
    if (nameCapture && fnCapture) {
      // Check if this function is inside an export_statement
      const isExported = fnCapture.node.parent?.type === "export_statement";
      const prefix = isExported ? "OUT " : "";
      const params = fnCapture.node.childForFieldName("parameters")?.text ?? "()";
      const bodyLines = summarizeFnBody(fnCapture.node);
      const fnText = fnCapture.node.text;
      const asyncPrefix = fnText.trimStart().startsWith("async") ? "ASYNC " : "";
      const fnLine = `${prefix}${asyncPrefix}FN:${nameCapture.node.text}${params}`;
      if (bodyLines.length > 0) {
        irParts.push(`${fnLine}\n${bodyLines.join("\n")}`);
      } else {
        irParts.push(fnLine);
      }
    }
  }

  // Exported functions (via export_statement wrapping)
  for (const match of safeQuery(language, queries.exports, root)) {
    const exportNode = match.captures.find(c => c.name === "export");
    if (!exportNode) continue;
    const decl = exportNode.node.childForFieldName("declaration");
    if (decl && decl.type === "function_declaration") {
      // Already handled above via isExported check
      continue;
    }
  }

  if (irParts.length === 0) return null;
  return irParts.join("\n");
}
