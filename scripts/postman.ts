/**
 * `pnpm postman` — fills the Postman environment from .env (into a gitignored copy) and runs the
 * collection with Newman against the running local stack (`pnpm dev`, mock mode).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot, loadEnv } from '@provenant/config';

const root = findRepoRoot();
const env = loadEnv();
if (env.PAYPAL_MODE !== 'mock') {
  console.error('The Postman flow drives the mock buyer; run it with PAYPAL_MODE=mock.');
  process.exit(1);
}
const template = JSON.parse(
  readFileSync(join(root, 'postman', 'provenant.local.postman_environment.json'), 'utf8'),
) as {
  values: Array<{ key: string; value: string }>;
};
const fill: Record<string, string | undefined> = {
  baseUrl: env.PUBLIC_BASE_URL,
  paypalBase: `${env.PUBLIC_BASE_URL}/mock-paypal`,
  platformKey: env.PROVENANT_PLATFORM_API_KEY,
  merchantKey: env.PROVENANT_MERCHANT_API_KEY,
  adminKey: env.PROVENANT_ADMIN_API_KEY,
};
for (const v of template.values) v.value = fill[v.key] ?? v.value;
mkdirSync(join(root, 'data'), { recursive: true });
const envFile = join(root, 'data', 'postman.env.json');
writeFileSync(envFile, JSON.stringify(template, null, 2));

const r = spawnSync(
  'newman',
  ['run', join(root, 'postman', 'provenant.postman_collection.json'), '-e', envFile, '--color', 'on'],
  {
    stdio: 'inherit',
    shell: true,
  },
);
process.exit(r.status ?? 1);
