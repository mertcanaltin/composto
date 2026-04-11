import { defineConfig } from "tsup";
import { cpSync, mkdirSync, readdirSync } from "node:fs";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
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
  },
});
