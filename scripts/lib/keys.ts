import { generateKeyPairSync } from 'node:crypto';
import { ensureEnvFile, readEnvValue, setEnvValue } from './env-file';

export function generateSigningKeys(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const b64 = (pem: string) => Buffer.from(pem).toString('base64');
  return {
    privateKey: b64(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
    publicKey: b64(publicKey.export({ type: 'spki', format: 'pem' }).toString()),
  };
}

export function ensureSigningKeys(root: string, force = false): 'created' | 'kept' {
  const file = ensureEnvFile(root);
  if (!force && readEnvValue(file, 'PROVENANT_SIGNING_PRIVATE_KEY')) return 'kept';
  const keys = generateSigningKeys();
  setEnvValue(file, 'PROVENANT_SIGNING_PRIVATE_KEY', keys.privateKey);
  setEnvValue(file, 'PROVENANT_SIGNING_PUBLIC_KEY', keys.publicKey);
  return 'created';
}
