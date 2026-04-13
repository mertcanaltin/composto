#!/usr/bin/env node
// Shim: delegates to composto-ai's MCP server.
// Allows `npx composto-mcp` to work without requiring a global install.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const serverPath = require.resolve('composto-ai/dist/mcp/server.js');
await import(serverPath);
