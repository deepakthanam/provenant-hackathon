import Link from 'next/link';
import { connection } from 'next/server';
import { AutoRefresh } from '@/components/auto-refresh';
import { Mono, Part } from '@/components/form';
import { api } from '@/lib/api';
import { money, when } from '@/lib/format';
import type { Liability } from '@/lib/types';

export default async function LiabilityPage() {
  await connection();
  const l = await api<Liability>('/v1/liability');
  return (
    <>
      <AutoRefresh every={6000} />
      <h1 className="text-[34px] font-bold leading-tight tracking-[-0.02em]">Liability by agent platform</h1>
      <p className="mt-1 max-w-[70ch] text-[16px] text-ink-2">
        Refunds paid because an AI agent acted outside what its user signed. Each entry comes from an approved
        refund on an agent-out-of-bounds verdict.
      </p>

      {l.platforms.length === 0 ? (
        <div className="poly mt-8 px-8 py-10 text-[16px]">
          No agent has overstepped a mandate yet. The overspend scenario in{' '}
          <code className="font-mono">pnpm demo</code> creates one.
        </div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {l.platforms.map((p) => (
              <div key={p.platform_id} className="border-2 border-ink bg-paper px-5 py-4">
                <div className="text-[17px] font-semibold">{p.name ?? p.platform_id}</div>
                <Mono className="text-[12.5px] text-ink-3">{p.platform_id}</Mono>
                <div className="mt-4 flex items-baseline justify-between border-t border-rule pt-3">
                  <span className="text-[14px] text-ink-2">
                    owed on {p.disputes} dispute{p.disputes === 1 ? '' : 's'}
                  </span>
                  <span className="font-mono text-[26px] font-semibold text-tape">{money(p.total)}</span>
                </div>
              </div>
            ))}
          </div>

          <Part title="Entries" aside={`${l.entries.length} posted`} id="entries">
            <table className="w-full border-collapse text-[14.5px]">
              <thead>
                <tr className="border-b-2 border-ink text-left">
                  <th className="field-label py-2 pr-4">Posted</th>
                  <th className="field-label py-2 pr-4">Platform</th>
                  <th className="field-label py-2 pr-4">Dispute</th>
                  <th className="field-label py-2 pr-4">Why</th>
                  <th className="field-label py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {l.entries.map((e) => (
                  <tr key={e.id} className="border-b border-rule">
                    <td className="py-2 pr-4">
                      <Mono className="text-[12.5px] text-ink-2">{when(e.created_at)}</Mono>
                    </td>
                    <td className="py-2 pr-4">{e.platform_id}</td>
                    <td className="py-2 pr-4">
                      <Link
                        href={`/disputes/${e.dispute_id}`}
                        className="font-mono text-[13.5px] font-semibold text-ink"
                      >
                        {e.dispute_id}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-ink-2">{e.note}</td>
                    <td className="py-2 text-right font-mono font-semibold text-tape">{money(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Part>
        </>
      )}
    </>
  );
}
