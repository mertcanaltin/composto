import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

const REAL_FN = `export function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.environment === "local") { parsed.debug = true; }
  return parsed;
}`;

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, () => resolve((server.address() as AddressInfo).port)));
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe("compression proxy (end-to-end, mock upstream)", () => {
  it("forwards a compressed body upstream and streams the response back", async () => {
    // Mock upstream: capture the received body, echo a canned completion.
    let received = "";
    const upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, echoTokens: received.length }));
      });
    });
    servers.push(upstream);
    const upstreamPort = await listen(upstream);

    process.env.COMPOSTO_UPSTREAM_OPENAI = `http://localhost:${upstreamPort}`;
    const { startProxy } = await import("../../src/proxy/server.js");
    const proxy = startProxy(0);
    servers.push(proxy);
    await new Promise((r) => proxy.once("listening", r));
    const proxyPort = (proxy.address() as AddressInfo).port;

    const reqBody = {
      model: "gpt-x",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Explain:\n```ts src/loader.ts\n" + REAL_FN + "\n```" },
      ],
    };
    const rawLen = JSON.stringify(reqBody).length;

    const resp = await fetch(`http://localhost:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
      body: JSON.stringify(reqBody),
    });
    const json = await resp.json();

    // Response streamed back from the mock upstream.
    expect(resp.status).toBe(200);
    expect(json.ok).toBe(true);

    // Upstream received IR, not raw source, and a smaller payload.
    expect(received).toContain("FN:loadConfig");
    expect(received).not.toContain("readFileSync(path");
    expect(received.length).toBeLessThan(rawLen);
  });

  it("passes a body with no code blocks through unchanged", async () => {
    let received = "";
    const upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    servers.push(upstream);
    const upstreamPort = await listen(upstream);

    process.env.COMPOSTO_UPSTREAM_OPENAI = `http://localhost:${upstreamPort}`;
    const { startProxy } = await import("../../src/proxy/server.js");
    const proxy = startProxy(0);
    servers.push(proxy);
    await new Promise((r) => proxy.once("listening", r));
    const proxyPort = (proxy.address() as AddressInfo).port;

    const body = { model: "gpt-x", messages: [{ role: "user", content: "just a question" }] };
    await fetch(`http://localhost:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(JSON.parse(received)).toEqual(body);
  });
});
