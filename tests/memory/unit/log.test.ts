// tests/memory/unit/log.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../../src/memory/log.js";

describe("createLogger", () => {
  let dir = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("appends NDJSON lines to the target file", () => {
    dir = mkdtempSync(join(tmpdir(), "composto-log-"));
    const logger = createLogger(dir);
    logger.info("ingest_start", { commits: 42 });
    logger.warn("parse_failed", { file: "x.ts" });
    logger.close();

    const contents = readFileSync(join(dir, "index.log"), "utf-8");
    const lines = contents.trim().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]);
    expect(first.evt).toBe("ingest_start");
    expect(first.lvl).toBe("info");
    expect(first.commits).toBe(42);
    expect(first.t).toBeGreaterThan(0);
  });

  it("is a no-op if directory cannot be created", () => {
    // Pointing at an impossible path should not throw
    const logger = createLogger("/dev/null/impossible");
    expect(() => logger.info("test", {})).not.toThrow();
    logger.close();
  });

  it("respects COMPOSTO_LOG=error filter", () => {
    dir = mkdtempSync(join(tmpdir(), "composto-log-"));
    process.env.COMPOSTO_LOG = "error";
    const logger = createLogger(dir);
    logger.info("ignored", {});
    logger.error("kept", {});
    logger.close();
    delete process.env.COMPOSTO_LOG;

    const contents = existsSync(join(dir, "index.log"))
      ? readFileSync(join(dir, "index.log"), "utf-8")
      : "";
    const lines = contents.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).evt).toBe("kept");
  });
});
