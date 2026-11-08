'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: 'Disputes', match: (p: string) => p === '/' || p.startsWith('/disputes') },
  { href: '/liability', label: 'Liability', match: (p: string) => p.startsWith('/liability') },
  { href: '/bundles', label: 'Bundles', match: (p: string) => p.startsWith('/bundles') },
  { href: '/guide', label: 'How to use', match: (p: string) => p.startsWith('/guide') },
];

export function TopBand({ mode }: { mode: string }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b-2 border-ink bg-paper/95 backdrop-blur-[2px]">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-10 px-8">
        <Link href="/" className="flex items-baseline gap-2 no-underline">
          <span className="font-stencil text-[22px] leading-none tracking-[0.06em]">PROVENANT</span>
        </Link>
        <nav className="flex h-full items-stretch gap-1" aria-label="Main">
          {NAV.map((n) => {
            const active = n.match(path);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center border-b-[3px] px-3 text-[15px] no-underline transition-colors ${
                  active
                    ? 'border-tape font-semibold text-ink'
                    : 'border-transparent text-ink-2 hover:text-ink'
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-[13px] text-ink-2">
          <span>PayPal</span>
          <span className="rounded-[3px] border border-ink px-1.5 py-[1px] font-mono text-[12px] uppercase text-ink">
            {mode}
          </span>
        </div>
      </div>
    </header>
  );
}
