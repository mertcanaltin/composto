import type { SyntaxNode } from "web-tree-sitter";
import { getParser } from "../parser/init.js";
import { detectLanguage } from "../parser/languages.js";

export type Tier = "T1_KEEP" | "T2_CONTROL" | "T3_COMPRESS" | "T4_DROP" | "WALK_ONLY";

const TIER_MAP: Record<string, Tier> = {
  // Tier 1 — structural declarations (JS/TS)
  import_statement: "T1_KEEP",
  function_declaration: "T1_KEEP",
  class_declaration: "T1_KEEP",
  interface_declaration: "T1_KEEP",
  type_alias_declaration: "T1_KEEP",
  enum_declaration: "T1_KEEP",

  // Tier 1 — Python
  function_definition: "T1_KEEP",
  class_definition: "T1_KEEP",
  import_from_statement: "T1_KEEP",
  decorated_definition: "T1_KEEP",

  // Tier 1 — Go
  function_item: "T1_KEEP",       // Rust
  method_declaration: "T1_KEEP",  // Go
  type_declaration: "T1_KEEP",    // Go
  import_declaration: "T1_KEEP",  // Go
  use_declaration: "T1_KEEP",     // Rust
  struct_item: "T1_KEEP",         // Rust
  enum_item: "T1_KEEP",           // Rust
  trait_item: "T1_KEEP",          // Rust
  impl_item: "T1_KEEP",           // Rust

  // Tier 2 — control flow (universal)
  if_statement: "T2_CONTROL",
  if_expression: "T2_CONTROL",    // Rust
  else_clause: "WALK_ONLY",
  elif_clause: "T2_CONTROL",      // Python
  for_statement: "T2_CONTROL",
  for_in_statement: "T2_CONTROL",
  for_expression: "T2_CONTROL",   // Rust
  while_statement: "T2_CONTROL",
  do_statement: "T2_CONTROL",
  switch_statement: "T2_CONTROL",
  switch_case: "T2_CONTROL",
  switch_default: "T2_CONTROL",
  match_expression: "T2_CONTROL", // Rust
  return_statement: "T2_CONTROL",
  return_expression: "T2_CONTROL", // Rust
  throw_statement: "T2_CONTROL",
  raise_statement: "T2_CONTROL",  // Python
  try_statement: "T2_CONTROL",
  catch_clause: "T2_CONTROL",
  except_clause: "T2_CONTROL",    // Python
  with_statement: "T2_CONTROL",   // Python
  defer_statement: "T2_CONTROL",  // Go

  // Tier 3 — compressible expressions
  lexical_declaration: "T3_COMPRESS",
  expression_statement: "T3_COMPRESS",
  assignment: "T3_COMPRESS",       // Python
  short_var_declaration: "T3_COMPRESS", // Go

  // Walk-only — containers
  program: "WALK_ONLY",
  module: "WALK_ONLY",            // Python
  statement_block: "WALK_ONLY",
  block: "WALK_ONLY",             // Python/Go/Rust
  class_body: "WALK_ONLY",        // JS/TS
  switch_body: "WALK_ONLY",
  export_statement: "WALK_ONLY",
  source_file: "WALK_ONLY",       // Go/Rust
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
      retText = retText.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
      if (!retText) return "RET";
      return `RET ${retText.length > 60 ? retText.slice(0, 57) + "..." : retText}`;
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
    // Python
    case "raise_statement": {
      const val = node.childCount > 1 ? node.child(1)?.text ?? "" : "";
      return `RAISE:${val.length > 50 ? val.slice(0, 47) + "..." : val}`;
    }
    case "except_clause":
      return "EXCEPT";
    case "elif_clause": {
      const cond = extractCondition(node);
      return `ELIF:${cond}`;
    }
    case "with_statement":
      return "WITH";
    // Rust
    case "if_expression": {
      const cond = extractCondition(node);
      return `IF:${cond}`;
    }
    case "for_expression":
      return "LOOP";
    case "match_expression":
      return "MATCH";
    case "return_expression": {
      const val = node.childCount > 1 ? node.child(1)?.text ?? "" : "";
      return `RET ${val.length > 60 ? val.slice(0, 57) + "..." : val}`.trimEnd();
    }
    // Go
    case "defer_statement":
      return "DEFER";
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

    // Python
    case "function_definition": {
      const name = node.childForFieldName("name")?.text ?? "anonymous";
      const params = node.childForFieldName("parameters")?.text ?? "()";
      const returnType = node.childForFieldName("return_type")?.text ?? "";
      const rt = returnType ? ` -> ${returnType}` : "";
      return `FN:${name}${collapseText(params, 60)}${rt}`;
    }
    case "class_definition": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      const superclass = node.childForFieldName("superclasses")?.text ?? "";
      const sc = superclass ? `(${collapseText(superclass, 40)})` : "";
      return `CLASS:${name}${sc}`;
    }
    case "import_from_statement": {
      return `USE:${collapseText(node.text, 80)}`;
    }
    case "decorated_definition": {
      // Walk into the actual definition inside
      return null; // WALK_ONLY behavior — children will be processed
    }

    // Go
    case "method_declaration":
    case "type_declaration":
    case "import_declaration": {
      return `${collapseText(node.text, 80)}`;
    }

    // Rust
    case "function_item": {
      const name = node.childForFieldName("name")?.text ?? "anonymous";
      const params = node.childForFieldName("parameters")?.text ?? "()";
      return `FN:${name}${collapseText(params, 60)}`;
    }
    case "struct_item":
    case "enum_item":
    case "trait_item":
    case "impl_item":
    case "use_declaration": {
      const firstLine = node.text.split("\n")[0];
      return collapseText(firstLine, 80);
    }

    default:
      return null;
  }
}

const SKIP_CALL_SUFFIXES = [".push", ".pop", ".shift", ".unshift", ".splice", ".sort", ".reverse",
  ".set", ".get", ".delete", ".add", ".clear", ".has", ".forEach", ".map", ".filter", ".reduce",
  ".find", ".some", ".every", ".join", ".split", ".trim", ".slice", ".includes", ".indexOf",
  ".toString", ".valueOf"];

const SKIP_CALL_PREFIXES = ["console.", "Math.", "Object.", "Array.", "JSON.", "String.", "Number.", "Promise."];

function getCalleeText(node: SyntaxNode): string {
  const fn = node.childForFieldName("function");
  if (fn) return fn.text;
  // fallback: first child
  if (node.childCount > 0) return node.child(0)!.text;
  return "";
}

function emitTier3(node: SyntaxNode): string | null {
  switch (node.type) {
    case "lexical_declaration": {
      // Find variable_declarator child
      let declarator: SyntaxNode | null = null;
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)!;
        if (c.type === "variable_declarator") {
          declarator = c;
          break;
        }
      }
      if (!declarator) return null;

      const name = declarator.childForFieldName("name")?.text ?? "?";
      const value = declarator.childForFieldName("value");

      if (value) {
        // Arrow functions are important — they define behavior
        if (value.type === "arrow_function") {
          const asyncPrefix = isAsync(value) ? "ASYNC " : "";
          const params = value.childForFieldName("parameters")?.text ?? "()";
          return `${asyncPrefix}FN:${name}${collapseText(params, 60)} => ...`;
        }
        // Await expressions are important — they show async dependencies
        if (value.type === "await_expression") {
          const callee = value.childCount > 1 ? value.child(1)!.text : "...";
          return `AWAIT:${name}=${collapseText(callee, 40)}`;
        }
        // Regular variables inside function bodies are noise — drop them
        // Only keep top-level (module scope) variable declarations
        if (node.parent?.type === "statement_block") return null;
        // Drop module-level constants with simple literal values (numbers, booleans, objects, arrays, new expressions, function calls)
        // These are configuration/setup noise — only string/template constants carry semantic value
        const vt = value.type;
        if (vt === "number" || vt === "true" || vt === "false") return null;
        if (vt === "object" || vt === "array") return null;
        if (vt === "new_expression" || vt === "call_expression") return null;
        const valText = value.text.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, "``");
        return `VAR:${name} = ${collapseText(valText, 50)}`;
      }
      return null;
    }

    case "expression_statement": {
      const expr = node.child(0);
      if (!expr) return null;

      if (expr.type === "await_expression") {
        // Standalone await without variable binding — drop (noise)
        return null;
      }

      if (expr.type === "call_expression") {
        // Capture runtime inheritance patterns — these are structurally important
        const callee = expr.child(0)?.text ?? "";
        if (callee === "ObjectSetPrototypeOf" || callee === "Object.setPrototypeOf") {
          const args = expr.child(1); // arguments node
          if (args && args.childCount >= 4) {
            const child = args.child(1)?.text ?? "?";
            const parent = args.child(3)?.text ?? "?";
            const shortChild = child.length > 30 ? child.slice(0, 27) + "..." : child;
            const shortParent = parent.length > 30 ? parent.slice(0, 27) + "..." : parent;
            return `EXTENDS:${shortChild} < ${shortParent}`;
          }
        }
        return null;
      }

      // Assignment expressions and other expression statements are noise — drop them
      return null;
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
          childType === "class_body" ||
          childType === "block" ||           // Python/Go/Rust
          childType === "body" ||            // Python class/function body
          childType === "declaration_list"   // Rust impl block
        ) {
          walkNode(child, depth + 1, lines);
        }
      }
      break;
    }

    case "T2_CONTROL": {
      // Limit depth — beyond 4, only keep returns, throw, and switch cases
      if (depth > 4 && node.type !== "return_statement" && node.type !== "throw_statement"
        && node.type !== "switch_case" && node.type !== "switch_default") break;

      // Guard clause compression: if (cond) { return x; } → single GUARD line
      if (node.type === "if_statement") {
        // Check no else branch
        let hasElse = false;
        for (let i = 0; i < node.childCount; i++) {
          if (node.child(i)!.type === "else_clause") { hasElse = true; break; }
        }
        if (!hasElse) {
          // Find the body: either consequence field or first statement_block child
          const body = node.childForFieldName("consequence")
            ?? (() => { for (let i = 0; i < node.childCount; i++) { const c = node.child(i)!; if (c.type === "statement_block") return c; } return null; })();
          if (body) {
            let singleStmt: SyntaxNode | null = null;
            if (body.type === "statement_block") {
              const stmts: SyntaxNode[] = [];
              for (let i = 0; i < body.childCount; i++) {
                const c = body.child(i)!;
                if (c.type !== "{" && c.type !== "}") stmts.push(c);
              }
              if (stmts.length === 1) singleStmt = stmts[0];
            } else if (body.type === "return_statement" || body.type === "throw_statement") {
              singleStmt = body;
            }
            if (singleStmt && (singleStmt.type === "return_statement" || singleStmt.type === "throw_statement")) {
              const cond = extractCondition(node);
              const retLine = emitTier2(singleStmt);
              if (retLine) {
                const indent = "  ".repeat(depth);
                lines.push(`${indent}IF:${cond} → ${retLine}`);
                break;
              }
            }
          }
        }
      }

      const line = emitTier2(node);
      const indent = "  ".repeat(depth);
      if (line) lines.push(indent + line);
      for (let i = 0; i < node.childCount; i++) {
        walkNode(node.child(i)!, depth + 1, lines);
      }
      break;
    }

    case "T3_COMPRESS": {
      // At deep nesting, expression details are noise — skip
      if (depth > 4) break;
      const line = emitTier3(node);
      const indent = "  ".repeat(depth);
      if (line) lines.push(indent + line);
      // Don't walk children — one-liner is enough
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

  // Post-process pass 1: merge consecutive USE lines
  const pass1: string[] = [];
  let useBlock: string[] = [];
  for (const line of lines) {
    if (line.startsWith("USE:")) {
      const m = line.match(/from\s+["']([^"']+)["']/);
      useBlock.push(m ? m[1] : line.slice(4));
    } else {
      if (useBlock.length > 0) {
        if (useBlock.length <= 3) {
          for (const mod of useBlock) pass1.push(`USE:${mod}`);
        } else {
          pass1.push(`USE:[${useBlock.join(", ")}]`);
        }
        useBlock = [];
      }
      pass1.push(line);
    }
  }
  if (useBlock.length > 0) {
    if (useBlock.length <= 3) {
      for (const mod of useBlock) pass1.push(`USE:${mod}`);
    } else {
      pass1.push(`USE:[${useBlock.join(", ")}]`);
    }
  }

  // Post-process pass 2: merge 3+ consecutive guard clauses
  // Only merge when there are 3 or more — keeps small if/ret pairs readable
  const merged: string[] = [];
  let guardBlock: string[] = [];

  for (const line of pass1) {
    const guardMatch = line.match(/^(\s*)IF:(.+?) \u2192 RET/);
    if (guardMatch) {
      guardBlock.push(guardMatch[2].trim());
      continue;
    }
    if (guardBlock.length > 0) {
      if (guardBlock.length < 3) {
        // Keep as individual lines
        for (const g of guardBlock) merged.push(`  IF:${g} \u2192 RET`);
      } else {
        merged.push(`  GUARD:[${guardBlock.join(", ")}]`);
      }
      guardBlock = [];
    }
    merged.push(line);
  }
  if (guardBlock.length > 0) {
    if (guardBlock.length < 3) {
      for (const g of guardBlock) merged.push(`  IF:${g} \u2192 RET`);
    } else {
      merged.push(`  GUARD:[${guardBlock.join(", ")}]`);
    }
  }

  return merged.join("\n");
}
