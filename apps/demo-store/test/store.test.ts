import { describe, expect, it } from 'vitest';
import { search } from '../src/catalog';
import { buildStore } from '../src/store';

describe('demo store', () => {
  it('serves product pages with JSON-LD the agent can snapshot', async () => {
    const app = await buildStore({ baseUrl: 'http://store.test' });
    const res = await app.inject('/p/RUN-BLK-10');
    expect(res.statusCode).toBe(200);
    const ld = JSON.parse(res.body.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!);
    expect(ld.sku).toBe('RUN-BLK-10');
    expect(ld.color).toBe('black');
    expect(ld.offers.price).toBe('84.00');
    expect(ld.offers.shippingDetails.deliveryTime.transitTime.maxValue).toBe(5);
  });

  it('serves valid, distinct PNGs for listing and buyer photo', async () => {
    const app = await buildStore({ baseUrl: 'http://store.test' });
    const img = await app.inject('/img/RUN-BLK-10.png');
    const photo = await app.inject('/photo/RUN-BLK-10.png');
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.rawPayload.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(img.rawPayload.equals(photo.rawPayload)).toBe(false);
  });

  it('finds running shoes', () => {
    const skus = search('black running shoes size 10').map((p) => p.sku);
    expect(skus).toContain('RUN-BLK-10');
    expect(skus).toContain('ROAD-BLK-10');
  });

  it('ships a substitute when the wrong-item switch is on', async () => {
    const app = await buildStore({ baseUrl: 'http://store.test' });
    const ok = await app.inject({
      method: 'POST',
      url: '/api/fulfil',
      payload: { order_ref: 'O1', items: [{ sku: 'RUN-BLK-10', qty: 1 }], deliver: true },
    });
    expect(ok.json().fulfilment.shipped_items[0].sku).toBe('RUN-BLK-10');
    expect(ok.json().fulfilment.status).toBe('DELIVERED');
    await app.inject({ method: 'POST', url: '/admin/wrong-item', payload: { enabled: true } });
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/fulfil',
      payload: { order_ref: 'O2', items: [{ sku: 'RUN-BLK-10', qty: 1 }] },
    });
    expect(wrong.json().fulfilment.shipped_items[0]).toEqual({
      sku: 'RUN-BLU-10',
      attributes: expect.objectContaining({ color: 'blue' }),
    });
    expect(wrong.json().photo_url).toBe('http://store.test/photo/RUN-BLU-10.png');
  });

  it('can decline to ship', async () => {
    const app = await buildStore({ baseUrl: 'http://store.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/fulfil',
      payload: { order_ref: 'O3', items: [{ sku: 'RUN-BLK-10', qty: 1 }], ship: false },
    });
    expect(res.json()).toEqual({ shipped: false, fulfilment: null });
  });
});
