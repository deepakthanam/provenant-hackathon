import { createServer } from 'node:net';
import { loadEnv } from '@provenant/config';
import { createTestDatabase, type TestDatabase } from '@provenant/db/testing';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, inject } from 'vitest';
import { directBuyer, httpBuyer } from '../src/buyer';
import { HttpPayPal } from '../src/http';
import { MockPayPal } from '../src/mock';
import { mockPayPalRoutes } from '../src/mock-routes';
import { contractSuite } from './contract';

let tdb: TestDatabase;
let direct: MockPayPal;
let app: FastifyInstance;
let viaHttp: HttpPayPal;
let mockBase = '';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  tdb = await createTestDatabase(inject('databaseUrl'));
  direct = new MockPayPal({ db: tdb.db, baseUrl: 'http://mock.local/mock-paypal' });

  const port = await freePort();
  mockBase = `http://127.0.0.1:${port}/mock-paypal`;
  const served = new MockPayPal({ db: tdb.db, baseUrl: mockBase });
  app = Fastify();
  await app.register(mockPayPalRoutes, { prefix: '/mock-paypal', mock: served });
  await app.listen({ port, host: '127.0.0.1' });
  viaHttp = new HttpPayPal({ baseUrl: mockBase, clientId: 'mock', clientSecret: 'mock', mode: 'mock' });
});

afterAll(async () => {
  await app?.close();
  await tdb?.drop();
});

contractSuite({
  name: 'MockPayPal (in-process)',
  client: () => direct,
  buyer: () => directBuyer(direct),
  hasBuyer: true,
});

contractSuite({
  name: 'HttpPayPal → MockPayPal over HTTP',
  client: () => viaHttp,
  buyer: () => httpBuyer(mockBase),
  hasBuyer: true,
});

// The real sandbox: runs only when credentials are present. Buyer approval needs a human, so
// buyer-dependent cases are skipped; order creation, patching, capture refusal and listing run.
const env = loadEnv();
const sandbox =
  env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET
    ? new HttpPayPal({
        baseUrl: env.PAYPAL_API_BASE,
        clientId: env.PAYPAL_CLIENT_ID,
        clientSecret: env.PAYPAL_CLIENT_SECRET,
        mode: 'sandbox',
      })
    : null;
contractSuite({
  name: 'HttpPayPal → PayPal sandbox',
  client: () => sandbox!,
  buyer: () => null,
  hasBuyer: false,
  skip: sandbox === null,
});
