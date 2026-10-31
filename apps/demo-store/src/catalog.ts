export interface Product {
  sku: string;
  /** Model name shown on the box (presentation only; the agent reads `title`). */
  model: string;
  title: string;
  description: string;
  category: 'footwear' | 'apparel';
  price: { value: string; currency: 'USD' };
  attributes: Record<string, string>;
  delivery_promise: { min_days: number; max_days: number };
  kind: 'shoe' | 'boot' | 'socks';
  tags: string[];
}

const p = (x: Omit<Product, 'price'> & { price: string }): Product => ({
  ...x,
  price: { value: x.price, currency: 'USD' },
});

/** Eight products: enough for the agent to compare and for each scenario to have a plausible pick. */
export const CATALOG: Product[] = [
  p({
    sku: 'RUN-BLK-10',
    model: 'Ridgeback Trail',
    title: 'Trail runner, black',
    description: 'Lugged trail running shoe with a rock plate. Black mesh upper.',
    category: 'footwear',
    price: '84.00',
    attributes: { color: 'black', size: '10', style: 'trail', material: 'mesh' },
    delivery_promise: { min_days: 3, max_days: 5 },
    kind: 'shoe',
    tags: ['running', 'shoes', 'trail', 'black'],
  }),
  p({
    sku: 'RUN-BLU-10',
    model: 'Ridgeback Trail',
    title: 'Trail runner, blue',
    description: 'Lugged trail running shoe with a rock plate. Blue mesh upper.',
    category: 'footwear',
    price: '84.00',
    attributes: { color: 'blue', size: '10', style: 'trail', material: 'mesh' },
    delivery_promise: { min_days: 3, max_days: 5 },
    kind: 'shoe',
    tags: ['running', 'shoes', 'trail', 'blue'],
  }),
  p({
    sku: 'RUN-BLK-9',
    model: 'Ridgeback Trail',
    title: 'Trail runner, black',
    description: 'Lugged trail running shoe with a rock plate. Black mesh upper.',
    category: 'footwear',
    price: '84.00',
    attributes: { color: 'black', size: '9', style: 'trail', material: 'mesh' },
    delivery_promise: { min_days: 3, max_days: 5 },
    kind: 'shoe',
    tags: ['running', 'shoes', 'trail', 'black'],
  }),
  p({
    sku: 'ROAD-BLK-10',
    model: 'Tempo Road',
    title: 'Road racer, black',
    description: 'Light road running shoe with a foam midsole. Black knit upper.',
    category: 'footwear',
    price: '65.00',
    attributes: { color: 'black', size: '10', style: 'road', material: 'knit' },
    delivery_promise: { min_days: 2, max_days: 4 },
    kind: 'shoe',
    tags: ['running', 'shoes', 'road', 'black'],
  }),
  p({
    sku: 'HYB-BLK-10',
    model: 'Doorstep Hybrid',
    title: 'Trail/road hybrid runner, black',
    description: 'Door-to-trail hybrid: road cushioning with a light trail outsole. Black upper.',
    category: 'footwear',
    price: '72.00',
    attributes: { color: 'black', size: '10', style: 'trail/road hybrid', material: 'mesh' },
    delivery_promise: { min_days: 3, max_days: 6 },
    kind: 'shoe',
    tags: ['running', 'shoes', 'hybrid', 'trail', 'road', 'black'],
  }),
  p({
    sku: 'PRO-BLK-10',
    model: 'Carbon Pro',
    title: 'Carbon racer pro, black',
    description: 'Carbon-plated marathon racer. Black.',
    category: 'footwear',
    price: '189.00',
    attributes: { color: 'black', size: '10', style: 'road', material: 'knit' },
    delivery_promise: { min_days: 2, max_days: 3 },
    kind: 'shoe',
    tags: ['running', 'shoes', 'road', 'racing', 'black'],
  }),
  p({
    sku: 'BOOT-BRN-10',
    model: 'Fellside Boot',
    title: 'Hiking boot, brown',
    description: 'Waterproof leather hiking boot. Brown.',
    category: 'footwear',
    price: '119.00',
    attributes: { color: 'brown', size: '10', style: 'hiking', material: 'leather' },
    delivery_promise: { min_days: 4, max_days: 7 },
    kind: 'boot',
    tags: ['hiking', 'boots', 'brown'],
  }),
  p({
    sku: 'SOCK-RUN-3PK',
    model: 'Long Run Sock',
    title: 'Running socks (3 pack)',
    description: 'Cushioned running socks, three pairs. Black.',
    category: 'apparel',
    price: '18.00',
    attributes: { color: 'black', size: 'L', style: 'crew', material: 'merino blend' },
    delivery_promise: { min_days: 2, max_days: 4 },
    kind: 'socks',
    tags: ['running', 'socks', 'black'],
  }),
];

/** What gets shipped instead when the "wrong item" switch is on (same model, other colour). */
export const SUBSTITUTES: Record<string, string> = { 'RUN-BLK-10': 'RUN-BLU-10', 'RUN-BLU-10': 'RUN-BLK-10' };

export function findProduct(sku: string): Product | undefined {
  return CATALOG.find((x) => x.sku === sku);
}

/** Naive keyword search: every query token must match a tag, attribute, title word or category. */
export function search(q: string): Product[] {
  const tokens = q
    .toLowerCase()
    .split(/[^a-z0-9/]+/)
    .filter(
      (t) => t && !['size', 'under', 'for', 'a', 'the', 'and', 'pair', 'of', 'me', 'buy', 'some'].includes(t),
    );
  if (tokens.length === 0) return CATALOG;
  return CATALOG.filter((prod) => {
    const hay = new Set(
      [
        ...prod.tags,
        prod.category,
        ...Object.values(prod.attributes),
        ...prod.title.toLowerCase().split(/[^a-z0-9/]+/),
      ].map((s) => s.toLowerCase()),
    );
    return tokens.some((t) => hay.has(t) || hay.has(t.replace(/s$/, '')));
  });
}
