// src/memory/signals/index.ts
import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { computeRevertMatch } from "./revert-match.js";
import { computeHotspot } from "./hotspot.js";
import { computeFixRatio } from "./fix-ratio.js";
import { computeCoverageDecline } from "./coverage-decline.js";
import { computeAuthorChurn } from "./author-churn.js";

export function collectSignals(db: DB, repoPath: string, filePath: string): Signal[] {
  return [
    computeRevertMatch(db, filePath),
    computeHotspot(db, filePath),
    computeFixRatio(db, filePath),
    computeCoverageDecline(db, repoPath, filePath),
    computeAuthorChurn(db, filePath),
  ];
}
