import { z } from 'zod';

export const IsoDateTime = z.iso.datetime({ offset: true });

/** PayPal-style money: decimal string with at most two fraction digits. */
export const Money = z.object({
  value: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'expected a decimal amount like "84.00"'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'expected an ISO 4217 currency code'),
});
export type Money = z.infer<typeof Money>;

/** `ed25519:<base64>` */
export const Ed25519Sig = z.string().regex(/^ed25519:[A-Za-z0-9+/]+=*$/, 'expected ed25519:<base64>');
/** `sha256:<64 hex>` */
export const Sha256Ref = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'expected sha256:<hex>');
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/** Converts money to integer minor units (cents) so comparisons never touch floats. */
export function toMinor(m: Money): number {
  const [whole = '0', frac = ''] = m.value.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function fromMinor(minor: number, currency: string): Money {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minor));
  return { value: `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`, currency };
}

export function sumMoney(items: Money[], currency: string): Money {
  let total = 0;
  for (const m of items) {
    if (m.currency !== currency) throw new Error(`currency mismatch: ${m.currency} vs ${currency}`);
    total += toMinor(m);
  }
  return fromMinor(total, currency);
}
