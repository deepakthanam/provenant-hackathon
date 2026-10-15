import { loadEnv } from '@provenant/config';
import Fastify from 'fastify';

// M0 placeholder: the catalog, product pages and "wrong item" switch arrive in M3.
const env = loadEnv();
const app = Fastify({ logger: { level: 'info' } });

app.get('/healthz', async () => ({ status: 'ok' }));
app.get('/', async (_req, reply) =>
  reply.type('text/html').send('<h1>Provenant demo store</h1><p>Catalog coming in M3.</p>'),
);

await app.listen({ port: env.DEMO_STORE_PORT, host: '0.0.0.0' });
