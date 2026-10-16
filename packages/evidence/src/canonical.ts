/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, arrays in order.
 * Matches RFC 8785 (JCS) for the value space we use. Money is always a string, so number
 * formatting edge cases never arise. Non-JSON values are rejected rather than silently dropped,
 * because dropping them would make two different inputs hash the same.
 */
export function canonicalize(value: unknown): string {
  return write(value, '$');
}

function write(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v, i) => write(v, `${path}[${i}]`)).join(',')}]`;
      if (value instanceof Date) return JSON.stringify(value.toISOString());
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`unsupported object type at ${path}`);
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${write(v, `${path}.${k}`)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`unsupported ${typeof value} at ${path}`);
  }
}
