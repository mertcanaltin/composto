// src/memory/failure-tracker.ts
// Three-strike disabled mode: three consecutive failures of the same class
// within 5 minutes mark the tool disabled. Cleared by recordSuccess() or
// by deleting .composto/failures.json.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const STRIKE_THRESHOLD = 3;
const WINDOW_SECONDS = 300;

export interface FailureTracker {
  recordFailure: (failureClass: string) => void;
  recordSuccess: () => void;
  isDisabled: () => boolean;
}

interface State {
  failures: Array<{ class: string; t: number }>;
  disabled: boolean;
}

export function createFailureTracker(composto_dir: string): FailureTracker {
  const path = join(composto_dir, "failures.json");
  try {
    mkdirSync(composto_dir, { recursive: true });
  } catch {
    /* if we can't mkdir, isDisabled stays false; acceptable */
  }

  function load(): State {
    try {
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(raw) as State;
    } catch {
      return { failures: [], disabled: false };
    }
  }

  function save(s: State): void {
    try {
      writeFileSync(path, JSON.stringify(s), "utf-8");
    } catch {
      /* best-effort */
    }
  }

  function now(): number {
    return Math.floor(Date.now() / 1000);
  }

  return {
    recordFailure: (failureClass: string) => {
      const s = load();
      s.failures.push({ class: failureClass, t: now() });
      // Keep only entries within window
      s.failures = s.failures.filter((f) => now() - f.t <= WINDOW_SECONDS);
      const sameClass = s.failures.filter((f) => f.class === failureClass);
      if (sameClass.length >= STRIKE_THRESHOLD) s.disabled = true;
      save(s);
    },
    recordSuccess: () => {
      save({ failures: [], disabled: false });
    },
    isDisabled: () => {
      return load().disabled;
    },
  };
}
