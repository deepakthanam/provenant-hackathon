import type { BundleRecord, BundleStore } from '@provenant/evidence';
import type { PayPalClient } from '@provenant/paypal';
import {
  CreateBundleRequest,
  ErrorResponse,
  EvidenceBundle,
  PrepareOrderResponse,
  RecordConfirmationRequest,
  RecordDecisionRequest,
  RecordFulfilmentRequest,
  RecordOfferRequest,
  SealRequest,
  SetCartRequest,
  VerifyResult,
} from '@provenant/schemas';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { canFulfil, canRead, canWrite, type Principal, principalOf, requireKind } from '../auth';
import { syncCapture } from '../capture';
import { HttpError } from '../errors';
import { renderReceipt } from '../receipt';

const Params = z.object({ id: z.string().regex(/^apb_[0-9A-HJKMNP-TV-Z]{26}$/, 'expected apb_<ULID>') });
const errors = {
  400: ErrorResponse,
  401: ErrorResponse,
  403: ErrorResponse,
  404: ErrorResponse,
  409: ErrorResponse,
  422: ErrorResponse,
};
const security = [{ bearer: [] }];

export interface BundleRouteDeps {
  store: BundleStore;
  paypal: PayPalClient;
  authenticate: (req: FastifyRequest) => Promise<void>;
}

export async function bundleRoutes(app: FastifyInstance, deps: BundleRouteDeps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { store } = deps;

  /** Loads the bundle and applies the access rule; hides existence from callers who may not read it. */
  async function load(id: string, p: Principal, rule: (p: Principal, rec: BundleRecord) => boolean) {
    const rec = await store.get(id);
    if (!rec || !canRead(p, rec)) throw new HttpError(404, 'NOT_FOUND', `bundle ${id} not found`);
    if (!rule(p, rec)) throw new HttpError(403, 'FORBIDDEN', 'this key may not modify that bundle');
    return rec;
  }

  r.register(async (authed) => {
    const a = authed.withTypeProvider<ZodTypeProvider>();
    a.addHook('onRequest', deps.authenticate);

    a.post(
      '/v1/bundles',
      {
        schema: {
          tags: ['bundles'],
          summary: 'Create a bundle from a signed intent mandate',
          security,
          body: CreateBundleRequest,
          response: { 201: EvidenceBundle, ...errors },
        },
      },
      async (req, reply) => {
        const p = requireKind(req, 'platform');
        const rec = await store.create({
          platformId: p.platformId!,
          agentVersion: req.body.agent_version,
          userRef: req.body.user_ref,
          userPublicKey: req.body.user_public_key,
          mandate: req.body.intent_mandate,
        });
        return reply.code(201).send(rec.bundle);
      },
    );

    a.post(
      '/v1/bundles/:id/offer',
      {
        schema: {
          tags: ['bundles'],
          summary: 'Record the offer snapshot the agent saw (optionally with the product image)',
          security,
          params: Params,
          body: RecordOfferRequest,
          response: { 200: EvidenceBundle, ...errors },
        },
      },
      async (req) => {
        await load(req.params.id, principalOf(req), canWrite);
        const { image_base64, image_content_type, ...offer } = req.body;
        let image: { bytes: Uint8Array; contentType: string } | undefined;
        if (image_base64) {
          if (!image_content_type)
            throw new HttpError(400, 'VALIDATION_FAILED', 'image_content_type is required with image_base64');
          image = { bytes: Buffer.from(image_base64, 'base64'), contentType: image_content_type };
        }
        return (await store.recordOffer(req.params.id, offer, image)).bundle;
      },
    );

    a.post(
      '/v1/bundles/:id/decision',
      {
        schema: {
          tags: ['bundles'],
          summary: 'Append a step to the agent decision trace',
          security,
          params: Params,
          body: RecordDecisionRequest,
          response: { 200: EvidenceBundle, ...errors },
        },
      },
      async (req) => {
        await load(req.params.id, principalOf(req), canWrite);
        return (await store.recordDecision(req.params.id, req.body)).bundle;
      },
    );

    a.post(
      '/v1/bundles/:id/confirmation',
      {
        schema: {
          tags: ['bundles'],
          summary: "Record the user's signed confirmation (needed above confirm_above)",
          security,
          params: Params,
          body: RecordConfirmationRequest,
          response: { 200: EvidenceBundle, ...errors },
        },
      },
      async (req) => {
        await load(req.params.id, principalOf(req), canWrite);
        return (await store.recordConfirmation(req.params.id, req.body)).bundle;
      },
    );

    a.put(
      '/v1/bundles/:id/cart',
      {
        schema: {
          tags: ['bundles'],
          summary: 'Set the approved cart',
          security,
          params: Params,
          body: SetCartRequest,
          response: { 200: EvidenceBundle, ...errors },
        },
      },
      async (req) => {
        await load(req.params.id, principalOf(req), canWrite);
        return (await store.setCart(req.params.id, req.body.cart)).bundle;
      },
    );

    a.post(
      '/v1/bundles/:id/prepare-order',
      {
        schema: {
          tags: ['bundles'],
          summary: 'Check readiness and return the value for purchase_units[0].custom_id',
          security,
          params: Params,
          response: { 200: PrepareOrderResponse, ...errors },
        },
      },
      async (req) => {
        await load(req.params.id, principalOf(req), canWrite);
        return store.prepareOrder(req.params.id);
      },
    );

    a.post(
      '/v1/bundles/:id/seal',
      {
        schema: {
          tags: ['bundles'],
          summary: 'Seal the bundle to a PayPal order',
          security,
          params: Params,
          body: SealRequest,
          response: { 200: EvidenceBundle, ...errors },
        },
      },
      async (req) => {
        await load(req.params.id, principalOf(req), canWrite);
        return (await store.seal(req.params.id, req.body.paypal_order_id)).bundle;
      },
    );

    a.post(
      '/v1/bundles/:id/capture',
      {
        schema: {
          tags: ['bundles'],
          summary:
            "Record the order's capture, verified against PayPal (amount comes from PayPal, not the caller)",
          security,
          params: Params,
          body: z.object({ paypal_capture_id: z.string().min(1).max(64).optional() }),
          response: { 200: EvidenceBundle, ...errors },
        },
      },
      async (req) => {
        await load(req.params.id, principalOf(req), canFulfil);
        return (await syncCapture(store, deps.paypal, req.params.id, req.body.paypal_capture_id)).bundle;
      },
    );

    a.post(
      '/v1/bundles/:id/fulfilment',
      {
        schema: {
          tags: ['bundles'],
          summary: 'Record shipment / delivery (platform, merchant or admin)',
          security,
          params: Params,
          body: RecordFulfilmentRequest,
          response: { 200: EvidenceBundle, ...errors },
        },
      },
      async (req) => {
        await load(req.params.id, principalOf(req), canFulfil);
        return (await store.recordFulfilment(req.params.id, req.body)).bundle;
      },
    );

    a.get(
      '/v1/bundles/:id',
      {
        schema: {
          tags: ['bundles'],
          summary: 'Get a bundle (scoped to the calling platform or merchant)',
          security,
          params: Params,
          response: { 200: EvidenceBundle, ...errors },
        },
      },
      async (req) => (await load(req.params.id, principalOf(req), () => true)).bundle,
    );

    a.get(
      '/v1/bundles/:id/verify',
      {
        schema: {
          tags: ['bundles'],
          summary: 'Replay the ledger and check hashes, signatures, chain links and user signatures',
          security,
          params: Params,
          response: { 200: VerifyResult, ...errors },
        },
      },
      async (req) => {
        await load(req.params.id, principalOf(req), () => true);
        return store.verify(req.params.id);
      },
    );

    a.get(
      '/v1/bundles/by-order/:orderId',
      {
        schema: {
          tags: ['bundles'],
          summary: 'Find the bundle sealed to a PayPal order id',
          security,
          params: z.object({ orderId: z.string().min(1).max(64) }),
          response: { 200: EvidenceBundle, ...errors },
        },
      },
      async (req) => {
        const rec = await store.getByOrderId(req.params.orderId);
        if (!rec || !canRead(principalOf(req), rec))
          throw new HttpError(404, 'NOT_FOUND', 'no bundle for that order');
        return rec.bundle;
      },
    );
  });

  // Public, read-only pages. Bundle ids carry 80 random bits and bundles hold no names or emails.
  r.get(
    '/v1/bundles/:id/receipt',
    {
      schema: {
        tags: ['bundles'],
        summary: 'Buyer-readable mandate receipt (HTML)',
        params: Params,
        produces: ['text/html'],
      },
    },
    async (req, reply) => {
      const rec = await store.get(req.params.id);
      if (!rec) throw new HttpError(404, 'NOT_FOUND', 'bundle not found');
      const verify = await store.verify(req.params.id);
      return reply.type('text/html; charset=utf-8').send(renderReceipt(rec.bundle, verify));
    },
  );

  r.get(
    '/v1/blobs/:sha256',
    {
      schema: {
        tags: ['bundles'],
        summary: 'Content-addressed blob (e.g. offer snapshot image)',
        params: z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
      },
    },
    async (req, reply) => {
      const blob = await store.getBlob(req.params.sha256);
      if (!blob) throw new HttpError(404, 'NOT_FOUND', 'blob not found');
      return reply
        .type(blob.contentType)
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
        .send(Buffer.from(blob.bytes));
    },
  );
}
