import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Env } from '@provenant/config';
import type { Db } from '@provenant/db';
import { type BlobStore, BundleStore, type Signer } from '@provenant/evidence';
import { MOCK_PAYPAL_PREFIX, MockPayPal, type PayPalClient } from '@provenant/paypal';
import { mockPayPalRoutes } from '@provenant/paypal/mock-routes';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createAuthenticator } from './auth';
import { DisputeIntake } from './disputes/intake';
import { registerErrorHandler } from './errors';
import { bundleRoutes } from './routes/bundles';
import { disputeRoutes } from './routes/disputes';
import { webhookRoutes } from './routes/webhooks';

declare module 'fastify' {
  interface FastifyInstance {
    intake: DisputeIntake;
  }
}

export interface AppDeps {
  env: Env;
  db: Db;
  signer: Signer;
  blobStore: BlobStore;
  paypal: PayPalClient;
  /** Defaults to `select 1` against `db`; injectable so tests can simulate an outage. */
  pingDb?: () => Promise<boolean>;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.env.NODE_ENV === 'test' ? false : { level: 'info' },
    bodyLimit: 6 * 1024 * 1024,
    genReqId: (req) => {
      const given = req.headers['x-request-id'];
      return typeof given === 'string' && /^[\w.-]{1,64}$/.test(given) ? given : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
  registerErrorHandler(app);

  await app.register(cors, { origin: [deps.env.CONSOLE_PUBLIC_URL] });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Provenant API',
        description: 'Evidence bundles and dispute adjudication for AI-agent purchases on PayPal.',
        version: '0.1.0',
      },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  const pingDb =
    deps.pingDb ??
    (async () => {
      try {
        await deps.db.$client.query('select 1');
        return true;
      } catch {
        return false;
      }
    });

  app.get(
    '/healthz',
    {
      schema: {
        tags: ['ops'],
        summary: 'Liveness and database check',
        response: {
          200: z.object({ status: z.literal('ok'), db: z.literal('ok'), paypal_mode: z.string() }),
          503: z.object({ status: z.literal('degraded'), db: z.literal('down') }),
        },
      },
    },
    async (_req, reply) => {
      if (!(await pingDb())) return reply.code(503).send({ status: 'degraded', db: 'down' });
      return { status: 'ok' as const, db: 'ok' as const, paypal_mode: deps.env.PAYPAL_MODE };
    },
  );

  // In mock mode the server also *is* PayPal: other processes reach the mock over HTTP here.
  if (deps.paypal instanceof MockPayPal) {
    await app.register(mockPayPalRoutes, { prefix: MOCK_PAYPAL_PREFIX, mock: deps.paypal });
  }

  const store = new BundleStore(deps.db, deps.signer, deps.blobStore);
  const authenticate = createAuthenticator(deps.db);
  await app.register(bundleRoutes, { store, paypal: deps.paypal, authenticate });

  const intake = new DisputeIntake({
    db: deps.db,
    paypal: deps.paypal,
    store,
    log: app.log,
    verifySignatures: deps.paypal.mode !== 'mock',
  });
  app.decorate('intake', intake);
  await app.register(webhookRoutes, { intake });
  await app.register(disputeRoutes, { db: deps.db, intake, authenticate });

  return app;
}
