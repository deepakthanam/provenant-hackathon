import 'server-only';
import { loadEnv } from '@provenant/config';

/**
 * Server-side client for the Provenant API. The console holds an admin key on the server only;
 * the browser talks to /api/* route handlers, never to the API with a key.
 */
export function apiBase(): string {
  return loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = loadEnv();
  const key = env.PROVENANT_ADMIN_API_KEY ?? env.PROVENANT_MERCHANT_API_KEY;
  if (!key) throw new ApiError(500, 'NO_KEY', 'PROVENANT_ADMIN_API_KEY is not set; run `pnpm bootstrap`.');
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${key}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, body.error ?? 'ERROR', body.message ?? res.statusText);
  }
  return (await res.json()) as T;
}

/** Fetch that resolves to null on 404 (and on an unreachable API, for empty states). */
export async function apiOrNull<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export function paypalMode(): string {
  return loadEnv().PAYPAL_MODE;
}
