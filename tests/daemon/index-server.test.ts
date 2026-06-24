import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldTriggerReindex, startIndexDaemon } from "../../src/daemon/index-server.js";

describe("shouldTriggerReindex", () => {
  it("triggers on a source file change", () => {
    expect(shouldTriggerReindex("src/foo.ts")).toBe(true);
    expect(shouldTriggerReindex("lib/bar.py")).toBe(true);
  });

  it("ignores our own snapshot and vendored/build dirs", () => {
    expect(shouldTriggerReindex(".composto/context.md")).toBe(false);
    expect(shouldTriggerReindex("node_modules/x/index.js")).toBe(false);
    expect(shouldTriggerReindex(".git/HEAD")).toBe(false);
    expect(shouldTriggerReindex("dist/index.js")).toBe(false);
  });

  it("ignores non-source files and empty paths", () => {
    expect(shouldTriggerReindex("README.md")).toBe(false);
    expect(shouldTriggerReindex("")).toBe(false);
  });
});

describe("startIndexDaemon", () => {
  it("writes a live navigation map on start and refreshes on demand", async () => {
    const dir = mkdtempSync(join(tmpdir(), "composto-daemon-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "a.ts"), "export function alpha() { return 1; }\n");
      const outPath = join(dir, ".composto", "context.md");
      const silent = { log: () => {}, error: () => {} };

      const handle = await startIndexDaemon({ projectPath: dir, budget: 4000, outPath, logger: silent });
      try {
        const first = readFileSync(outPath, "utf-8");
        expect(first).toContain("Composto navigation map");
        expect(first).toContain("Kept fresh by a running");
        expect(first).toContain("src/a.ts");

        // Add a file, force a rebuild, confirm it lands in the map.
        writeFileSync(join(dir, "src", "b.ts"), "export function beta() { return 2; }\n");
        await handle.rebuild();
        const second = readFileSync(outPath, "utf-8");
        expect(second).toContain("src/b.ts");
      } finally {
        handle.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
