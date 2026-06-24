import { watch, mkdirSync, writeFileSync, type FSWatcher } from "node:fs";
import { dirname, sep } from "node:path";
import { buildProjectIndex, ALL_EXTENSIONS } from "../cli/commands.js";

// Directories we never react to — our own snapshot lives under .composto, so
// reacting to it would loop the daemon forever.
const IGNORED_SEGMENTS = new Set(["node_modules", ".git", "dist", ".composto"]);

/**
 * Pure decision: should a changed path trigger a rebuild? Keeps the daemon's
 * hot loop honest and unit-testable without touching the filesystem. A change
 * counts only when it is a source file (by extension) and lives outside the
 * always-ignored directories.
 */
export function shouldTriggerReindex(
  relPath: string,
  extensions: string[] = ALL_EXTENSIONS,
): boolean {
  if (!relPath) return false;
  const segments = relPath.split(sep);
  if (segments.some(s => IGNORED_SEGMENTS.has(s))) return false;
  return extensions.some(ext => relPath.endsWith(ext));
}

export interface DaemonOptions {
  projectPath: string;
  budget: number;
  outPath: string;
  debounceMs?: number;
  logger?: Pick<Console, "log" | "error">;
}

export interface DaemonHandle {
  stop: () => void;
  /** Force a rebuild now — exposed for tests and SIGUSR2-style hooks. */
  rebuild: () => Promise<void>;
}

/**
 * Start the in-memory index daemon. Builds the navigation map once, keeps it
 * warm, and re-runs the build (debounced) whenever a source file changes,
 * rewriting the disk snapshot so every short-lived consumer — Claude Code
 * hooks, `@.composto/context.md` references, MCP — sees a fresh map for free.
 * The filesystem snapshot IS the IPC; no socket needed for v1.
 */
export async function startIndexDaemon(opts: DaemonOptions): Promise<DaemonHandle> {
  const { projectPath, budget, outPath } = opts;
  const log = opts.logger ?? console;
  const debounceMs = opts.debounceMs ?? 300;

  let rebuilding = false;
  let pending = false;
  let timer: NodeJS.Timeout | null = null;

  async function rebuild(): Promise<void> {
    if (rebuilding) { pending = true; return; }
    rebuilding = true;
    const started = Date.now();
    try {
      const r = await buildProjectIndex(projectPath, budget, "live");
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, r.content);
      const elapsed = ((Date.now() - started) / 1000).toFixed(2);
      log.log(`composto: map refreshed — ${r.files} files → ~${r.tokens} tokens @ ${r.sha} (${elapsed}s)`);
    } catch (err) {
      log.error(`composto: rebuild failed — ${(err as Error).message}`);
    } finally {
      rebuilding = false;
      if (pending) { pending = false; void rebuild(); }
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void rebuild(); }, debounceMs);
  }

  // Initial warm build.
  log.log(`composto start — building in-memory navigation map for ${projectPath}`);
  await rebuild();

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(projectPath, { recursive: true }, (_event, filename) => {
      if (filename && shouldTriggerReindex(filename.toString())) schedule();
    });
  } catch (err) {
    log.error(`composto: file watching unavailable (${(err as Error).message}); map will not auto-refresh`);
  }

  log.log("composto: watching for changes — Ctrl-C to stop");

  function stop(): void {
    if (timer) clearTimeout(timer);
    watcher?.close();
  }

  return { stop, rebuild };
}
