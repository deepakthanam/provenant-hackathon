/**
 * Generates the Ed25519 keypair Provenant signs bundle events with.
 *   pnpm keygen          write keys into .env if they are empty
 *   pnpm keygen --force  overwrite existing keys (old bundles will no longer verify)
 *   pnpm keygen --print  print keys without touching .env
 */
import { findRepoRoot } from '@provenant/config';
import { ensureSigningKeys, generateSigningKeys } from './lib/keys';

const args = new Set(process.argv.slice(2));
if (args.has('--print')) {
  const keys = generateSigningKeys();
  console.log(`PROVENANT_SIGNING_PRIVATE_KEY=${keys.privateKey}`);
  console.log(`PROVENANT_SIGNING_PUBLIC_KEY=${keys.publicKey}`);
} else {
  const result = ensureSigningKeys(findRepoRoot(), args.has('--force'));
  console.log(
    result === 'created'
      ? 'wrote a new Ed25519 signing keypair to .env'
      : 'signing keys already set in .env (use --force to replace them)',
  );
}
