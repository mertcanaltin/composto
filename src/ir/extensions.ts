// Source extensions Composto indexes with deep (tree-sitter) IR today. Kept in
// its own module so both the index builder and the coverage analyzer can import
// it without a circular dependency through cli/commands.ts.
export const ALL_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs"];
