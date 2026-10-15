/** One-time local setup: .env, signing keys, database + migrations. Safe to re-run. */
import { findRepoRoot } from '@provenant/config';
import { ensureEnvFile } from './lib/env-file';
import { ensureSigningKeys } from './lib/keys';
import { bootDatabase } from './lib/stack';

const root = findRepoRoot();
ensureEnvFile(root);
const keys = ensureSigningKeys(root);
console.log(keys === 'created' ? 'generated Ed25519 signing keys' : 'signing keys already present');

const handle = await bootDatabase();
await handle.stop();
console.log(
  '\nsetup complete. Next: `pnpm dev` (or `pnpm demo`). Note: run this as `pnpm bootstrap` - `pnpm setup` is a pnpm built-in.',
);
