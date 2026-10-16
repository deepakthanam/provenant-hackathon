import type { FastifyInstance } from 'fastify';
import type { DisputeIntake } from '../disputes/intake';

/**
 * POST /webhooks/paypal. The body is kept as the exact bytes PayPal sent: signature verification
 * posts it back verbatim, and re-serialising parsed JSON can break the check.
 */
export async function webhookRoutes(app: FastifyInstance, opts: { intake: DisputeIntake }): Promise<void> {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  app.post(
    '/webhooks/paypal',
    {
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        tags: ['webhooks'],
        summary: 'PayPal webhook receiver (CUSTOMER.DISPUTE.*, PAYMENT.CAPTURE.COMPLETED)',
        description:
          'Verifies the PayPal signature (except in mock mode), stores the event once per PayPal event id, then processes it.',
      },
    },
    async (req, reply) => {
      const outcome = await opts.intake.handleWebhook(String(req.body ?? ''), req.headers);
      if (outcome.status === 'rejected') {
        return reply
          .code(outcome.reason.startsWith('signature') ? 401 : 400)
          .send({ error: 'REJECTED', message: outcome.reason, request_id: req.id });
      }
      // 200 for duplicates too: PayPal retries anything else, and we already have the event.
      return { received: true, duplicate: outcome.status === 'duplicate', event_id: outcome.eventId };
    },
  );
}
