import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { compressRequestBody } from "./compress-context.js";

/**
 * Transparent compression proxy. Point an editor's custom base URL at this
 * server; it swaps raw code blocks in the request for Composto IR before
 * forwarding to the real LLM API, then streams the response straight back.
 *
 * Routing by path (override with env):
 *   /v1/messages          -> Anthropic   (COMPOSTO_UPSTREAM_ANTHROPIC)
 *   /v1/chat/completions  -> OpenAI       (COMPOSTO_UPSTREAM_OPENAI)
 *   anything else         -> OpenAI base, passthrough
 */

// Hop-by-hop / recomputed headers we must not forward verbatim.
const STRIP_REQ_HEADERS = new Set(["host", "content-length", "connection", "accept-encoding"]);

// Resolved per request so env / reconfiguration take effect without a restart.
function upstreamFor(path: string): string {
  if (path.startsWith("/v1/messages")) {
    return process.env.COMPOSTO_UPSTREAM_ANTHROPIC ?? "https://api.anthropic.com";
  }
  return process.env.COMPOSTO_UPSTREAM_OPENAI ?? "https://api.openai.com";
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function pct(from: number, to: number): string {
  if (from === 0) return "0%";
  return "-" + Math.round((100 * (from - to)) / from) + "%";
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = req.url ?? "/";
  const base = upstreamFor(path);
  const target = base + path;

  const raw = await readBody(req);

  // Only compress JSON POST bodies; everything else is a clean passthrough.
  let outBody: Buffer = raw;
  let logLine = `${req.method} ${path}`;
  if (req.method === "POST" && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw.toString("utf8"));
      const { body, stats } = await compressRequestBody(parsed);
      if (stats.blocksCompressed > 0) {
        outBody = Buffer.from(JSON.stringify(body), "utf8");
        logLine += `  blocks=${stats.blocksCompressed}  ${stats.rawTokens}->${stats.irTokens} tok (${pct(stats.rawTokens, stats.irTokens)})`;
      } else {
        logLine += "  (no code blocks)";
      }
    } catch {
      logLine += "  (non-JSON, passthrough)";
    }
  }
  process.stderr.write(`[composto-proxy] ${logLine}\n`);

  // Forward headers, fixing up the ones we changed.
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (STRIP_REQ_HEADERS.has(k.toLowerCase()) || v == null) continue;
    headers[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  headers["content-length"] = String(outBody.length);

  let upstream: Response;
  try {
    upstream = await fetch(target, { method: req.method, headers, body: outBody });
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { type: "composto_proxy_error", message: String(err) } }));
    return;
  }

  // Mirror status + headers, then stream the body through unchanged (SSE-safe).
  const resHeaders: Record<string, string> = {};
  upstream.headers.forEach((v, k) => {
    if (k.toLowerCase() === "content-encoding" || k.toLowerCase() === "content-length") return;
    resHeaders[k] = v;
  });
  res.writeHead(upstream.status, resHeaders);

  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

export function startProxy(port: number): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      process.stderr.write(`[composto-proxy] Fatal: ${err}\n`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.listen(port, () => {
    const actual = (server.address() as { port?: number } | null)?.port ?? port;
    process.stderr.write(
      `[composto-proxy] listening on http://localhost:${actual}\n` +
        `  OpenAI base URL   -> http://localhost:${actual}/v1\n` +
        `  Anthropic base URL-> http://localhost:${actual}\n` +
        `  upstreams: openai=${upstreamFor("/v1/chat/completions")} anthropic=${upstreamFor("/v1/messages")}\n`
    );
  });
  return server;
}

// Entry point is the `composto proxy` CLI command (src/index.ts), not this
// module — no auto-start guard here. A guard based on argv/import.meta.url is
// unsafe once tsup bundles this file into dist/index.js, where both resolve to
// the same path and would start the proxy on every CLI invocation.
