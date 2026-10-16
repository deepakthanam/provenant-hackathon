import Fastify, { type FastifyInstance } from 'fastify';
import { CATALOG, findProduct, type Product, SUBSTITUTES, search } from './catalog';
import { shoeImage } from './png';

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

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function productPage(prod: Product, base: string, merchantId: string): string {
  const jsonLd = {
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
  const attrs = Object.entries(prod.attributes)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td data-attr="${esc(k)}">${esc(v)}</td></tr>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(prod.title)} — Provenant demo store</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#0f172a}img{border-radius:12px;border:1px solid #e2e8f0}th{text-align:left;color:#64748b;padding-right:1rem}.price{font-size:1.6rem;font-weight:700}</style>
</head><body><p><a href="/">Provenant demo store</a></p>
<h1>${esc(prod.title)}</h1><img src="/img/${esc(prod.sku)}.png" width="320" height="200" alt="${esc(prod.title)}">
<p class="price" data-price="${esc(prod.price.value)}">$${esc(prod.price.value)}</p><p>${esc(prod.description)}</p>
<table>${attrs}<tr><th>delivery</th><td>${prod.delivery_promise.min_days}–${prod.delivery_promise.max_days} days</td></tr><tr><th>sku</th><td>${esc(prod.sku)}</td></tr></table>
</body></html>`;
}

/** The demo merchant: catalog, product pages with JSON-LD, images, and a shipping desk with a "wrong item" switch. */
export async function buildStore(opts: StoreOptions): Promise<FastifyInstance> {
  const merchantId = opts.merchantId ?? 'demo-store';
  const fetchImpl = opts.fetch ?? fetch;
  const state = { wrongItem: false };
  const app = Fastify({ logger: opts.logger ?? false });
  const images = new Map<string, Buffer>();
  const imageFor = (sku: string, photo = false) => {
    const key = `${sku}:${photo}`;
    if (!images.has(key)) {
      const prod = findProduct(sku)!;
      images.set(
        key,
        shoeImage(prod.attributes.color ?? 'grey', {
          style: prod.attributes.style?.includes('hybrid') ? 'hybrid' : prod.attributes.style,
          kind: prod.kind,
          photo,
        }),
      );
    }
    return images.get(key)!;
  };

  app.get('/healthz', async () => ({ status: 'ok', wrong_item: state.wrongItem }));

  app.get('/', async (_req, reply) => {
    const cards = CATALOG.map(
      (x) =>
        `<li><a href="/p/${x.sku}"><img src="/img/${x.sku}.png" width="160" height="100" alt=""><br>${esc(x.title)}</a> — $${x.price.value} · size ${esc(x.attributes.size ?? '')}</li>`,
    ).join('');
    return reply
      .type('text/html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><title>Provenant demo store</title><style>body{font:15px system-ui,sans-serif;max-width:900px;margin:2rem auto}ul{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;list-style:none;padding:0}</style></head><body><h1>Provenant demo store</h1><p>Wrong-item switch: <strong>${state.wrongItem ? 'ON' : 'off'}</strong></p><ul>${cards}</ul></body></html>`,
      );
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
    if (!prod) return reply.code(404).type('text/html').send('<h1>Not found</h1>');
    return reply.type('text/html; charset=utf-8').send(productPage(prod, opts.baseUrl, merchantId));
  });

  app.get<{ Params: { file: string } }>('/img/:file', async (req, reply) => {
    const sku = req.params.file.replace(/\.png$/, '');
    if (!findProduct(sku)) return reply.code(404).send();
    return reply.type('image/png').header('cache-control', 'public, max-age=3600').send(imageFor(sku));
  });

  /** A photo of an item as it arrived (what a buyer would attach to a dispute). */
  app.get<{ Params: { file: string } }>('/photo/:file', async (req, reply) => {
    const sku = req.params.file.replace(/\.png$/, '');
    if (!findProduct(sku)) return reply.code(404).send();
    return reply.type('image/png').send(imageFor(sku, true));
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
