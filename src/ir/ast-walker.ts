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

  // Tier 1 — class members (qualified methods only, fields dropped as noise)
  method_definition: "T1_KEEP",          // JS/TS class method

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

// Extract JSDoc/docstring — only for exported symbols, minimal payload
// Rationale: JSDoc on internal functions is narrative; on public API it's structural.
export function extractDocComment(node: SyntaxNode): string | null {
  // Only extract doc for exported declarations
  const exported = node.parent?.type === "export_statement";
  if (!exported) return null;

  // Comment lives before the export_statement
  const prev = node.parent?.previousNamedSibling;
  if (!prev || prev.type !== "comment") return null;

  const text = prev.text;
  if (!text.startsWith("/**")) return null;

  const body = text.replace(/^\/\*\*|\*\/$/g, "").replace(/^\s*\*\s?/gm, "").trim();

  // Only @deprecated tag is structural (affects consumers). Skip others.
  const hasDeprecated = /@deprecated\b/.test(body);

  // If deprecated, that's enough signal. Don't duplicate with description.
  if (hasDeprecated) return "@deprecated";

  // Otherwise, very short description (30 char max, first line only)
  const beforeTags = body.split(/@\w+/)[0].trim();
  const firstLine = beforeTags.split("\n")[0].trim();
  if (!firstLine || firstLine.length < 5) return null;
  return `"${firstLine.length > 30 ? firstLine.slice(0, 27) + "..." : firstLine}"`;
}

// Extract Python docstring (first string literal, 30 char max)
export function extractPythonDocstring(bodyNode: SyntaxNode | null): string | null {
  if (!bodyNode) return null;
  for (let i = 0; i < bodyNode.childCount; i++) {
    const child = bodyNode.child(i)!;
    if (child.type === "expression_statement" && child.childCount > 0) {
      const expr = child.child(0)!;
      if (expr.type === "string") {
        const text = expr.text.replace(/^(['"]{3}|['"])|(['"]{3}|['"])$/g, "").trim();
        const firstLine = text.split("\n")[0].trim();
        if (firstLine.length < 5) return null;
        return `"${firstLine.length > 30 ? firstLine.slice(0, 27) + "..." : firstLine}"`;
      }
      break;
    }
  }
  return null;
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

// Extract the module path from an import_statement via AST, not text regex.
// Handles multi-line named imports where text truncation would drop the source.
function findImportSource(node: SyntaxNode): string | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)!;
    if (c.type === "string") {
      for (let j = 0; j < c.childCount; j++) {
        const cc = c.child(j)!;
        if (cc.type === "string_fragment") return cc.text;
      }
      return c.text.replace(/^['"]|['"]$/g, "");
    }
  }
  return null;
}

function argumentsNode(call: SyntaxNode): SyntaxNode | null {
  const byField = call.childForFieldName("arguments");
  if (byField) return byField;
  for (let i = 0; i < call.childCount; i++) {
    const c = call.child(i)!;
    if (c.type === "arguments") return c;
  }
  return null;
}

const ANON_FN_TYPES = new Set([
  "arrow_function",
  "function_expression",
  "function",
  "generator_function",
  "generator_function_declaration",
]);

// Collect anonymous-function arguments from a call expression, walking through
// nested calls, member-expression receivers (e.g. `.pipe(...)` chains), and
// parenthesized expressions. Covers Effect.gen, Rpc.toLayer(...).pipe(...),
// createSlice, defineConfig, chained builders, etc.
function collectAnonFnArgs(call: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const seen = new Set<number>();
  const visit = (n: SyntaxNode | null, budget: number) => {
    if (!n || budget < 0 || seen.has(n.id)) return;
    seen.add(n.id);
    if (ANON_FN_TYPES.has(n.type)) {
      out.push(n);
      return;
    }
    if (n.type === "parenthesized_expression") {
      for (let i = 0; i < n.childCount; i++) visit(n.child(i)!, budget);
      return;
    }
    if (n.type === "call_expression") {
      // Descend into arguments.
      const args = argumentsNode(n);
      if (args) {
        for (let i = 0; i < args.childCount; i++) visit(args.child(i)!, budget - 1);
      }
      // Also descend into the callee receiver to handle `X.pipe(...)` wrappers
      // where the factory call `X` is what holds the anonymous function.
      const fn = n.childForFieldName("function");
      if (fn && fn.type === "member_expression") {
        const obj = fn.childForFieldName("object");
        if (obj) visit(obj, budget - 1);
      }
    }
  };
  visit(call, 4);
  return out;
}

function fnBody(fn: SyntaxNode): SyntaxNode | null {
  const byField = fn.childForFieldName("body");
  if (byField) return byField;
  for (let i = 0; i < fn.childCount; i++) {
    const c = fn.child(i)!;
    if (c.type === "statement_block" || c.type === "block") return c;
  }
  return null;
}

// Walk the body of an anonymous function looking for `return { key: (...) => ... }`
// patterns and emit each arrow-function pair as a METHOD. This surfaces the
// handler-object idiom used by Effect Rpc (`Rpc.toLayer(Effect.gen(function* () {
// return { handler1, handler2 } }))`), Redux Toolkit `createSlice({ reducers })`,
// and similar config-object DSLs.
function walkFactoryBody(fn: SyntaxNode, depth: number, lines: string[]): void {
  const body = fnBody(fn);
  if (!body) return;
  const visit = (n: SyntaxNode, d: number) => {
    if (d > 6) return;
    if (n.type === "return_statement") {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)!;
        if (c.type === "object") {
          emitObjectMethods(c, depth, lines);
        }
      }
      return;
    }
    // Recurse into nested blocks so the return can be anywhere in the function.
    for (let i = 0; i < n.childCount; i++) visit(n.child(i)!, d + 1);
  };
  for (let i = 0; i < body.childCount; i++) visit(body.child(i)!, 0);

  // Also walk nested T1 declarations inside the factory body so helpers
  // defined alongside the returned object still appear in IR. Skip
  // return_statements: their handler-object contents are already surfaced
  // as METHOD lines above, and re-walking would emit a noisy RET duplicate.
  for (let i = 0; i < body.childCount; i++) {
    const child = body.child(i)!;
    if (child.type === "return_statement") continue;
    walkNode(child, depth + 1, lines);
  }
}

function emitObjectMethods(obj: SyntaxNode, depth: number, lines: string[]): void {
  const indent = "  ".repeat(depth);
  for (let i = 0; i < obj.childCount; i++) {
    const child = obj.child(i)!;
    if (child.type === "pair") {
      const key = child.childForFieldName("key");
      const value = child.childForFieldName("value");
      if (!key || !value) continue;
      const keyName = key.text;
      if (keyName.startsWith("_") || keyName.startsWith("#")) continue;
      if (ANON_FN_TYPES.has(value.type)) {
        const params = value.childForFieldName("parameters")?.text ?? "()";
        const asyncPrefix = isAsync(value) ? "ASYNC " : "";
        lines.push(`${indent}${asyncPrefix}METHOD:${keyName}${collapseText(params, 40)}`);
      }
      continue;
    }
    // shorthand property: { send, list }
    if (child.type === "shorthand_property_identifier") {
      const keyName = child.text;
      if (keyName.startsWith("_") || keyName.startsWith("#")) continue;
      lines.push(`${indent}METHOD:${keyName}`);
      continue;
    }
    // method definition: { send(x) {} }
    if (child.type === "method_definition") {
      const key = child.childForFieldName("name");
      if (!key) continue;
      const keyName = key.text;
      if (keyName.startsWith("_") || keyName.startsWith("#")) continue;
      const params = child.childForFieldName("parameters")?.text ?? "()";
      const asyncPrefix = isAsync(child) ? "ASYNC " : "";
      lines.push(`${indent}${asyncPrefix}METHOD:${keyName}${collapseText(params, 40)}`);
      continue;
    }
  }
}

// True when a lexical_declaration's RHS is a call expression whose arguments
// include an anonymous function (directly or one nested call level deep).
function isFactoryDeclaration(node: SyntaxNode): { name: string; fns: SyntaxNode[] } | null {
  let declarator: SyntaxNode | null = null;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)!;
    if (c.type === "variable_declarator") {
      declarator = c;
      break;
    }
  }
  if (!declarator) return null;
  const name = declarator.childForFieldName("name")?.text;
  const value = declarator.childForFieldName("value");
  if (!name || !value || value.type !== "call_expression") return null;
  const fns = collectAnonFnArgs(value);
  if (fns.length === 0) return null;
  return { name, fns };
}

function emitTier1(node: SyntaxNode): string | null {
  const exported = isExported(node);
  const outPrefix = exported ? "OUT " : "";

  switch (node.type) {
    case "import_statement": {
      // Extract module source from AST (string > string_fragment) instead of
      // regex on collapsed text. Collapsed text truncates long imports before
      // the `from "..."` clause, breaking downstream module-name extraction.
      const source = findImportSource(node);
      if (source) return `USE:${source}`;
      return `USE:${collapseText(node.text, 80)}`;
    }

    case "function_declaration": {
      const name = node.childForFieldName("name")?.text ?? "anonymous";
      const rawParams = node.childForFieldName("parameters")?.text ?? "()";
      const params = collapseText(rawParams, 60);
      const asyncPrefix = isAsync(node) ? "ASYNC " : "";
      const doc = extractDocComment(node);
      const docPrefix = doc ? `${doc} ` : "";
      return `${docPrefix}${outPrefix}${asyncPrefix}FN:${name}${params}`;
    }

    case "class_declaration": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      const typeParams = getTypeParams(node);
      const doc = extractDocComment(node);
      const docPrefix = doc ? `${doc} ` : "";
      return `${docPrefix}${outPrefix}CLASS:${name}${typeParams}`;
    }

    case "interface_declaration": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      const typeParams = getTypeParams(node);
      const doc = extractDocComment(node);
      const docPrefix = doc ? `${doc} ` : "";
      return `${docPrefix}${outPrefix}INTERFACE:${name}${typeParams}`;
    }

    case "type_alias_declaration": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      const doc = extractDocComment(node);
      const docPrefix = doc ? `${doc} ` : "";
      return `${docPrefix}${outPrefix}TYPE:${name}`;
    }

    case "enum_declaration": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      const doc = extractDocComment(node);
      const docPrefix = doc ? `${doc} ` : "";
      return `${docPrefix}${outPrefix}ENUM:${name}`;
    }

    case "method_definition": {
      const name = node.childForFieldName("name")?.text ?? "anonymous";
      // Skip private methods (# prefix) and common lifecycle methods
      if (name.startsWith("#") || name.startsWith("_")) return null;

      // Find enclosing class for qualified name (Class.method)
      let enclosingClass: string | null = null;
      let parent: SyntaxNode | null = node.parent;
      while (parent) {
        if (parent.type === "class_declaration" || parent.type === "class_definition") {
          enclosingClass = parent.childForFieldName("name")?.text ?? null;
          break;
        }
        parent = parent.parent;
      }
      const params = node.childForFieldName("parameters")?.text ?? "()";
      const asyncPrefix = isAsync(node) ? "ASYNC " : "";
      const qualifiedName = enclosingClass ? `${enclosingClass}.${name}` : name;
      // Shorter params truncation for methods (40 vs 60)
      return `${asyncPrefix}METHOD:${qualifiedName}${collapseText(params, 40)}`;
    }


    // Python
    case "function_definition": {
      const name = node.childForFieldName("name")?.text ?? "anonymous";
      const params = node.childForFieldName("parameters")?.text ?? "()";
      const returnType = node.childForFieldName("return_type")?.text ?? "";
      const rt = returnType ? ` -> ${returnType}` : "";
      const body = node.childForFieldName("body");
      const doc = extractPythonDocstring(body);
      const docPrefix = doc ? `${doc} ` : "";
      return `${docPrefix}FN:${name}${collapseText(params, 60)}${rt}`;
    }
    case "class_definition": {
      const name = node.childForFieldName("name")?.text ?? "Anonymous";
      const superclass = node.childForFieldName("superclasses")?.text ?? "";
      const sc = superclass ? `(${collapseText(superclass, 40)})` : "";
      const body = node.childForFieldName("body");
      const doc = extractPythonDocstring(body);
      const docPrefix = doc ? `${doc} ` : "";
      return `${docPrefix}CLASS:${name}${sc}`;
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
      // At deep nesting, expression details are noise - skip
      if (depth > 4) break;

      // Factory-declaration pattern: `const X = call(fn)` where the call
      // receives an anonymous function. Covers Effect.gen, Redux createSlice,
      // TanStack createRouter, defineConfig, etc. Emit the declaration and
      // walk the anonymous function body so its returned methods appear.
      if (node.type === "lexical_declaration") {
        const factory = isFactoryDeclaration(node);
        if (factory) {
          const exported = isExported(node) || node.parent?.type === "export_statement";
          const prefix = exported ? "OUT " : "";
          const indent = "  ".repeat(depth);
          lines.push(`${indent}${prefix}FN:${factory.name}`);
          for (const fn of factory.fns) walkFactoryBody(fn, depth + 1, lines);
          break;
        }
      }

      const line = emitTier3(node);
      const indent = "  ".repeat(depth);
      if (line) lines.push(indent + line);
      // Don't walk children - one-liner is enough
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
      // emitTier1 now emits clean `USE:<module>` strings via findImportSource,
      // so no fallback regex is needed.
      useBlock.push(line.slice(4));
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
