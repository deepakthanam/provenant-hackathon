import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Fastify, { type FastifyInstance } from 'fastify';
import { type ArtKind, renderPng } from './art';
import { CATALOG, findProduct, type Product, SUBSTITUTES, search } from './catalog';
import {
  AISLES,
  type AisleId,
  aisleOf,
  artStyle,
  FONT_FILES,
  homePage,
  notFoundPage,
  productPage,
} from './pages';

const require = createRequire(import.meta.url);

export interface StoreOptions {
  /** Where this store is reachable (used in links and JSON-LD). */
  baseUrl: string;
  merchantId?: string;
  /** Provenant server + merchant key, so the store records its own shipments as merchant evidence. */
  provenant?: { baseUrl: string; apiKey: string };
  fetch?: typeof fetch;
  logger?: boolean;
}

export interface FulfilRequest {
  bundle_id?: string;
  order_ref: string;
  items: Array<{ sku: string; qty: number }>;
  /** false = never ship (the "not received" case). */
  ship?: boolean;
  /** true = mark delivered immediately (demo time compression). */
  deliver?: boolean;
}

function productJsonLd(prod: Product, base: string, merchantId: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    sku: prod.sku,
    name: prod.title,
    description: prod.description,
    category: prod.category,
    color: prod.attributes.color,
    size: prod.attributes.size,
    image: `${base}/img/${prod.sku}.png`,
    additionalProperty: Object.entries(prod.attributes).map(([name, value]) => ({
      '@type': 'PropertyValue',
      name,
      value,
    })),
    offers: {
      '@type': 'Offer',
      price: prod.price.value,
      priceCurrency: prod.price.currency,
      seller: { '@type': 'Organization', identifier: merchantId },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          transitTime: {
            '@type': 'QuantitativeValue',
            minValue: prod.delivery_promise.min_days,
            maxValue: prod.delivery_promise.max_days,
            unitCode: 'DAY',
          },
        },
      },
    },
  };
}

const STOP = new Set([
  'size',
  'under',
  'for',
  'a',
  'the',
  'and',
  'pair',
  'of',
  'me',
  'buy',
  'some',
  'shoes',
  'shoe',
  'running',
]);

/** The storefront's own filter: every word of the query must appear on the box. */
function wallFilter(q: string): Product[] {
  const tokens = q
    .toLowerCase()
    .split(/[^a-z0-9/]+/)
    .filter((t) => t && !STOP.has(t));
  return CATALOG.filter((p) => {
    const hay = [p.model, p.title, p.sku, ...Object.values(p.attributes), ...p.tags].join(' ').toLowerCase();
    return tokens.every((t) => hay.includes(t) || hay.includes(t.replace(/s$/, '')));
  });
}

/** The demo merchant: catalog, product pages with JSON-LD, images, and a shipping desk with a "wrong item" switch. */
export async function buildStore(opts: StoreOptions): Promise<FastifyInstance> {
  const merchantId = opts.merchantId ?? 'demo-store';
  const fetchImpl = opts.fetch ?? fetch;
  const state = { wrongItem: false };
  const app = Fastify({ logger: opts.logger ?? false });
  const imageFor = (sku: string, photo = false) => {
    const prod = findProduct(sku)!;
    return renderPng(
      { color: prod.attributes.color ?? 'grey', kind: prod.kind as ArtKind, style: artStyle(prod) },
      photo,
    );
  };
  const fonts = new Map<string, string>(
    FONT_FILES.map(([pkg, file]) => [file, require.resolve(`@fontsource/${pkg}/files/${file}`)]),
  );

  app.get('/healthz', async () => ({ status: 'ok', wrong_item: state.wrongItem }));

  app.get<{ Querystring: { q?: string; aisle?: string } }>('/', async (req, reply) => {
    const q = (req.query.q ?? '').slice(0, 120);
    const aisle = AISLES.some((a) => a.id === req.query.aisle) ? (req.query.aisle as AisleId) : null;
    const products = wallFilter(q).filter((p) => !aisle || aisleOf(p) === aisle);
    return reply
      .type('text/html; charset=utf-8')
      .send(homePage({ products, q, aisle, wrongItem: state.wrongItem }));
  });

  app.get<{ Params: { file: string } }>('/fonts/:file', async (req, reply) => {
    const path = fonts.get(req.params.file);
    if (!path) return reply.code(404).send();
    return reply
      .type('font/woff2')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(await readFile(path));
  });

  app.get('/api/catalog', async () => ({ merchant_id: merchantId, products: CATALOG }));

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => {
    const results = search(req.query.q ?? '');
    return {
      query: req.query.q ?? '',
      results: results.map((x) => ({
        sku: x.sku,
        title: x.title,
        price: x.price,
        url: `${opts.baseUrl}/p/${x.sku}`,
      })),
    };
  });

  app.get<{ Params: { sku: string } }>('/p/:sku', async (req, reply) => {
    const prod = findProduct(req.params.sku);
    if (!prod) return reply.code(404).type('text/html; charset=utf-8').send(notFoundPage(state.wrongItem));
    return reply.type('text/html; charset=utf-8').send(
      productPage({
        product: prod,
        jsonLd: productJsonLd(prod, opts.baseUrl, merchantId),
        wrongItem: state.wrongItem,
      }),
    );
  });

  app.get<{ Params: { file: string } }>('/img/:file', async (req, reply) => {
    const sku = req.params.file.replace(/\.png$/, '');
    if (!findProduct(sku)) return reply.code(404).send();
    return reply
      .type('image/png')
      .header('cache-control', 'public, max-age=3600')
      .send(await imageFor(sku));
  });

  /** A photo of an item as it arrived (what a buyer would attach to a dispute). */
  app.get<{ Params: { file: string } }>('/photo/:file', async (req, reply) => {
    const sku = req.params.file.replace(/\.png$/, '');
    if (!findProduct(sku)) return reply.code(404).send();
    return reply.type('image/png').send(await imageFor(sku, true));
  });

  app.get('/admin/state', async () => ({ wrong_item: state.wrongItem, substitutes: SUBSTITUTES }));
  app.post<{ Body: { enabled: boolean } }>('/admin/wrong-item', async (req) => {
    state.wrongItem = Boolean(req.body?.enabled);
    return { wrong_item: state.wrongItem };
  });

  /** Ships an order. With the wrong-item switch on, a substitute SKU goes in the box. */
  app.post<{ Body: FulfilRequest }>('/api/fulfil', async (req, reply) => {
    const body = req.body;
    if (!body?.order_ref || !Array.isArray(body.items) || body.items.length === 0) {
      return reply.code(400).send({ error: 'order_ref and items are required' });
    }
    if (body.ship === false) return { shipped: false, fulfilment: null };
    const now = new Date().toISOString();
    const shipped_items = body.items.map((i) => {
      const sku = state.wrongItem ? (SUBSTITUTES[i.sku] ?? i.sku) : i.sku;
      return { sku, attributes: findProduct(sku)?.attributes ?? {} };
    });
    const fulfilment = {
      carrier: 'UPS',
      tracking_number: `1Z${body.order_ref
        .replace(/[^A-Z0-9]/gi, '')
        .slice(-10)
        .toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`,
      status: body.deliver ? 'DELIVERED' : 'SHIPPED',
      shipped_at: now,
      delivered_at: body.deliver ? now : null,
      shipped_items,
    };
    let recorded = false;
    if (body.bundle_id && opts.provenant) {
      const res = await fetchImpl(`${opts.provenant.baseUrl}/v1/bundles/${body.bundle_id}/fulfilment`, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.provenant.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(fulfilment),
      });
      recorded = res.ok;
      if (!res.ok) req.log.warn({ status: res.status }, 'could not record fulfilment in Provenant');
    }
    return {
      shipped: true,
      fulfilment,
      recorded_in_provenant: recorded,
      photo_url: `${opts.baseUrl}/photo/${shipped_items[0]!.sku}.png`,
    };
  });

  return app;
}
