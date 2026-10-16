import { type NextRequest, NextResponse } from 'next/server';

/**
 * Optional gate for deployed consoles: when CONSOLE_PASSWORD is set, every page and /api route
 * needs HTTP Basic auth (any username). Locally it is unset and the console is open.
 */
export function proxy(request: NextRequest) {
  const password = process.env.CONSOLE_PASSWORD;
  if (!password) return NextResponse.next();
  const header = request.headers.get('authorization') ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = atob(encoded);
    if (decoded.slice(decoded.indexOf(':') + 1) === password) return NextResponse.next();
  }
  return new NextResponse('Provenant console: sign in required.', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="Provenant console", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
