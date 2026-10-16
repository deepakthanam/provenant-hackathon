import { loadEnv } from '@provenant/config';
import { NextResponse } from 'next/server';
import { ApiError, apiBase } from '@/lib/api';

/**
 * Narrow proxy from the browser to the Provenant API. The admin key is added here, on the
 * server, and only the console's own read and decision endpoints are reachable.
 */
const ALLOWED: Array<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^v1\/disputes$/ },
  { method: 'GET', pattern: /^v1\/disputes\/[\w-]+$/ },
  { method: 'GET', pattern: /^v1\/disputes\/[\w-]+\/report\.pdf$/ },
  { method: 'POST', pattern: /^v1\/disputes\/[\w-]+\/(approve|reject|adjudicate)$/ },
  { method: 'POST', pattern: /^v1\/disputes\/sync$/ },
  { method: 'GET', pattern: /^v1\/liability$/ },
  { method: 'GET', pattern: /^v1\/bundles(\/[\w-]+(\/verify)?)?$/ },
  { method: 'GET', pattern: /^v1\/bundles\/by-order\/[\w-]+$/ },
];

async function forward(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.join('/');
  if (!ALLOWED.some((a) => a.method === req.method && a.pattern.test(joined))) {
    return NextResponse.json({ error: 'NOT_ALLOWED', message: 'not a console endpoint' }, { status: 404 });
  }
  const env = loadEnv();
  const key = env.PROVENANT_ADMIN_API_KEY ?? env.PROVENANT_MERCHANT_API_KEY;
  if (!key) return NextResponse.json(new ApiError(500, 'NO_KEY', 'no API key configured'), { status: 500 });
  const url = new URL(req.url);
  const body = req.method === 'POST' ? await req.text() : undefined;
  const res = await fetch(`${apiBase()}/${joined}${url.search}`, {
    method: req.method,
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body || undefined,
  });
  return new NextResponse(res.body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
      ...(res.headers.get('content-disposition')
        ? { 'content-disposition': res.headers.get('content-disposition')! }
        : {}),
    },
  });
}

export const GET = forward;
export const POST = forward;
