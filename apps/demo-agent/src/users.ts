import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairB64 } from '@provenant/sdk';

export interface DemoUser {
  userRef: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Demo stand-in for a user's wallet key. In production the user's device (or an AP2 credential
 * provider) holds this key and signs mandates; the agent never sees it.
 */
export function loadOrCreateUser(dataDir: string, userRef: string): DemoUser {
  const dir = join(dataDir, 'agent-users');
  const file = join(dir, `${userRef}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as DemoUser;
  mkdirSync(dir, { recursive: true });
  const keys = generateKeyPairB64();
  const user = { userRef, publicKey: keys.publicKey, privateKey: keys.privateKey };
  writeFileSync(file, JSON.stringify(user, null, 2), { mode: 0o600 });
  return user;
}
