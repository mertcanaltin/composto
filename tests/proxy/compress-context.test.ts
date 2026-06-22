import { describe, it, expect } from "vitest";
import { compressFencedBlocks, compressMessages, compressRequestBody } from "../../src/proxy/compress-context.js";

const REAL_FN = `import { readFileSync } from "node:fs";

export function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.environment === "local") {
    parsed.debug = true;
  }
  for (const key of Object.keys(parsed.routes)) {
    parsed.routes[key].enabled = true;
  }
  return parsed;
}`;

describe("compressFencedBlocks", () => {
  it("compresses a fenced code block with a file path and saves tokens", async () => {
    const text = "Here is the file:\n\n```ts src/config/loader.ts\n" + REAL_FN + "\n```\n\nWhat does it do?";
    const result = await compressFencedBlocks(text);

    expect(result.irTokens).toBeLessThan(result.rawTokens);
    expect(result.blocksCompressed).toBe(1);
    // IR markers survive in the rewritten text
    expect(result.text).toContain("FN:loadConfig");
    // the prose around the block is preserved verbatim
    expect(result.text).toContain("Here is the file:");
    expect(result.text).toContain("What does it do?");
  });

  it("derives a language from a bare language fence (no path)", async () => {
    const text = "```typescript\n" + REAL_FN + "\n```";
    const result = await compressFencedBlocks(text);
    expect(result.blocksCompressed).toBe(1);
    expect(result.irTokens).toBeLessThan(result.rawTokens);
  });

  it("leaves a block untouched when IR is not a token win (raw-fallback)", async () => {
    const text = "```ts snippet.ts\nconst x = 1;\n```";
    const result = await compressFencedBlocks(text);
    expect(result.blocksCompressed).toBe(0);
    expect(result.text).toContain("const x = 1;");
  });

  it("leaves non-code fences (e.g. json) untouched", async () => {
    const text = '```json\n{ "environment": "local" }\n```';
    const result = await compressFencedBlocks(text);
    expect(result.blocksCompressed).toBe(0);
    expect(result.text).toContain('"environment": "local"');
  });

  it("returns text unchanged and zero stats when there is no code block", async () => {
    const text = "Just a plain question with no code.";
    const result = await compressFencedBlocks(text);
    expect(result.text).toBe(text);
    expect(result.blocksCompressed).toBe(0);
    expect(result.rawTokens).toBe(0);
  });

  it("handles multiple code blocks in one message", async () => {
    const text = "First:\n```ts a.ts\n" + REAL_FN + "\n```\nSecond:\n```ts b.ts\n" + REAL_FN + "\n```";
    const result = await compressFencedBlocks(text);
    expect(result.blocksCompressed).toBe(2);
    expect(result.irTokens).toBeLessThan(result.rawTokens);
  });
});

describe("compressMessages", () => {
  it("compresses code blocks across an OpenAI-style messages array and reports savings", async () => {
    const messages = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Explain this:\n```ts src/loader.ts\n" + REAL_FN + "\n```" },
    ];
    const result = await compressMessages(messages);

    expect(result.stats.irTokens).toBeLessThan(result.stats.rawTokens);
    expect(result.stats.blocksCompressed).toBe(1);
    expect(result.messages[0].content).toBe("You are a helpful assistant.");
    expect(result.messages[1].content).toContain("FN:loadConfig");
  });

  it("passes through non-string content untouched", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hi" }] as unknown as string },
    ];
    const result = await compressMessages(messages);
    expect(result.messages[0].content).toEqual([{ type: "text", text: "hi" }]);
    expect(result.stats.blocksCompressed).toBe(0);
  });
});

const FN_BLOCK = "```ts a.ts\n" + REAL_FN + "\n```";

describe("compressRequestBody", () => {
  it("compresses the OpenAI shape (messages[].content strings)", async () => {
    const body = {
      model: "gpt-x",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Explain:\n" + FN_BLOCK },
      ],
    };
    const { body: out, stats } = await compressRequestBody(body);
    const o = out as typeof body;
    expect(stats.blocksCompressed).toBe(1);
    expect(stats.irTokens).toBeLessThan(stats.rawTokens);
    expect(o.messages[1].content).toContain("FN:loadConfig");
    expect(o.model).toBe("gpt-x"); // untouched fields preserved
  });

  it("compresses the Anthropic shape (top-level system + content blocks)", async () => {
    const body = {
      model: "claude-x",
      system: "Sys prompt.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Explain:\n" + FN_BLOCK }] },
      ],
    };
    const { body: out, stats } = await compressRequestBody(body);
    const o = out as { messages: { content: { type: string; text: string }[] }[] };
    expect(stats.blocksCompressed).toBe(1);
    expect(o.messages[0].content[0].text).toContain("FN:loadConfig");
  });

  it("does not mutate the original body", async () => {
    const body = { messages: [{ role: "user", content: FN_BLOCK }] };
    const snapshot = JSON.stringify(body);
    await compressRequestBody(body);
    expect(JSON.stringify(body)).toBe(snapshot);
  });

  it("returns non-object bodies untouched", async () => {
    const { body, stats } = await compressRequestBody(null);
    expect(body).toBeNull();
    expect(stats.blocksCompressed).toBe(0);
  });
});
