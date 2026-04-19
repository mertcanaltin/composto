// src/memory/log.ts
// NDJSON append-only logger with daily rotation and 7-day retention.
// Each line: {"t": <epoch>, "lvl": "info|warn|error|debug", "evt": "...", ...extras}

import { appendFileSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const RETENTION_DAYS = 7;

export interface Logger {
  debug: (evt: string, extras?: Record<string, unknown>) => void;
  info: (evt: string, extras?: Record<string, unknown>) => void;
  warn: (evt: string, extras?: Record<string, unknown>) => void;
  error: (evt: string, extras?: Record<string, unknown>) => void;
  close: () => void;
}

function currentThreshold(): Level {
  const raw = (process.env.COMPOSTO_LOG ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

function rotateIfNeeded(dir: string): void {
  const logPath = join(dir, "index.log");
  try {
    const s = statSync(logPath);
    const age = (Date.now() - s.mtimeMs) / 86400000;
    if (age < 1) return;
    // Shift .N files: index.log.6 deleted, .5 → .6, .4 → .5, etc.
    const files = readdirSync(dir).filter((f) => /^index\.log(\.\d+)?$/.test(f));
    const numbered = files
      .map((f) => {
        const m = f.match(/^index\.log\.(\d+)$/);
        return { name: f, n: m ? parseInt(m[1], 10) : 0 };
      })
      .sort((a, b) => b.n - a.n);
    for (const f of numbered) {
      if (f.n >= RETENTION_DAYS) {
        unlinkSync(join(dir, f.name));
        continue;
      }
      if (f.n === 0) {
        renameSync(join(dir, f.name), join(dir, "index.log.1"));
      } else {
        renameSync(join(dir, f.name), join(dir, `index.log.${f.n + 1}`));
      }
    }
  } catch {
    /* file doesn't exist yet, no rotation needed */
  }
}

export function createLogger(composto_dir: string): Logger {
  let disabled = false;
  try {
    mkdirSync(composto_dir, { recursive: true });
    rotateIfNeeded(composto_dir);
  } catch {
    disabled = true;
  }
  const path = join(composto_dir, "index.log");
  const threshold = currentThreshold();

  function write(level: Level, evt: string, extras: Record<string, unknown> | undefined): void {
    if (disabled) return;
    if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;
    const line = JSON.stringify({
      t: Math.floor(Date.now() / 1000),
      lvl: level,
      evt,
      ...(extras ?? {}),
    });
    try {
      appendFileSync(path, line + "\n", "utf-8");
    } catch {
      disabled = true;
    }
  }

  return {
    debug: (evt, extras) => write("debug", evt, extras),
    info: (evt, extras) => write("info", evt, extras),
    warn: (evt, extras) => write("warn", evt, extras),
    error: (evt, extras) => write("error", evt, extras),
    close: () => { /* append-only, nothing to flush explicitly */ },
  };
}
