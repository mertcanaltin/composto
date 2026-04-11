import { extname } from "node:path";

export type Language = "typescript" | "javascript" | "python" | "go" | "rust";

const EXT_MAP: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXT_MAP);

export function detectLanguage(filePath: string): Language | null {
  const ext = extname(filePath);
  return EXT_MAP[ext] ?? null;
}
