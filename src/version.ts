import { createRequire } from "node:module";

// Single source of truth for the CLI version. Read from package.json at
// runtime so command headers never drift from the published version.
export const VERSION = (() => {
  try {
    const req = createRequire(import.meta.url);
    return (req("../package.json") as { version: string }).version;
  } catch {
    return "0.0.0";
  }
})();
