/** One-time local setup: .env, signing keys, API keys, database + migrations + seed. Safe to re-run. */
import { findRepoRoot, loadEnv } from '@provenant/config';
import { createDb } from '@provenant/db';
import { seedDemo } from '@provenant/db/seed';
import { ensureEnvFile } from './lib/env-file';
import { ensureApiKeys, ensureSigningKeys } from './lib/keys';
import { bootDatabase } from './lib/stack';

const root = findRepoRoot();
ensureEnvFile(root);
const keys = ensureSigningKeys(root);
console.log(keys === 'created' ? 'generated Ed25519 signing keys' : 'signing keys already present');
const apiKeys = ensureApiKeys(root);
if (apiKeys.length) console.log(`generated API keys: ${apiKeys.join(', ')}`);

const handle = await bootDatabase();
const env = loadEnv({ reload: true });
const db = createDb(env.DATABASE_URL, { max: 1 });
await seedDemo(db, {
  admin: env.PROVENANT_ADMIN_API_KEY,
  platform: env.PROVENANT_PLATFORM_API_KEY,
  merchant: env.PROVENANT_MERCHANT_API_KEY,
});
await db.$client.end();
console.log('[postgres] demo platform, merchant and API keys seeded');
await handle.stop();

console.log('\nsetup complete. Next: `pnpm dev` (or `pnpm demo`).');
console.log('Note: run setup as `pnpm bootstrap`; `pnpm setup` is a pnpm built-in.');
