'use client';

import {
  AllCommunityModule,
  type ColDef,
  type ICellRendererParams,
  type IsFullWidthRowParams,
  ModuleRegistry,
  type RowClickedEvent,
  themeQuartz,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { ArrowRight, FileSearch, Layers, RefreshCw, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ACTION_LABEL,
  age,
  label,
  money,
  REASON_LABEL,
  STATUS_LABEL,
  VERDICT_COLOR,
  VERDICT_LABEL,
  VERDICT_MEANING,
  VERDICT_STATUS_LABEL,
  VERDICTS,
} from '@/lib/format';
import type { DisputeDetail, DisputeSummary, Verdict } from '@/lib/types';
import { Stamp } from './stamp';

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: 'var(--font-sans)',
  headerFontFamily: 'var(--font-sans)',
  fontSize: 15,
  headerFontSize: 12,
  headerFontWeight: 700,
  headerTextColor: '#4a4944',
  backgroundColor: '#f8f7f3',
  foregroundColor: '#141414',
  headerBackgroundColor: '#e8e0c9',
  oddRowBackgroundColor: '#f8f7f3',
  rowHoverColor: '#efe9d8',
  selectedRowBackgroundColor: '#ebe3cc',
  borderColor: '#cfc6ad',
  rowBorder: { color: '#d9d2bd', width: 1 },
  columnBorder: false,
  wrapperBorder: { color: '#141414', width: 2 },
  wrapperBorderRadius: 0,
  borderRadius: 2,
  rowHeight: 54,
  headerHeight: 42,
  accentColor: '#141414',
  browserColorScheme: 'light',
  spacing: 7,
});

type Row = DisputeSummary | { __group: Verdict; count: number };
const isGroup = (r: Row | undefined): r is { __group: Verdict; count: number } =>
  Boolean(r && '__group' in r);

function ExhibitCell(p: ICellRendererParams<Row>) {
  const d = p.data as DisputeSummary;
  return (
    <Link
      href={`/disputes/${d.id}`}
      className="font-mono text-[14px] font-semibold text-ink"
      onClick={(e) => e.stopPropagation()}
    >
      {d.id}
    </Link>
  );
}

function VerdictCell(p: ICellRendererParams<Row>) {
  return (
    <div className="flex h-full items-center">
      <Stamp verdict={(p.data as DisputeSummary).verdict} />
    </div>
  );
}

function ActionCell(p: ICellRendererParams<Row>) {
  const d = p.data as DisputeSummary;
  if (!d.planned_action) return <span className="text-ink-3">—</span>;
  const state = d.verdict_status ?? 'PENDING';
  return (
    <div className="flex h-full flex-col justify-center leading-tight">
      <span
        className={
          d.planned_action.available || d.planned_action.kind === 'none' ? '' : 'text-ink-3 line-through'
        }
      >
        {label(ACTION_LABEL, d.planned_action.kind)}
      </span>
      <span
        className={`text-[12px] ${state === 'EXECUTED' ? 'text-v-within' : state === 'PENDING' ? 'text-tape' : 'text-ink-3'}`}
      >
        {label(VERDICT_STATUS_LABEL, state)}
      </span>
    </div>
  );
}

function GroupRow(p: ICellRendererParams<Row>) {
  const g = p.data as { __group: Verdict; count: number };
  return (
    <div className="flex h-full items-center gap-3 border-b-2 border-ink bg-paper-2 px-4">
      <Stamp verdict={g.__group} />
      <span className="text-[13px] text-ink-2">
        {g.count} dispute{g.count === 1 ? '' : 's'} · {VERDICT_MEANING[g.__group]}
      </span>
    </div>
  );
}

export function Queue({ initial }: { initial: DisputeSummary[] }) {
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<Verdict | null>(null);
  const [grouped, setGrouped] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch('/api/v1/disputes', { cache: 'no-store' });
    if (res.ok) setRows(((await res.json()) as { items: DisputeSummary[] }).items);
  }, []);

  // The demo runs scenarios in another terminal: keep the queue live.
  useEffect(() => {
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [reload]);

  const counts = useMemo(() => {
    const c = new Map<Verdict, number>();
    for (const r of rows) if (r.verdict) c.set(r.verdict, (c.get(r.verdict) ?? 0) + 1);
    return c;
  }, [rows]);

  const data: Row[] = useMemo(() => {
    const visible = filter ? rows.filter((r) => r.verdict === filter) : rows;
    if (!grouped) return visible;
    const out: Row[] = [];
    for (const v of VERDICTS) {
      const members = visible.filter((r) => r.verdict === v);
      if (members.length) out.push({ __group: v, count: members.length }, ...members);
    }
    const unjudged = visible.filter((r) => !r.verdict);
    return [...out, ...unjudged];
  }, [rows, filter, grouped]);

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      {
        headerName: 'Exhibit',
        field: 'id' as never,
        cellRenderer: ExhibitCell,
        width: 150,
        pinned: 'left',
        filter: 'agTextColumnFilter',
      },
      {
        headerName: 'Verdict',
        field: 'verdict' as never,
        cellRenderer: VerdictCell,
        width: 230,
        filter: 'agTextColumnFilter',
      },
      {
        headerName: 'Confidence',
        field: 'confidence' as never,
        width: 120,
        type: 'rightAligned',
        cellClass: 'font-mono',
        valueFormatter: (p) => (typeof p.value === 'number' ? p.value.toFixed(2) : '—'),
        filter: 'agNumberColumnFilter',
      },
      {
        headerName: 'Planned PayPal call',
        field: 'planned_action' as never,
        cellRenderer: ActionCell,
        width: 210,
        sortable: false,
      },
      {
        headerName: 'Reason',
        field: 'reason' as never,
        width: 165,
        valueFormatter: (p) => label(REASON_LABEL, p.value),
        filter: 'agTextColumnFilter',
      },
      {
        headerName: 'Stage · status',
        field: 'status' as never,
        width: 220,
        valueGetter: (p) =>
          isGroup(p.data) ? '' : `${p.data?.stage ?? '—'} · ${label(STATUS_LABEL, p.data?.status)}`,
        filter: 'agTextColumnFilter',
      },
      {
        headerName: 'Amount',
        field: 'amount' as never,
        width: 110,
        type: 'rightAligned',
        cellClass: 'font-mono',
        valueGetter: (p) => (isGroup(p.data) ? null : Number(p.data?.amount?.value ?? 0)),
        valueFormatter: (p) => (isGroup(p.data) ? '' : money((p.data as DisputeSummary).amount)),
        filter: 'agNumberColumnFilter',
      },
      {
        headerName: 'Age',
        field: 'age_hours' as never,
        width: 90,
        type: 'rightAligned',
        cellClass: 'font-mono',
        valueFormatter: (p) => (isGroup(p.data) ? '' : age(p.value as number | null)),
        filter: 'agNumberColumnFilter',
      },
    ],
    [],
  );

  const onRowClicked = useCallback((e: RowClickedEvent<Row>) => {
    if (e.data && !isGroup(e.data)) setSelected(e.data.id);
  }, []);

  const sync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/v1/disputes/sync', { method: 'POST' });
      await reload();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="relative">
      <div className="mb-4 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filter by verdict">
        <button
          type="button"
          onClick={() => setFilter(null)}
          aria-pressed={filter === null}
          className={`rounded-[3px] border-2 px-3 py-[5px] text-[13px] font-semibold transition-colors ${
            filter === null
              ? 'border-ink bg-ink text-paper'
              : 'border-rule text-ink-2 hover:border-ink hover:text-ink'
          }`}
        >
          All <span className="font-mono">{rows.length}</span>
        </button>
        {VERDICTS.map((v) => {
          const on = filter === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setFilter(on ? null : v)}
              aria-pressed={on}
              className="rounded-[3px] border-2 px-3 py-[5px] text-[13px] font-semibold uppercase tracking-[0.05em] transition-colors"
              style={{
                borderColor: VERDICT_COLOR[v],
                color: on ? 'var(--color-paper)' : VERDICT_COLOR[v],
                backgroundColor: on ? VERDICT_COLOR[v] : 'transparent',
              }}
            >
              {VERDICT_LABEL[v]} <span className="font-mono">{counts.get(v) ?? 0}</span>
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setGrouped((g) => !g)}
            aria-pressed={grouped}
            className={`flex items-center gap-1.5 rounded-[3px] border-2 px-3 py-[5px] text-[13px] font-semibold transition-colors ${
              grouped
                ? 'border-ink bg-manila text-ink'
                : 'border-rule text-ink-2 hover:border-ink hover:text-ink'
            }`}
          >
            <Layers size={15} strokeWidth={2} aria-hidden /> Group by verdict
          </button>
          <button
            type="button"
            onClick={sync}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-[3px] border-2 border-rule px-3 py-[5px] text-[13px] font-semibold text-ink-2 transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={15} strokeWidth={2} className={syncing ? 'animate-spin' : ''} aria-hidden />{' '}
            Check PayPal now
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyQueue />
      ) : (
        <div style={{ height: Math.min(720, 46 + Math.max(data.length, 3) * 54 + 4) }}>
          <AgGridReact<Row>
            theme={theme}
            rowData={data}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: false }}
            getRowId={(p) => (isGroup(p.data) ? `group:${p.data.__group}` : p.data.id)}
            isFullWidthRow={(p: IsFullWidthRowParams<Row>) => isGroup(p.rowNode.data)}
            fullWidthCellRenderer={GroupRow}
            onRowClicked={onRowClicked}
            autoSizeStrategy={{ type: 'fitGridWidth' }}
            rowClass="cursor-pointer"
            animateRows
            suppressCellFocus={false}
          />
        </div>
      )}

      {selected ? <LabelPanel id={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function EmptyQueue() {
  return (
    <div className="poly flex flex-col items-start gap-3 px-8 py-10">
      <FileSearch size={28} strokeWidth={1.75} aria-hidden />
      <p className="max-w-[60ch] text-[16px]">
        No disputes yet. Run <code className="font-mono text-[14px]">pnpm demo</code> to place five agent
        purchases and open a dispute on each, or wait for PayPal to report one.
      </p>
    </div>
  );
}

/** Row click: the bag's label, without leaving the queue. */
function LabelPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<DisputeDetail | null>(null);
  useEffect(() => {
    let live = true;
    setD(null);
    fetch(`/api/v1/disputes/${id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((x) => live && setD(x as DisputeDetail));
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const v = d?.latest_verdict;
  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-[440px] max-w-full flex-col border-l-2 border-ink bg-paper shadow-[-12px_0_32px_rgba(20,20,20,0.12)]"
      aria-label={`Dispute ${id}`}
    >
      <div className="flex items-start justify-between border-b border-rule px-6 pb-4 pt-6">
        <div>
          <div className="font-stencil text-[30px] leading-none tracking-[0.03em]">{id}</div>
          {d ? (
            <div className="mt-2 text-[14px] text-ink-2">
              {label(REASON_LABEL, d.reason)} · {money(d.amount)} · {label(STATUS_LABEL, d.status)}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[3px] p-1.5 text-ink-2 hover:bg-manila hover:text-ink"
          aria-label="Close"
        >
          <X size={20} aria-hidden />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {!d ? (
          <p className="text-ink-3">Opening the bag…</p>
        ) : !v ? (
          <p className="text-ink-2">
            Not judged yet. The verdict appears once the evidence has been checked.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Stamp verdict={v.verdict} size="lg" />
              <span className="font-mono text-[14px] text-ink-2">{v.confidence.toFixed(2)}</span>
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{VERDICT_MEANING[v.verdict]}</p>
            <h3 className="mt-6 text-[15px] font-bold">Because</h3>
            <ul className="mt-2 space-y-2">
              {v.reasons.slice(0, 4).map((r) => (
                <li key={r.text} className="border-l-2 border-rule pl-3 text-[14px] leading-snug">
                  {r.text}
                  <div className="font-mono text-[12px] text-ink-3">{r.ref}</div>
                </li>
              ))}
            </ul>
            <h3 className="mt-6 text-[15px] font-bold">Planned PayPal call</h3>
            <p className="mt-1 text-[14px]">
              {label(ACTION_LABEL, v.recommended_action.kind)}
              {v.recommended_action.available || v.recommended_action.kind === 'none'
                ? ''
                : ' (not offered by PayPal right now)'}
            </p>
            <p className="text-[13px] text-ink-3">{label(VERDICT_STATUS_LABEL, v.status)}</p>
          </>
        )}
      </div>
      <div className="border-t border-rule px-6 py-4">
        <Link
          href={`/disputes/${id}`}
          className="flex w-full items-center justify-center gap-2 rounded-[3px] bg-ink px-4 py-3 text-[15px] font-semibold text-paper no-underline hover:bg-[#2b2b2b]"
        >
          Open the evidence bag <ArrowRight size={17} aria-hidden />
        </Link>
      </div>
    </aside>
  );
}
