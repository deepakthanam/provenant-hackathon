/** A product page as the agent saw it: parsed from the page's schema.org JSON-LD. */
export interface Offer {
  sku: string;
  title: string;
  url: string;
  merchantId: string;
  category: string;
  price: { value: string; currency: string };
  attributes: Record<string, string>;
  deliveryPromise: { minDays: number; maxDays: number };
  imageUrl: string;
}

export async function searchStore(
  storeUrl: string,
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const res = await fetchImpl(`${storeUrl}/api/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`store search failed: ${res.status}`);
  const body = (await res.json()) as { results: Array<{ url: string }> };
  return body.results.map((r) => r.url);
}

/** Fetches a product page and reads its JSON-LD (what a browsing agent would capture). */
export async function snapshotPage(url: string, fetchImpl: typeof fetch = fetch): Promise<Offer> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`could not load ${url}: ${res.status}`);
  const html = await res.text();
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  if (!raw) throw new Error(`${url} has no product JSON-LD`);
  const ld = JSON.parse(raw) as Record<string, any>;
  const attributes: Record<string, string> = {};
  for (const p of ld.additionalProperty ?? []) attributes[String(p.name)] = String(p.value);
  const transit = ld.offers?.shippingDetails?.deliveryTime?.transitTime ?? {};
  return {
    sku: String(ld.sku),
    title: String(ld.name),
    url,
    merchantId: String(ld.offers?.seller?.identifier ?? new URL(url).host),
    category: String(ld.category),
    price: { value: String(ld.offers.price), currency: String(ld.offers.priceCurrency) },
    attributes,
    deliveryPromise: { minDays: Number(transit.minValue ?? 0), maxDays: Number(transit.maxValue ?? 0) },
    imageUrl: String(ld.image),
  };
}

export async function fetchBytes(url: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`could not fetch ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
