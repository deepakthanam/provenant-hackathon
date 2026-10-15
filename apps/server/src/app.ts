import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Env } from '@provenant/config';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

export interface AppDeps {
  env: Env;
  /** Returns true when the database answers. Injected so tests can run without Postgres. */
  pingDb: () => Promise<boolean>;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.env.NODE_ENV === 'test' ? false : { level: 'info' },
    bodyLimit: 5 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: [deps.env.CONSOLE_PUBLIC_URL] });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Provenant API',
        description: 'Evidence bundles and dispute adjudication for AI-agent purchases on PayPal.',
        version: '0.1.0',
      },
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

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
      if (!(await deps.pingDb())) return reply.code(503).send({ status: 'degraded', db: 'down' });
      return { status: 'ok' as const, db: 'ok' as const, paypal_mode: deps.env.PAYPAL_MODE };
    },
  );

  return app;
}
