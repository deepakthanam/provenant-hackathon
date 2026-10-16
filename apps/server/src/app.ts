import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { type Env, findRepoRoot } from '@provenant/config';
import type { Db } from '@provenant/db';
import { type BlobStore, BundleStore, type Signer } from '@provenant/evidence';
import type { LlmProvider } from '@provenant/llm';
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
import { ActionExecutor } from './disputes/actions';
import { AdjudicationService } from './disputes/adjudication';
import { DisputeIntake } from './disputes/intake';
import { registerErrorHandler } from './errors';
import { bundleRoutes } from './routes/bundles';
import { devRoutes } from './routes/dev';
import { disputeRoutes } from './routes/disputes';
import { liabilityRoutes } from './routes/liability';
import { webhookRoutes } from './routes/webhooks';

declare module 'fastify' {
  interface FastifyInstance {
    intake: DisputeIntake;
    adjudication: AdjudicationService;
    executor: ActionExecutor;
  }
}

export interface AppDeps {
  env: Env;
  db: Db;
  signer: Signer;
  blobStore: BlobStore;
  paypal: PayPalClient;
  /** Overrides the LLM chosen from env (tests inject hostile or failing models). */
  llm?: LlmProvider;
  /** Defaults to `select 1` against `db`; injectable so tests can simulate an outage. */
  pingDb?: () => Promise<boolean>;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      deps.env.NODE_ENV === 'test'
        ? false
        : {
            level: 'info',
            // Structured JSON with request ids; never credentials or signatures. Bodies are not logged.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers["paypal-auth-assertion"]',
                'req.headers["paypal-transmission-sig"]',
                'req.headers.cookie',
              ],
              censor: '[redacted]',
            },
          },
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
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
  });
  registerErrorHandler(app);

  await app.register(cors, { origin: [deps.env.CONSOLE_PUBLIC_URL] });
  // Opt-in per route: only the unauthenticated surfaces (receipt, blobs, webhooks, mock buyer) are limited.
  await app.register(rateLimit, { global: false });
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

  const adjudication = new AdjudicationService({
    db: deps.db,
    store,
    paypal: deps.paypal,
    env: deps.env,
    log: app.log,
    llm: deps.llm,
  });
  const intake = new DisputeIntake({
    db: deps.db,
    paypal: deps.paypal,
    store,
    log: app.log,
    verifySignatures: deps.paypal.mode !== 'mock',
    // Every change PayPal reports is (re)adjudicated; identical inputs are a no-op.
    onDisputeChanged: (id) =>
      adjudication
        .adjudicate(id)
        .then(() => undefined)
        .catch((e: unknown) =>
          app.log.error(
            { disputeId: id, err: e instanceof Error ? e.message : String(e) },
            'adjudication failed',
          ),
        ),
  });
  app.decorate('intake', intake);
  app.decorate('adjudication', adjudication);
  await app.register(webhookRoutes, { intake });
  const executor = new ActionExecutor({
    db: deps.db,
    paypal: deps.paypal,
    adjudication,
    intake,
    log: app.log,
  });
  app.decorate('executor', executor);
  if (deps.env.AUTO_ACTION) {
    // Act without a human, but only on a confident, actionable verdict.
    adjudication.onVerdict = async (v) => {
      const plan = v.recommendedAction as { kind: string; available: boolean };
      if (v.verdict === 'INSUFFICIENT_EVIDENCE' || plan.kind === 'none' || !plan.available) return;
      await executor
        .approve(v.disputeId, { approvedBy: 'auto' })
        .catch((e: unknown) =>
          app.log.warn(
            { disputeId: v.disputeId, err: e instanceof Error ? e.message : String(e) },
            'auto action not executed',
          ),
        );
    };
  }
  await app.register(disputeRoutes, {
    db: deps.db,
    intake,
    adjudication,
    executor,
    paypal: deps.paypal,
    // The live API rejects sandbox-only calls; expose the helpers for the mock and the sandbox only.
    sandboxHelpers: deps.paypal.mode === 'mock' || deps.env.PAYPAL_API_BASE.includes('sandbox'),
    authenticate,
  });
  await app.register(liabilityRoutes, { db: deps.db, authenticate });
  if (deps.env.NODE_ENV !== 'production' && deps.paypal.mode === 'mock') {
    await app.register(devRoutes, {
      db: deps.db,
      dataDir: deps.env.DATA_DIR ?? join(findRepoRoot(), 'data'),
      authenticate,
    });
  }

  return app;
}
