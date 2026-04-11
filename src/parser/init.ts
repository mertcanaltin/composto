import { Parser, Language } from "web-tree-sitter";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Language as LangType } from "./languages.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let initialized = false;

export interface ParserWithLanguage {
  parser: Parser;
  language: Language;
}

const cache = new Map<LangType, ParserWithLanguage>();

function grammarPath(lang: LangType): string {
  const distPath = resolve(__dirname, "grammars", `tree-sitter-${lang}.wasm`);
  if (existsSync(distPath)) return distPath;
  const devPath = resolve(__dirname, "../../grammars", `tree-sitter-${lang}.wasm`);
  if (existsSync(devPath)) return devPath;
  throw new Error(`Grammar not found for ${lang}`);
}

export async function getParser(lang: LangType): Promise<ParserWithLanguage> {
  if (!initialized) {
    await Parser.init();
    initialized = true;
  }

  const cached = cache.get(lang);
  if (cached) return cached;

  const parser = new Parser();
  const language = await Language.load(grammarPath(lang));
  parser.setLanguage(language);

  const result = { parser, language };
  cache.set(lang, result);
  return result;
}
