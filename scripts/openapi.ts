/** `pnpm openapi` — writes the API's OpenAPI document to docs/openapi.json (no server or DB needed). */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { envSchema, findRepoRoot } from '@provenant/config';
import { createDb } from '@provenant/db';
import { generateKeyPairB64, LocalBlobStore, Signer } from '@provenant/evidence';
import { MockPayPal } from '@provenant/paypal';
import { buildApp } from '../apps/server/src/app';

const env = envSchema.parse({ NODE_ENV: 'production' });
const db = createDb('postgres://unused@localhost:1/unused', { max: 1 });
const app = await buildApp({
  env,
  db,
  signer: Signer.fromB64(generateKeyPairB64().privateKey),
  blobStore: new LocalBlobStore(join(findRepoRoot(), 'data')),
  paypal: new MockPayPal({ db, baseUrl: 'http://localhost/mock-paypal' }),
});
await app.ready();
const spec = app.swagger();
const file = join(findRepoRoot(), 'docs', 'openapi.json');
writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`wrote ${file} (${Object.keys((spec as { paths: object }).paths).length} paths)`);
await app.close();
await db.$client.end();
