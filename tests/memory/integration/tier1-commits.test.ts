import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/memory/db.js";
import { runMigrations } from "../../../src/memory/schema.js";
import { ingestRange } from "../../../src/memory/ingest/tier1.js";
import { revParseHead } from "../../../src/memory/git.js";

describe("tier1 ingest — commits + file_touches", () => {
  let repoDir: string;
  let dbDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "composto-ing-repo-"));
    execSync(`bash tests/memory/fixtures/make-small-repo.sh ${repoDir}`, { stdio: "ignore" });
    dbDir = mkdtempSync(join(tmpdir(), "composto-ing-db-"));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("populates commits for the full history on bootstrap", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    runMigrations(db);
    const head = revParseHead(repoDir);

    ingestRange(db, repoDir, { from: null, to: head });

    const rows = db.prepare("SELECT COUNT(*) AS n FROM commits").get() as { n: number };
    expect(rows.n).toBeGreaterThanOrEqual(20);

    const fixCount = db.prepare("SELECT COUNT(*) AS n FROM commits WHERE is_fix = 1").get() as { n: number };
    expect(fixCount.n).toBeGreaterThanOrEqual(2);

    const revertCount = db.prepare("SELECT COUNT(*) AS n FROM commits WHERE is_revert = 1").get() as { n: number };
    expect(revertCount.n).toBe(1);

    db.close();
  });

  it("populates file_touches rows for each commit", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const touches = db.prepare("SELECT COUNT(*) AS n FROM file_touches").get() as { n: number };
    expect(touches.n).toBeGreaterThan(20);
    db.close();
  });

  it("sets index_state.last_indexed_sha to HEAD", () => {
    const db = openDatabase(join(dbDir, "memory.db"));
    const row = db.prepare("SELECT value FROM index_state WHERE key='last_indexed_sha'").get() as { value: string };
    expect(row.value).toMatch(/^[0-9a-f]{40}$/);
    db.close();
  });
});
