// tests/memory/integration/cli-impact.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("composto impact CLI", () => {
  let repoDir = "";

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-cli-repo-"));
    execSync(`bash ${process.cwd()}/tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("prints a verdict line for a file with history", () => {
    const bin = join(process.cwd(), "dist", "index.js");
    const out = execSync(`node ${bin} impact token.ts`, {
      cwd: repoDir,
      encoding: "utf-8",
    });
    expect(out).toMatch(/verdict:\s+(low|medium|high|unknown)/);
    expect(out).toMatch(/revert_match/);
  });
});
