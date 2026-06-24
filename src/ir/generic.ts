// Tier-2 structural extractor: a grammar-free, language-agnostic pass for braced
// languages Composto doesn't deeply parse yet (C, C++, Java, C#, Swift, ...).
// It is deliberately heuristic — far less precise than the tree-sitter path, but
// it turns "blind + dishonest" into a usable navigation map with zero binaries
// and zero ABI risk. Deep IR (queries.ts) stays the upgrade path for top langs.

const GENERIC_EXTENSIONS = [
  ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx", // C / C++
  ".java", ".kt", ".kts", ".scala",                         // JVM
  ".cs",                                                    // C#
  ".swift", ".m", ".mm",                                    // Apple
  ".php",                                                   // PHP
];

// Statement keywords that can precede `name(...)` but are NOT declarations.
const CONTROL = new Set([
  "if", "for", "while", "switch", "catch", "return", "sizeof",
  "else", "do", "case", "default", "throw", "new", "delete", "co_await",
]);

export function isGenericLang(filePath: string): boolean {
  const i = filePath.lastIndexOf(".");
  if (i === -1) return false;
  return GENERIC_EXTENSIONS.includes(filePath.slice(i).toLowerCase());
}

export { GENERIC_EXTENSIONS };

const TYPE_DECL =
  /^(?:template\s*<[^>]*>\s*)?(?:(?:public|private|protected|final|abstract|static|sealed|export|pub)\s+)*(class|struct|interface|enum|trait|union|record)(?:\s+(?:class|struct))?\s+(\w+)([^{;]*)/;

// `name(args)` that opens a body `{` or ends a prototype `;`, allowing trailing
// qualifiers (const/noexcept/override/throws/return-type arrow/base-init).
const FUNC =
  /(?:^|[\s*&>:~])([A-Za-z_]\w*)\s*\([^;{]*\)\s*(?:\s*(?:const\b|noexcept\b|override\b|final\b|mutable\b|throws\b[^{;]*|->[^{;]*|:[^{;]*))*\s*([{;])\s*$/;

export function extractGenericStructure(code: string, _filePath: string): string {
  const out: string[] = [];
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*") || line.startsWith("///")) continue;

    const firstToken = line.split(/[\s(]/)[0];

    let m: RegExpMatchArray | null;

    // includes / imports / using — keep the target verbatim (it's a real edge).
    if ((m = line.match(/^#\s*include\s*[<"]([^>"]+)[>"]/))) { out.push(`USE:${m[1]}`); continue; }
    if ((m = line.match(/^import\s+(?:static\s+)?([\w.]+)/))) { out.push(`USE:${m[1].replace(/;$/, "")}`); continue; }
    if ((m = line.match(/^using\s+([\w.:]+)\s*;/))) { out.push(`USE:${m[1]}`); continue; }

    // namespace / package / module.
    if ((m = line.match(/^(?:namespace|package|module)\s+([\w.:]+)/))) { out.push(`NS:${m[1]}`); continue; }

    // type declarations, with base list if present.
    if ((m = line.match(TYPE_DECL))) {
      const kind = m[1] === "interface" ? "IFACE" : m[1] === "enum" ? "ENUM" : "CLASS";
      const base = (m[3] || "").match(/(?::|extends|implements)\s*([\w:,<>\s.]+)/);
      out.push(`${kind}:${m[2]}${base ? ` < ${base[1].trim().replace(/\s+/g, " ")}` : ""}`);
      continue;
    }

    // Statements that merely call a function are not declarations.
    if (CONTROL.has(firstToken)) continue;

    // function definition / prototype.
    if ((m = line.match(FUNC))) {
      const name = m[1];
      if (CONTROL.has(name)) continue;
      const idx = line.indexOf(name + "(");
      const charBefore = idx > 0 ? line[idx - 1] : "";
      const beforeName = line.slice(0, idx).trim();
      // A `;`-terminated `name(...)` is a prototype only if it isn't really a
      // CALL site. Reject the common call shapes: qualified/member calls
      // (std::sort(), obj.f(), p->f()) and assignment results (x = f()).
      if (m[2] === ";") {
        if (beforeName === "") continue;                       // bare `foo();`
        if (charBefore === "." || charBefore === ":" || charBefore === ">") continue; // member/qualified
        if (line.includes("=")) continue;                      // `T x = f();`
      }
      out.push(`FN:${name}`);
      continue;
    }
  }
  return out.join("\n");
}
