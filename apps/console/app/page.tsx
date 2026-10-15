const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

async function getHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${API}/healthz`, { cache: 'no-store' });
    const body = (await res.json()) as Record<string, string>;
    return { ok: res.ok, detail: JSON.stringify(body) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'unreachable' };
  }
}

export default async function Home() {
  const health = await getHealth();
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Dispute queue</h1>
      <p className="text-slate-600">The queue arrives in M7. API status:</p>
      <div
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
          health.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
        }`}
        data-testid="api-health"
      >
        {health.ok ? 'API healthy' : 'API unreachable'}
        <code className="text-xs opacity-70">{health.detail}</code>
      </div>
    </section>
  );
}
