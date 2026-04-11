import type { SyntaxNode } from "web-tree-sitter";
import { getParser } from "../parser/init.js";
import { detectLanguage } from "../parser/languages.js";

export type Tier = "T1_KEEP" | "T2_CONTROL" | "T3_COMPRESS" | "T4_DROP" | "WALK_ONLY";

const TIER_MAP: Record<string, Tier> = {
  // Tier 1 — structural declarations
  import_statement: "T1_KEEP",
  function_declaration: "T1_KEEP",
  class_declaration: "T1_KEEP",
  interface_declaration: "T1_KEEP",
  type_alias_declaration: "T1_KEEP",
  enum_declaration: "T1_KEEP",

  // Tier 2 — control flow
  if_statement: "T2_CONTROL",
  else_clause: "T2_CONTROL",
  for_statement: "T2_CONTROL",
  for_in_statement: "T2_CONTROL",
  while_statement: "T2_CONTROL",
  do_statement: "T2_CONTROL",
  switch_statement: "T2_CONTROL",
  switch_case: "T2_CONTROL",
  switch_default: "T2_CONTROL",
  return_statement: "T2_CONTROL",
  throw_statement: "T2_CONTROL",
  try_statement: "T2_CONTROL",
  catch_clause: "T2_CONTROL",

  // Walk-only — containers that need traversal but no emission
  program: "WALK_ONLY",
  statement_block: "WALK_ONLY",
  class_body: "WALK_ONLY",
  switch_body: "WALK_ONLY",
  export_statement: "WALK_ONLY",
};

function tierOf(nodeType: string): Tier {
  return TIER_MAP[nodeType] ?? "T4_DROP";
}

export function collapseText(text: string, maxLen: number): string {
  const collapsed = text.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  if (collapsed.length <= maxLen) return collapsed;
  return collapsed.slice(0, maxLen - 3) + "...";
}

export function getTypeParams(node: SyntaxNode): string {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === "type_parameters") {
      return child.text;
    }
  }
  return "";
}

export function isExported(node: SyntaxNode): boolean {
  return node.parent?.type === "export_statement";
}

export function isAsync(node: SyntaxNode): boolean {
  return node.text.trimStart().startsWith("async");
}

function extractCondition(node: SyntaxNode): string {
  const condNode = node.childForFieldName("condition")
    ?? (() => {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)!;
        if (c.type === "parenthesized_expression") return c;
      }
      return null;
    })();
  if (!condNode) return "...";
  const text = condNode.text.replace(/^\(/, "").replace(/\)$/, "").trim();
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}

function emitTier2(node: SyntaxNode): string | null {
  switch (node.type) {
    case "if_statement": {
      const cond = extractCondition(node);
      return `IF:${cond}`;
    }
    case "else_clause":
      return "ELSE:";
    case "for_statement":
    case "for_in_statement":
      return "LOOP";
    case "while_statement": {
      const cond = extractCondition(node);
      return `WHILE:${cond}`;
    }
    case "do_statement": {
      const cond = extractCondition(node);
      return `WHILE:${cond}`;
    }
    case "switch_statement": {
      const expr = node.childForFieldName("value")
        ?? node.childForFieldName("condition")
        ?? (() => {
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i)!;
            if (c.type === "parenthesized_expression") return c;
          }
          return null;
        })();
      const text = expr ? expr.text.replace(/^\(/, "").replace(/\)$/, "").trim() : "...";
      return `SWITCH:${text.length > 60 ? text.slice(0, 57) + "..." : text}`;
    }
    case "switch_case": {
      // Find the case value — first non-keyword child
      let value: string | null = null;
      const valNode = node.childForFieldName("value");
      if (valNode) {
        value = valNode.text;
      } else {
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)!;
          if (c.type !== "case" && c.type !== ":" && c.childCount === 0 && c.text === "case") continue;
          if (c.type !== "case" && c.text !== "case" && c.text !== ":") {
            value = c.text;
            break;
          }
        }
      }
      return `CASE:${value ?? "..."}`;
    }
    case "switch_default":
      return "DEFAULT:";
    case "return_statement": {
      // Get return value: everything after "return" keyword
      let retText = "";
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)!;
        if (c.text !== "return" && c.text !== ";") {
          retText += (retText ? " " : "") + c.text;
        }
      }
      retText = retText.trim();
      if (!retText) return "RET";
      return `RET ${retText.length > 100 ? retText.slice(0, 97) + "..." : retText}`;
    }
    case "throw_statement": {
      let throwText = "";
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)!;
        if (c.text !== "throw" && c.text !== ";") {
          throwText += (throwText ? " " : "") + c.text;
        }
      }
      throwText = throwText.trim();
      return `THROW:${throwText.length > 60 ? throwText.slice(0, 57) + "..." : throwText}`;
    }
    case "try_statement":
      return "TRY";
    case "catch_clause": {
      const param = node.childForFieldName("parameter");
      const paramText = param ? param.text : "...";
      return `CATCH:${paramText}`;
    }
    default:
      return null;
  }
}

function emitTier1(node: SyntaxNode): string | null {
  const exported = isExported(node);
  const outPrefix = exported ? "OUT " : "";

  switch (node.type) {
    case "import_statement": {
      const text = collapseText(node.text, 80);
      return `USE:${text}`;
    }

    case "function_declaration": {
      const name = node.childForFieldName("name")?.text ?? "anonymous";
      const rawParams = node.childForFieldName("parameters")?.text ?? "()";
      const params = collapseText(rawParams, 60);
      const asyncPrefix = isAsync(node) ? "ASYNC " : "";
      return `${outPrefix}${asyncPrefix}FN:${name}${params}`;
    }

    case "class_declaration": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      const typeParams = getTypeParams(node);
      return `${outPrefix}CLASS:${name}${typeParams}`;
    }

    case "interface_declaration": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      const typeParams = getTypeParams(node);
      return `${outPrefix}INTERFACE:${name}${typeParams}`;
    }

    case "type_alias_declaration": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      return `${outPrefix}TYPE:${name}`;
    }

    case "enum_declaration": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      return `${outPrefix}ENUM:${name}`;
    }

    default:
      return null;
  }
}

function walkNode(node: SyntaxNode, depth: number, lines: string[]): void {
  const tier = tierOf(node.type);

  switch (tier) {
    case "T1_KEEP": {
      const ir = emitTier1(node);
      if (ir) lines.push(ir);
      // Walk into children for nested declarations (e.g., class methods)
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)!;
        const childType = child.type;
        if (
          childType === "statement_block" ||
          childType === "class_body"
        ) {
          walkNode(child, depth + 1, lines);
        }
      }
      break;
    }

    case "T2_CONTROL": {
      const line = emitTier2(node);
      const indent = "  ".repeat(depth);
      if (line) lines.push(indent + line);
      for (let i = 0; i < node.childCount; i++) {
        walkNode(node.child(i)!, depth + 1, lines);
      }
      break;
    }

    case "WALK_ONLY": {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)!;
        // For export_statement, skip keyword children like "export", "default"
        if (node.type === "export_statement") {
          if (child.type === "export" || child.type === "default" || child.text === "export" || child.text === "default") {
            if (child.childCount === 0 && (child.text === "export" || child.text === "default")) {
              continue;
            }
          }
        }
        walkNode(child, depth + 1, lines);
      }
      break;
    }

    case "T4_DROP":
    default:
      // Skip entirely
      break;
  }
}

export async function astWalkIR(code: string, filePath: string): Promise<string | null> {
  const lang = detectLanguage(filePath);
  if (!lang) return null;

  const { parser } = await getParser(lang);
  const tree = parser.parse(code);
  const root = tree.rootNode;

  const lines: string[] = [];
  walkNode(root, 0, lines);

  if (lines.length === 0) return null;
  return lines.join("\n");
}
