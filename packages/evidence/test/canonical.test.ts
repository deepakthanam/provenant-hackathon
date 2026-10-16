import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/canonical';
import { hashCanonical } from '../src/crypto';

describe('canonicalize', () => {
  it('sorts keys at every depth and drops whitespace', () => {
    expect(canonicalize({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('is independent of key insertion order', () => {
    const a = { amount: { value: '84.00', currency: 'USD' }, sku: 'RUN-BLK-10' };
    const b = { sku: 'RUN-BLK-10', amount: { currency: 'USD', value: '84.00' } };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(hashCanonical(a)).toBe(hashCanonical(b));
  });

  it('keeps array order significant', () => {
    expect(hashCanonical([1, 2])).not.toBe(hashCanonical([2, 1]));
  });

  it('escapes strings like JSON and handles unicode', () => {
    expect(canonicalize({ t: 'line\n"quote" — ünï' })).toBe('{"t":"line\\n\\"quote\\" — ünï"}');
  });

  it('omits undefined object members but rejects non-JSON values', () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
    expect(() => canonicalize({ n: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalize({ f: () => 1 })).toThrow(/unsupported/);
    expect(() => canonicalize({ m: new Map() })).toThrow(/unsupported object/);
  });

  it('produces sha256:<hex> hashes', () => {
    expect(hashCanonical({})).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
