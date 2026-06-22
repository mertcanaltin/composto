import { generateL1 } from "../ir/layers.js";
import { estimateTokens } from "../benchmark/tokenizer.js";
import { detectLanguage } from "../parser/languages.js";

/**
 * Transparent context compression for an LLM proxy.
 *
 * Editors (Cursor, etc.) stuff raw file contents into the request as fenced
 * code blocks. We intercept those blocks and swap the raw source for Composto
 * L1 IR before the request reaches the model. generateL1 already keeps the raw
 * source whenever the IR is not a strict token win, so a block is only ever
 * rewritten when it genuinely saves tokens — never silently bloated.
 */

export interface CompressionStats {
  rawTokens: number;
  irTokens: number;
  blocksCompressed: number;
}

export interface CompressResult extends CompressionStats {
  text: string;
}

// Map a bare language fence (```typescript) to a synthetic filename so the AST
// engine can pick the right grammar. Path fences (```ts src/foo.ts) are used
// directly.
const LANG_TO_FILENAME: Record<string, string> = {
  typescript: "snippet.ts",
  ts: "snippet.ts",
  tsx: "snippet.tsx",
  javascript: "snippet.js",
  js: "snippet.js",
  jsx: "snippet.jsx",
  mjs: "snippet.mjs",
  python: "snippet.py",
  py: "snippet.py",
  go: "snippet.go",
  rust: "snippet.rs",
  rs: "snippet.rs",
};

// ```<info>\n<body>\n``` — info is the fence's first-line tokens (language and/
// or a file path). Non-greedy body so adjacent blocks don't merge.
const FENCE = /```([^\n]*)\n([\s\S]*?)\n```/g;

/**
 * Resolve a fence's info string to a filePath the AST engine understands.
 * Returns null when the block is not a supported code language (leave it raw).
 */
function resolveFilePath(info: string): string | null {
  const tokens = info.trim().split(/\s+/).filter(Boolean);

  // Prefer an explicit path token (contains a supported extension).
  for (const tok of tokens) {
    if (tok.includes(".") && detectLanguage(tok)) return tok;
  }

  // Otherwise treat the first token as a language name.
  const lang = tokens[0]?.toLowerCase();
  if (lang && LANG_TO_FILENAME[lang]) return LANG_TO_FILENAME[lang];

  return null;
}

/**
 * Rewrite every fenced code block in `text` to its L1 IR when that saves
 * tokens. rawTokens/irTokens cover only the blocks we attempted to compress
 * (matched, supported language), so the ratio reflects the real in-flight win.
 */
export async function compressFencedBlocks(text: string): Promise<CompressResult> {
  if (typeof text !== "string" || !text.includes("```")) {
    return { text, rawTokens: 0, irTokens: 0, blocksCompressed: 0 };
  }

  let rawTokens = 0;
  let irTokens = 0;
  let blocksCompressed = 0;

  // Collect matches first (regex is stateful; we need async work per match).
  const matches = [...text.matchAll(FENCE)];
  const replacements: { start: number; end: number; value: string }[] = [];

  for (const m of matches) {
    const info = m[1];
    const body = m[2];
    const filePath = resolveFilePath(info);
    if (!filePath) continue; // unsupported language → leave raw

    const ir = await generateL1(body, filePath, null);
    if (ir === body) continue; // generateL1's raw-fallback: not a token win

    rawTokens += estimateTokens(body);
    irTokens += estimateTokens(ir);
    blocksCompressed++;

    const start = m.index ?? 0;
    replacements.push({
      start,
      end: start + m[0].length,
      value: "```" + info + "\n" + ir + "\n```",
    });
  }

  // Apply right-to-left so earlier indices stay valid.
  let out = text;
  for (const r of replacements.reverse()) {
    out = out.slice(0, r.start) + r.value + out.slice(r.end);
  }

  return { text: out, rawTokens, irTokens, blocksCompressed };
}

/**
 * Compress any single content value: a plain string, or an array of content
 * blocks (Anthropic / OpenAI multimodal) where text lives in `.text`. Non-text
 * blocks pass through untouched.
 */
async function compressContent(
  content: unknown,
  stats: CompressionStats
): Promise<unknown> {
  if (typeof content === "string") {
    const r = await compressFencedBlocks(content);
    stats.rawTokens += r.rawTokens;
    stats.irTokens += r.irTokens;
    stats.blocksCompressed += r.blocksCompressed;
    return r.text;
  }
  if (Array.isArray(content)) {
    const out = [];
    for (const block of content) {
      if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
        const r = await compressFencedBlocks((block as { text: string }).text);
        stats.rawTokens += r.rawTokens;
        stats.irTokens += r.irTokens;
        stats.blocksCompressed += r.blocksCompressed;
        out.push({ ...block, text: r.text });
      } else {
        out.push(block);
      }
    }
    return out;
  }
  return content;
}

/**
 * Compress a full chat-completion request body in place (clone). Handles both
 * the OpenAI shape (`messages[].content`) and the Anthropic shape (top-level
 * `system` + `messages[].content`), including string or content-block arrays.
 * Returns the rewritten body and the aggregate token stats.
 */
export async function compressRequestBody(
  body: unknown
): Promise<{ body: unknown; stats: CompressionStats }> {
  const stats: CompressionStats = { rawTokens: 0, irTokens: 0, blocksCompressed: 0 };
  if (!body || typeof body !== "object") return { body, stats };

  const src = body as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  if ("system" in src) {
    out.system = await compressContent(src.system, stats);
  }

  if (Array.isArray(src.messages)) {
    const msgs = [];
    for (const m of src.messages) {
      if (m && typeof m === "object" && "content" in (m as object)) {
        const mm = m as Record<string, unknown>;
        msgs.push({ ...mm, content: await compressContent(mm.content, stats) });
      } else {
        msgs.push(m);
      }
    }
    out.messages = msgs;
  }

  return { body: out, stats };
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface CompressMessagesResult {
  messages: ChatMessage[];
  stats: CompressionStats;
}

/**
 * Compress code blocks across an OpenAI-style messages array. Non-string
 * content (multimodal parts) is passed through untouched.
 */
export async function compressMessages(messages: ChatMessage[]): Promise<CompressMessagesResult> {
  const out: ChatMessage[] = [];
  const stats: CompressionStats = { rawTokens: 0, irTokens: 0, blocksCompressed: 0 };

  for (const msg of messages) {
    if (typeof msg.content !== "string") {
      out.push(msg);
      continue;
    }
    const r = await compressFencedBlocks(msg.content);
    stats.rawTokens += r.rawTokens;
    stats.irTokens += r.irTokens;
    stats.blocksCompressed += r.blocksCompressed;
    out.push({ ...msg, content: r.text });
  }

  return { messages: out, stats };
}
