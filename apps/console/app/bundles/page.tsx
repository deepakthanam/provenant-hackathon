import { Search } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Mono } from '@/components/form';
import { api, apiOrNull } from '@/lib/api';
import { money, when } from '@/lib/format';
import type { Bundle, BundleListItem } from '@/lib/types';

export default async function BundlesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await connection();
  const { q } = await searchParams;
  let notFoundQuery: string | null = null;
  if (q?.trim()) {
    const term = q.trim();
    if (/^apb_/i.test(term)) redirect(`/bundles/${term}`);
    const byOrder = await apiOrNull<Bundle>(`/v1/bundles/by-order/${encodeURIComponent(term)}`);
    if (byOrder) redirect(`/bundles/${byOrder.bundle_id}`);
    notFoundQuery = term;
  }
  const { items } = await api<{ items: BundleListItem[] }>('/v1/bundles?limit=50');

  return (
    <>
      <h1 className="text-[34px] font-bold leading-tight tracking-[-0.02em]">Evidence bundles</h1>
      <p className="mt-1 max-w-[70ch] text-[16px] text-ink-2">
        Every bundle an agent sealed at purchase. Look one up by PayPal order id or bundle id and re-check its
        seal.
      </p>

      <form action="/bundles" className="mt-6 flex max-w-[640px] gap-2" aria-label="Find a bundle">
        <label htmlFor="q" className="sr-only">
          PayPal order id or bundle id
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q ?? ''}
          placeholder="PayPal order id (e.g. 5O190127TN364715T) or apb_…"
          className="flex-1 rounded-[3px] border-2 border-ink bg-paper px-3 py-2.5 font-mono text-[14px] placeholder:font-sans placeholder:text-ink-3 focus:outline-none"
        />
        <button
          type="submit"
          className="flex items-center gap-2 rounded-[3px] bg-ink px-4 text-[15px] font-semibold text-paper hover:bg-[#2b2b2b]"
        >
          <Search size={16} aria-hidden /> Find
        </button>
      </form>
      {notFoundQuery ? (
        <p className="mt-3 text-[15px] text-tape" role="status">
          No bundle is sealed to <Mono>{notFoundQuery}</Mono>. PayPal orders that no agent placed through
          Provenant have no bundle.
        </p>
      ) : null}

      <table className="mt-8 w-full border-collapse text-[14.5px]">
        <thead>
          <tr className="border-b-2 border-ink text-left">
            <th className="field-label py-2 pr-4">Bundle</th>
            <th className="field-label py-2 pr-4">Item</th>
            <th className="field-label py-2 pr-4">PayPal order</th>
            <th className="field-label py-2 pr-4">State</th>
            <th className="field-label py-2 pr-4">Opened</th>
            <th className="field-label py-2 text-right">Charged</th>
          </tr>
        </thead>
        <tbody>
          {items.map((b) => (
            <tr key={b.bundle_id} className="border-b border-rule hover:bg-paper-2">
              <td className="py-2 pr-4">
                <Link
                  href={`/bundles/${b.bundle_id}`}
                  className="font-mono text-[13px] font-semibold text-ink"
                >
                  {b.bundle_id}
                </Link>
              </td>
              <td className="py-2 pr-4">{b.title ?? <span className="text-ink-3">no offer yet</span>}</td>
              <td className="py-2 pr-4">
                <Mono className="text-[13px]">{b.paypal_order_id ?? '—'}</Mono>
              </td>
              <td className="py-2 pr-4">{b.status.toLowerCase()}</td>
              <td className="py-2 pr-4">
                <Mono className="text-[12.5px] text-ink-2">{when(b.created_at)}</Mono>
              </td>
              <td className="py-2 text-right font-mono">{money(b.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 ? (
        <p className="mt-4 text-ink-2">
          No bundles yet. Run <code className="font-mono">pnpm agent</code> to place an agent purchase.
        </p>
      ) : null}
    </>
  );
}
