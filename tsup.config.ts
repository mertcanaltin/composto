import { defineConfig } from "tsup";
import { cpSync, mkdirSync, readdirSync } from "node:fs";

export default defineConfig({
  entry: ["src/index.ts", "src/mcp/server.ts", "src/memory/worker.ts", "src/memory/pool.ts", "src/memory/api.ts"],
  format: ["esm"],
  splitting: false,
  dts: false,
  clean: true,
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  onSuccess: async () => {
    mkdirSync("dist/grammars", { recursive: true });
    for (const file of readdirSync("grammars")) {
      if (file.endsWith(".wasm")) {
        cpSync(`grammars/${file}`, `dist/grammars/${file}`);
      }
    }
    // Copy migrations to both dist/migrations (for bundled CLI at dist/index.js)
    // and dist/memory/migrations (for separate API entry point)
    mkdirSync("dist/migrations", { recursive: true });
    mkdirSync("dist/memory/migrations", { recursive: true });
    for (const file of readdirSync("src/memory/migrations")) {
      if (file.endsWith(".sql")) {
        cpSync(`src/memory/migrations/${file}`, `dist/migrations/${file}`);
        cpSync(`src/memory/migrations/${file}`, `dist/memory/migrations/${file}`);
      }
    }
  },
});
