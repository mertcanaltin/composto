import { describe, it, expect } from "vitest";
import { generateAstIR } from "../../src/parser/ast-ir.js";

describe("generateAstIR", () => {
  it("generates IR for TypeScript code", async () => {
    const code = `
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Config {
  name: string;
  enabled: boolean;
}

export function loadConfig(path: string): Config {
  const data = readFileSync(path, "utf-8");
  if (!data) return { name: "", enabled: false };
  return JSON.parse(data);
}

function validate(config: Config): boolean {
  if (!config.name) return false;
  return config.enabled;
}
`.trim();

    const ir = await generateAstIR(code, "config.ts");
    expect(ir).not.toBeNull();
    expect(ir).toContain("USE:");
    expect(ir).toContain("FN:loadConfig");
    expect(ir).toContain("FN:validate");
    expect(ir).toContain("IF:");
    expect(ir).toContain("RET");
    expect(ir!.length).toBeLessThan(code.length * 0.8);
  });

  it("generates IR for Python code", async () => {
    const code = `
import os
from pathlib import Path

class FileProcessor:
    def __init__(self, root):
        self.root = Path(root)

    def process(self, name):
        path = self.root / name
        if not path.exists():
            return False
        return True

def main():
    processor = FileProcessor("/tmp")
    processor.process("test.txt")
`.trim();

    const ir = await generateAstIR(code, "processor.py");
    expect(ir).not.toBeNull();
    expect(ir).toContain("USE:");
    expect(ir).toContain("CLASS:FileProcessor");
    expect(ir).toContain("FN:process");
    expect(ir).toContain("FN:main");
  });

  it("generates IR for Go code", async () => {
    const code = `
package main

import (
    "fmt"
    "os"
)

type Server struct {
    Port int
    Host string
}

func NewServer(host string, port int) *Server {
    return &Server{Host: host, Port: port}
}

func (s *Server) Start() error {
    if s.Port <= 0 {
        return fmt.Errorf("invalid port")
    }
    fmt.Printf("Starting on %s:%d", s.Host, s.Port)
    return nil
}
`.trim();

    const ir = await generateAstIR(code, "server.go");
    expect(ir).not.toBeNull();
    expect(ir).toContain("TYPE:Server");
    expect(ir).toContain("FN:NewServer");
    expect(ir).toContain("FN:Start");
  });

  it("generates IR for Rust code", async () => {
    const code = `
use std::fs;
use std::path::Path;

pub struct Config {
    pub name: String,
    pub debug: bool,
}

impl Config {
    pub fn load(path: &Path) -> Result<Self, String> {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        if content.is_empty() {
            return Err("empty config".to_string());
        }
        Ok(Config { name: content, debug: false })
    }
}
`.trim();

    const ir = await generateAstIR(code, "config.rs");
    expect(ir).not.toBeNull();
    expect(ir).toContain("USE:");
    expect(ir).toContain("STRUCT:Config");
    expect(ir).toContain("IMPL:Config");
    expect(ir).toContain("FN:load");
  });

  it("preserves generic type parameters on classes", async () => {
    const code = 'export class Repository<T extends Entity> {\n  find(id: string): T { return {} as T; }\n}';
    const ir = await generateAstIR(code, "repo.ts");
    expect(ir).toContain("Repository<T extends Entity>");
  });

  it("preserves generic type parameters on interfaces", async () => {
    const code = "interface Response<T> {\n  data: T;\n  status: number;\n}";
    const ir = await generateAstIR(code, "types.ts");
    expect(ir).toContain("Response<T>");
  });

  it("returns null for unsupported languages", async () => {
    const ir = await generateAstIR("body { color: red; }", "style.css");
    expect(ir).toBeNull();
  });
});
