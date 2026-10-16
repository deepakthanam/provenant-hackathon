import { EvidenceError } from '@provenant/evidence';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const EVIDENCE_STATUS: Record<EvidenceError['code'], number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  INVALID_SIGNATURE: 422,
  UNKNOWN_USER: 422,
};

/** One JSON error shape everywhere: { error, message, request_id, details? }. Internals never leak. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    const base = { request_id: req.id };
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: 'VALIDATION_FAILED',
        message: 'request did not match the schema',
        details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        ...base,
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, ...base });
    }
    if (err instanceof EvidenceError) {
      return reply.code(EVIDENCE_STATUS[err.code]).send({ error: err.code, message: err.message, ...base });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ error: (err as FastifyError).code ?? 'BAD_REQUEST', message: err.message, ...base });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL', message: 'internal error', ...base });
  });

  app.setNotFoundHandler((req, reply) =>
    reply
      .code(404)
      .send({ error: 'NOT_FOUND', message: `no route for ${req.method} ${req.url}`, request_id: req.id }),
  );
}
