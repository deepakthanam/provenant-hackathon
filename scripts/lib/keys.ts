import { generateApiKey } from '@provenant/db/seed';
import { generateKeyPairB64 } from '@provenant/evidence/crypto';
import { ensureEnvFile, readEnvValue, setEnvValue } from './env-file';

export const generateSigningKeys = generateKeyPairB64;

export function ensureSigningKeys(root: string, force = false): 'created' | 'kept' {
  const file = ensureEnvFile(root);
  if (!force && readEnvValue(file, 'PROVENANT_SIGNING_PRIVATE_KEY')) return 'kept';
  const keys = generateSigningKeys();
  setEnvValue(file, 'PROVENANT_SIGNING_PRIVATE_KEY', keys.privateKey);
  setEnvValue(file, 'PROVENANT_SIGNING_PUBLIC_KEY', keys.publicKey);
  return 'created';
}

/** Fills empty API key slots in .env with fresh random keys. Returns the names it generated. */
export function ensureApiKeys(root: string): string[] {
  const file = ensureEnvFile(root);
  const slots = [
    ['PROVENANT_ADMIN_API_KEY', 'admin'],
    ['PROVENANT_PLATFORM_API_KEY', 'platform'],
    ['PROVENANT_MERCHANT_API_KEY', 'merchant'],
  ] as const;
  const created: string[] = [];
  for (const [name, kind] of slots) {
    if (readEnvValue(file, name)) continue;
    setEnvValue(file, name, generateApiKey(kind));
    created.push(name);
  }
  return created;
}
