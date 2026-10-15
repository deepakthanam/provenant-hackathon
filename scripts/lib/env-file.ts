import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Creates `.env` from `.env.example` when missing. Returns the path. */
export function ensureEnvFile(root: string): string {
  const file = join(root, '.env');
  if (!existsSync(file)) {
    copyFileSync(join(root, '.env.example'), file);
    console.log('created .env from .env.example');
  }
  return file;
}

/** Reads a value from a dotenv file, ignoring inline comments. */
export function readEnvValue(file: string, key: string): string | undefined {
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  if (!line) return undefined;
  const value = line
    .slice(key.length + 1)
    .replace(/\s+#.*$/, '')
    .trim();
  return value === '' ? undefined : value;
}

/** Sets `KEY=value` in a dotenv file, replacing the existing line (and its comment) or appending. */
export function setEnvValue(file: string, key: string, value: string): void {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(file, lines.join('\n'));
}
