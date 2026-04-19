import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryAPI } from "../../../dist/memory/api.js";

describe("Plan 2 — multi-signal firing", () => {
  let repoDir = "";
  let dbDir = "";
  let api: MemoryAPI;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-multi-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-multi-db-"));
    api = new MemoryAPI({ dbPath: join(dbDir, "memory.db"), repoPath: repoDir });
    await api.bootstrapIfNeeded();
  });

  afterAll(async () => {
    await api.close();
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("fires at least 2 signals for token.ts in the small-repo fixture", async () => {
    const res = await api.blastradius({ file: "token.ts" });
    expect(res.status).toBe("ok");
    const firing = res.signals.filter((s) => s.strength > 0);
    expect(firing.length).toBeGreaterThanOrEqual(2);
  });

  it("envelope reports repo-calibrated after tier1 ingest runs calibration", async () => {
    const res = await api.blastradius({ file: "token.ts" });
    expect(res.calibration).toBe("repo-calibrated");
  });
});
