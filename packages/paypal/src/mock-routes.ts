import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PayPalError } from './errors';
import type { MockPayPal } from './mock';
import type { AcceptClaimInput, DisputeReason, DisputeStage, EvidenceFile } from './types';

const ACCEPTED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif']);

/**
 * Serves MockPayPal over HTTP with PayPal's paths and JSON shapes, so other processes (the demo
 * agent, scenarios, Postman) drive it through the same HttpPayPal client used for the real sandbox.
 * Register with a prefix, e.g. `/mock-paypal`. Buyer-side simulation lives under `/_buyer`.
 */
export async function mockPayPalRoutes(app: FastifyInstance, opts: { mock: MockPayPal }): Promise<void> {
  const { mock } = opts;
  // Keep the fake PayPal out of Provenant's OpenAPI document.
  app.addHook('onRoute', (route) => {
    route.schema = { ...route.schema, hide: true } as typeof route.schema;
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 10 } });
  // The OAuth token call is form-encoded (grant_type=client_credentials).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
    done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );

  // PayPal-Request-Id idempotency: a retried POST returns the first response instead of acting twice.
  const seen = new Map<string, { status: number; body: unknown }>();

  app.setErrorHandler((err: Error, _req, reply) => {
    if (err instanceof PayPalError) {
      return reply
        .code(err.status)
        .header('paypal-debug-id', err.debugId ?? '')
        .send({
          name: err.errorName,
          message: err.message.replace(/^\w+: /, '').replace(/ \(debug_id .*\)$/, ''),
          debug_id: err.debugId,
          details: err.details,
        });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply
      .code(status)
      .send({ name: status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_SERVER_ERROR', message: err.message });
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url.endsWith('/v1/oauth2/token') || req.url.includes('/_buyer/')) return;
    if (!/^Bearer\s+mock-/.test(req.headers.authorization ?? '')) {
      return reply
        .code(401)
        .send({ error: 'invalid_token', error_description: 'Token signature verification failed' });
    }
  });

  const idem = async <T>(req: FastifyRequest, reply: FastifyReply, status: number, run: () => Promise<T>) => {
    const key = req.headers['paypal-request-id'];
    const k = typeof key === 'string' ? `${req.method} ${req.url} ${key}` : null;
    const hit = k ? seen.get(k) : undefined;
    if (hit) return reply.code(hit.status).send(hit.body);
    const body = await run();
    if (k) seen.set(k, { status, body });
    if (seen.size > 5000) seen.delete(seen.keys().next().value!);
    return reply.code(status).send(body);
  };

  /** Reads PayPal's multipart convention (`input` JSON + files) or a plain JSON body. */
  async function readInput(
    req: FastifyRequest,
  ): Promise<{ input: Record<string, unknown>; files: EvidenceFile[] }> {
    if (!req.isMultipart()) return { input: (req.body as Record<string, unknown>) ?? {}, files: [] };
    let input: Record<string, unknown> = {};
    const files: EvidenceFile[] = [];
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const bytes = await part.toBuffer();
        if (part.fieldname === 'input') input = JSON.parse(bytes.toString('utf8'));
        else if (ACCEPTED_TYPES.has(part.mimetype)) {
          files.push({
            name: part.filename,
            contentType: part.mimetype as EvidenceFile['contentType'],
            bytes,
          });
        } else
          throw new PayPalError(
            422,
            'UNPROCESSABLE_ENTITY',
            `unsupported file type ${part.mimetype}`,
            undefined,
          );
      } else if (part.fieldname === 'input') {
        input = JSON.parse(String(part.value));
      }
    }
    return { input, files };
  }

  type IdParams = { Params: { id: string } };

  // ---------------------------------------------------------------- OAuth
  app.post('/v1/oauth2/token', async () => ({
    scope:
      'https://uri.paypal.com/services/disputes/read-seller https://uri.paypal.com/services/disputes/update-seller',
    access_token: `mock-${crypto.randomUUID()}`,
    token_type: 'Bearer',
    app_id: 'APP-MOCK',
    expires_in: 32400,
    nonce: crypto.randomUUID(),
  }));

  // ---------------------------------------------------------------- Orders v2
  app.post('/v2/checkout/orders', (req, reply) =>
    idem(req, reply, 201, async () => {
      const b = req.body as {
        purchase_units: Array<Record<string, any>>;
        payment_source?: Record<string, unknown>;
      };
      const pu = b.purchase_units?.[0] ?? {};
      const { breakdown: _b, ...amount } = pu.amount ?? {};
      return mock.createOrder({
        custom_id: pu.custom_id,
        invoice_id: pu.invoice_id,
        description: pu.description,
        amount,
        items: pu.items,
        payment_source: b.payment_source && 'card' in b.payment_source ? b.payment_source : undefined,
      });
    }),
  );
  app.get<IdParams>('/v2/checkout/orders/:id', (req) => mock.getOrder(req.params.id));
  app.patch<IdParams>('/v2/checkout/orders/:id', async (req, reply) => {
    const ops = req.body as Array<{ op: string; path: string; value?: string }>;
    for (const op of ops) {
      if (
        !/custom_id$/.test(op.path) ||
        !['add', 'replace'].includes(op.op) ||
        typeof op.value !== 'string'
      ) {
        throw new PayPalError(
          422,
          'UNPROCESSABLE_ENTITY',
          `mock supports only add/replace of custom_id, got ${op.op} ${op.path}`,
          undefined,
        );
      }
      await mock.setOrderCustomId(req.params.id, op.value);
    }
    return reply.code(204).send();
  });
  app.post<IdParams>('/v2/checkout/orders/:id/capture', (req, reply) =>
    idem(req, reply, 201, () => mock.captureOrder(req.params.id)),
  );
  app.post<IdParams>('/v2/checkout/orders/:id/track', (req, reply) =>
    idem(req, reply, 201, () => mock.addTracking(req.params.id, req.body as never)),
  );

  // ---------------------------------------------------------------- Disputes v1
  app.get('/v1/customer/disputes', async (req) => {
    const q = req.query as Record<string, string>;
    const r = await mock.listDisputes({ ...q, page_size: q.page_size ? Number(q.page_size) : undefined });
    const links = [{ href: `${req.protocol}://${req.host}${req.url}`, rel: 'self', method: 'GET' }];
    if (r.next_page_token) {
      const next = new URL(`${req.protocol}://${req.host}${req.url}`);
      next.searchParams.set('next_page_token', r.next_page_token);
      links.push({ href: next.toString(), rel: 'next', method: 'GET' });
    }
    return { items: r.items, links };
  });
  app.get<IdParams>('/v1/customer/disputes/:id', (req) => mock.getDispute(req.params.id));
  app.get<{ Params: { id: string; doc: string } }>(
    '/v1/customer/disputes/:id/documents/:doc',
    async (req, reply) => {
      const d = await mock.downloadDocument(req.url);
      return reply.type(d.contentType).send(Buffer.from(d.bytes));
    },
  );

  app.post('/v1/customer/disputes', (req, reply) =>
    idem(req, reply, 201, async () => {
      const { input } = await readInput(req);
      const tx = (input.disputed_transactions as Array<{ buyer_transaction_id: string }>)?.[0];
      const d = await mock.sandboxCreateDispute({
        buyer_transaction_id: tx?.buyer_transaction_id ?? '',
        reason: input.reason as DisputeReason,
        dispute_amount: input.dispute_amount as never,
      });
      return {
        links: [
          { href: `${req.protocol}://${req.host}${req.url}/${d.dispute_id}`, rel: 'self', method: 'GET' },
        ],
      };
    }),
  );

  const action = (
    path: string,
    run: (id: string, input: Record<string, any>, files: EvidenceFile[]) => Promise<unknown>,
  ) =>
    app.post<IdParams>(`/v1/customer/disputes/:id/${path}`, (req, reply) =>
      idem(req, reply, 200, async () => {
        const { input, files } = await readInput(req);
        const r = (await run(req.params.id, input, files)) as { links?: unknown };
        return { links: r.links };
      }),
    );
  action('provide-evidence', (id, i, files) =>
    mock.provideEvidence(id, { evidences: i.evidences ?? [], files }),
  );
  action('make-offer', (id, i) => mock.makeOffer(id, i as never));
  action('send-message', (id, i, files) => mock.sendMessage(id, String(i.message ?? ''), files));
  action('accept-claim', (id, i, files) => mock.acceptClaim(id, { ...(i as AcceptClaimInput), files }));
  action('provide-supporting-info', (id, i, files) =>
    mock.provideSupportingInfo(id, { notes: String(i.notes ?? ''), files }),
  );
  action('require-evidence', (id, i) => mock.sandboxRequireEvidence(id, i.action));
  action('adjudicate', (id, i) => mock.sandboxAdjudicate(id, i.adjudication_outcome));
  action('escalate', async (id) => ({ links: (await mock.buyerEscalate(id)).links }));

  // ---------------------------------------------------------------- Webhooks
  app.post('/v1/notifications/verify-webhook-signature', async () => ({ verification_status: 'SUCCESS' }));

  // ---------------------------------------------------------------- buyer simulation (mock only)
  app.post<IdParams>('/_buyer/orders/:id/approve', (req) => mock.buyerApproveOrder(req.params.id));
  app.get<IdParams>('/_buyer/orders/:id/approve', async (req, reply) => {
    await mock.buyerApproveOrder(req.params.id);
    return reply.type('text/html').send('<p>Mock PayPal: order approved. You can close this tab.</p>');
  });
  app.post('/_buyer/disputes', async (req, reply) => {
    const b = req.body as {
      capture_id: string;
      reason: DisputeReason;
      message: string;
      stage?: DisputeStage;
      amount?: never;
      documents?: Array<{ name: string; content_type: EvidenceFile['contentType']; base64: string }>;
    };
    const d = await mock.buyerOpenDispute({
      capture_id: b.capture_id,
      reason: b.reason,
      message: b.message,
      stage: b.stage,
      amount: b.amount,
      documents: b.documents?.map((x) => ({
        name: x.name,
        contentType: x.content_type,
        bytes: Buffer.from(x.base64, 'base64'),
      })),
    });
    return reply.code(201).send(d);
  });
  app.post<IdParams>('/_buyer/disputes/:id/accept-offer', (req) => mock.buyerAcceptOffer(req.params.id));
  app.post<IdParams>('/_buyer/disputes/:id/escalate', (req) => mock.buyerEscalate(req.params.id));
}
