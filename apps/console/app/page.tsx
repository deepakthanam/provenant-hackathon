import { connection } from 'next/server';
import { Queue } from '@/components/queue';
import { api } from '@/lib/api';
import type { DisputeSummary } from '@/lib/types';

export default async function DisputesPage() {
  await connection();
  let items: DisputeSummary[] = [];
  let error: string | null = null;
  try {
    items = (await api<{ items: DisputeSummary[] }>('/v1/disputes')).items;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const awaiting = items.filter(
    (d) => d.verdict_status === 'PENDING' && d.planned_action?.kind !== 'none',
  ).length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-bold leading-tight tracking-[-0.02em]">Dispute queue</h1>
          <p className="mt-1 max-w-[70ch] text-[16px] text-ink-2">
            Every dispute on an order an AI agent placed, judged against the evidence sealed at purchase.
            {awaiting > 0 ? (
              <>
                {' '}
                <span className="font-semibold text-tape">{awaiting} waiting for your approval.</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
      {error ? (
        <div className="border-2 border-tape px-6 py-5 text-[15px]">
          <p className="font-semibold text-tape">The Provenant API is not answering.</p>
          <p className="mt-1 text-ink-2">
            {error}. Start it with <code className="font-mono">pnpm dev</code>, then reload.
          </p>
        </div>
      ) : (
        <Queue initial={items} />
      )}
    </>
  );
}
