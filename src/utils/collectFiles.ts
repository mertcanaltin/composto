import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ignore, { type Ignore } from "ignore";

const ALWAYS_SKIP = new Set(["node_modules", ".git", "dist"]);

function loadGitignore(dir: string): Ignore {
  const ig = ignore();
  try {
    const raw = readFileSync(join(dir, ".gitignore"), "utf-8");
    ig.add(raw);
  } catch {
    // no .gitignore in this directory
  }
  return ig;
}

export function collectFiles(
  dir: string,
  extensions: string[],
  projectPath?: string,
): string[] {
  const root = projectPath ?? dir;
  const files: string[] = [];

  function walk(currentDir: string, parentIgnore: Ignore): void {
    const ig = loadGitignore(currentDir);
    const merged = ignore().add(parentIgnore).add(ig);

    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || ALWAYS_SKIP.has(entry.name)) continue;

        const fullPath = join(currentDir, entry.name);
        const relPath = relative(root, fullPath);

        if (merged.ignores(relPath)) continue;

        if (entry.isDirectory()) {
          walk(fullPath, merged);
        } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch {
      /* ignore permission errors */
    }
  }

  walk(dir, ignore());
  return files;
}
