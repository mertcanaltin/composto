// src/memory/signals/index.ts
import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { computeRevertMatch } from "./revert-match.js";
import { computeHotspot } from "./hotspot.js";
import { computeFixRatio } from "./fix-ratio.js";
import { computeAuthorChurn } from "./author-churn.js";

export function collectSignals(db: DB, _repoPath: string, filePath: string): Signal[] {
  return [
    computeRevertMatch(db, filePath),
    computeHotspot(db, filePath),
    computeFixRatio(db, filePath),
    computeAuthorChurn(db, filePath),
  ];
}
