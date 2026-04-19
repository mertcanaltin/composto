// src/memory/signals/index.ts
import type { DB } from "../db.js";
import type { Signal } from "../types.js";
import { computeRevertMatch } from "./revert-match.js";
import {
  computeHotspot,
  computeFixRatio,
  computeCoverageDecline,
  computeAuthorChurn,
} from "./stubs.js";

export function collectSignals(db: DB, filePath: string): Signal[] {
  return [
    computeRevertMatch(db, filePath),
    computeHotspot(db, filePath),
    computeFixRatio(db, filePath),
    computeCoverageDecline(db, filePath),
    computeAuthorChurn(db, filePath),
  ];
}
