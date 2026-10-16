#!/usr/bin/env -S npx tsx
/**
 * Provenant MCP server over stdio. Reads PUBLIC_BASE_URL and the API keys from the repo's .env
 * (or the environment), so `pnpm mcp` works after `pnpm bootstrap`.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { findRepoRoot, loadEnv } from '@provenant/config';
import { createProvenantMcp } from './server';

// MCP hosts start servers from arbitrary directories: anchor on this file to find the repo's .env.
process.chdir(findRepoRoot(dirname(fileURLToPath(import.meta.url))));
const env = loadEnv();
const server = createProvenantMcp({
  baseUrl: process.env.PROVENANT_BASE_URL ?? env.PUBLIC_BASE_URL,
  platformKey: env.PROVENANT_PLATFORM_API_KEY,
  reviewKey: env.PROVENANT_ADMIN_API_KEY ?? env.PROVENANT_MERCHANT_API_KEY,
  dataDir: env.DATA_DIR ?? join(findRepoRoot(), 'data'),
});
await server.connect(new StdioServerTransport());
