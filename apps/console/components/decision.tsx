'use client';

import { Check, ChevronDown, CircleSlash, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ACTION_LABEL, ACTION_PATH, label, money, VERDICT_STATUS_LABEL } from '@/lib/format';
import type { VerdictView } from '@/lib/types';

type Mode = 'idle' | 'override' | 'reject';

const OVERRIDE_KINDS = [
  'accept_claim',
  'make_offer',
  'provide_evidence',
  'send_message',
  'provide_supporting_info',
] as const;

/**
 * The planned PayPal call, shown exactly as it will be sent, with the merchant's three choices.
 * Nothing reaches PayPal until someone presses Approve (or AUTO_ACTION is on).
 */
export function Decision({
  disputeId,
  verdict,
  disputeAmount,
}: {
  disputeId: string;
  verdict: VerdictView;
  disputeAmount: string;
}) {
  const router = useRouter();
  const plan = verdict.recommended_action;
  const decided = !['PENDING', 'FAILED'].includes(verdict.status);
  const canApprove = !decided && plan.kind !== 'none' && plan.available;
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [reason, setReason] = useState('');
  const [ov, setOv] = useState<{
    kind: (typeof OVERRIDE_KINDS)[number];
    type: string;
    amount: string;
    text: string;
  }>({
    kind: 'accept_claim',
    type: 'REFUND',
    amount: disputeAmount,
    text: '',
  });

  const post = async (path: string, body: unknown, okText: string) => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/disputes/${disputeId}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { message?: string; action?: { request_id?: string | null } };
      if (!res.ok) setResult({ ok: false, text: json.message ?? `PayPal call not sent (${res.status})` });
      else {
        setResult({
          ok: true,
          text: json.action?.request_id ? `${okText} PayPal-Request-Id ${json.action.request_id}` : okText,
        });
        setMode('idle');
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const overrideBody = () => {
    switch (ov.kind) {
      case 'accept_claim':
        return {
          kind: 'accept_claim',
          accept_claim_type: ov.type,
          ...(ov.type === 'PARTIAL_REFUND'
            ? { refund_amount: { currency_code: 'USD', value: ov.amount } }
            : {}),
          ...(ov.text ? { note: ov.text } : {}),
        };
      case 'make_offer':
        return {
          kind: 'make_offer',
          offer_type: 'REFUND',
          offer_amount: { currency_code: 'USD', value: ov.amount },
          ...(ov.text ? { note: ov.text } : {}),
        };
      case 'send_message':
        return { kind: 'send_message', message: ov.text || 'Thank you, we are reviewing this.' };
      default:
        return { kind: ov.kind, ...(ov.text ? { notes: ov.text } : {}) };
    }
  };

  const request = plan.request ? { ...plan.request } : null;
  const files = request && Array.isArray(request.files) ? (request.files as string[]) : [];
  if (request) delete request.files;

  return (
    <div className="border-2 border-ink bg-paper">
      <div className="border-b border-rule bg-manila px-5 py-3">
        <div className="field-label">Planned PayPal call</div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="text-[19px] font-bold">{label(ACTION_LABEL, plan.kind)}</span>
          <span
            className={`text-[13px] font-semibold ${verdict.status === 'EXECUTED' ? 'text-v-within' : verdict.status === 'PENDING' ? 'text-tape' : 'text-ink-2'}`}
          >
            {label(VERDICT_STATUS_LABEL, verdict.status)}
          </span>
        </div>
      </div>
      <div className="px-5 py-4">
        <p className="text-[14px] leading-relaxed text-ink-2">{plan.explanation}</p>
        {plan.kind !== 'none' ? (
          <>
            <div className="mt-3 font-mono text-[12.5px] text-ink">
              <span className="font-semibold">POST</span> /v1/customer/disputes/{disputeId}/
              {ACTION_PATH[plan.kind]}
            </div>
            {request ? (
              <pre className="mt-2 max-h-[260px] overflow-auto border border-rule bg-paper-2 px-3 py-2 font-mono text-[12.5px] leading-relaxed">
                {JSON.stringify(request, null, 2)}
              </pre>
            ) : null}
            {files.length ? (
              <div className="mt-2 text-[13px] text-ink-2">
                + attached file <span className="font-mono text-ink">{files.join(', ')}</span> (multipart)
              </div>
            ) : null}
            {plan.refund_amount ? (
              <div className="mt-2 text-[14px]">
                Refund to buyer <span className="font-mono font-semibold">{money(plan.refund_amount)}</span>
                {plan.liability ? (
                  <span className="text-tape">
                    {' '}
                    · booked against <span className="font-semibold">{plan.liability.platform_id}</span>
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {result ? (
          <p
            className={`mt-3 border-l-2 pl-3 text-[14px] ${result.ok ? 'border-v-within text-v-within' : 'border-tape text-tape'}`}
            role="status"
          >
            {result.text}
          </p>
        ) : null}
        {verdict.status === 'FAILED' && !result && verdict.paypal_response ? (
          <p className="mt-3 border-l-2 border-tape pl-3 text-[14px] text-tape">
            Last attempt not sent:{' '}
            {(verdict.paypal_response as { message?: string }).message ?? 'PayPal refused the call'}
          </p>
        ) : null}
        {verdict.status === 'EXECUTED' && verdict.approved_by ? (
          <p className="mt-3 text-[13px] text-ink-2">Approved by {verdict.approved_by}.</p>
        ) : null}
        {verdict.status === 'REJECTED' ? (
          <p className="mt-3 text-[13px] text-ink-2">
            Rejected by {verdict.approved_by}:{' '}
            {(verdict.executed_action as { reason?: string } | null)?.reason}
          </p>
        ) : null}
      </div>

      {!decided ? (
        <div className="border-t border-rule px-5 py-4">
          {mode === 'idle' ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={!canApprove || busy}
                onClick={() => post('approve', {}, 'Sent to PayPal.')}
                className="flex items-center justify-center gap-2 rounded-[3px] bg-ink px-4 py-3 text-[16px] font-semibold text-paper transition-colors hover:bg-[#2b2b2b] disabled:cursor-not-allowed disabled:bg-ink-3"
              >
                <Check size={18} aria-hidden />{' '}
                {busy
                  ? 'Sending to PayPal…'
                  : plan.kind === 'none'
                    ? 'Nothing to approve'
                    : 'Approve and send'}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('override')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-[3px] border-2 border-ink px-3 py-2 text-[14px] font-semibold hover:bg-manila"
                >
                  <Pencil size={15} aria-hidden /> Override
                </button>
                <button
                  type="button"
                  onClick={() => setMode('reject')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-[3px] border-2 border-rule px-3 py-2 text-[14px] font-semibold text-ink-2 hover:border-ink hover:text-ink"
                >
                  <CircleSlash size={15} aria-hidden /> Reject
                </button>
              </div>
            </div>
          ) : mode === 'reject' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void post('reject', { reason }, 'Rejected. No PayPal call was made.');
              }}
            >
              <label className="field-label" htmlFor="reject-reason">
                Why reject this verdict?
              </label>
              <textarea
                id="reject-reason"
                required
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-[3px] border-2 border-rule bg-paper-2 px-3 py-2 text-[14px] focus:border-ink focus:outline-none"
                placeholder="e.g. I will contact the buyer directly"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 rounded-[3px] bg-ink px-3 py-2 text-[14px] font-semibold text-paper disabled:opacity-60"
                >
                  Reject verdict
                </button>
                <button
                  type="button"
                  onClick={() => setMode('idle')}
                  className="rounded-[3px] px-3 py-2 text-[14px] text-ink-2 hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void post('approve', { action_override: overrideBody() }, 'Override sent to PayPal.');
              }}
              className="space-y-3"
            >
              <div>
                <label className="field-label" htmlFor="ov-kind">
                  Send instead
                </label>
                <div className="relative mt-1">
                  <select
                    id="ov-kind"
                    value={ov.kind}
                    onChange={(e) =>
                      setOv({ ...ov, kind: e.target.value as (typeof OVERRIDE_KINDS)[number] })
                    }
                    className="w-full appearance-none rounded-[3px] border-2 border-rule bg-paper-2 px-3 py-2 pr-8 text-[14px] focus:border-ink focus:outline-none"
                  >
                    {OVERRIDE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {label(ACTION_LABEL, k)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute right-2.5 top-3 text-ink-2"
                    aria-hidden
                  />
                </div>
              </div>
              {ov.kind === 'accept_claim' ? (
                <div>
                  <label className="field-label" htmlFor="ov-type">
                    Claim type
                  </label>
                  <select
                    id="ov-type"
                    value={ov.type}
                    onChange={(e) => setOv({ ...ov, type: e.target.value })}
                    className="mt-1 w-full rounded-[3px] border-2 border-rule bg-paper-2 px-3 py-2 text-[14px] focus:border-ink focus:outline-none"
                  >
                    <option value="REFUND">Full refund</option>
                    <option value="REFUND_WITH_RETURN">Refund with return</option>
                    <option value="PARTIAL_REFUND">Partial refund</option>
                  </select>
                </div>
              ) : null}
              {(ov.kind === 'make_offer' || (ov.kind === 'accept_claim' && ov.type === 'PARTIAL_REFUND')) && (
                <div>
                  <label className="field-label" htmlFor="ov-amount">
                    Amount (USD)
                  </label>
                  <input
                    id="ov-amount"
                    inputMode="decimal"
                    pattern="\d+(\.\d{1,2})?"
                    value={ov.amount}
                    onChange={(e) => setOv({ ...ov, amount: e.target.value })}
                    className="mt-1 w-full rounded-[3px] border-2 border-rule bg-paper-2 px-3 py-2 font-mono text-[14px] focus:border-ink focus:outline-none"
                  />
                </div>
              )}
              <div>
                <label className="field-label" htmlFor="ov-text">
                  {ov.kind === 'send_message' ? 'Message to the buyer' : 'Note'}
                </label>
                <textarea
                  id="ov-text"
                  rows={2}
                  value={ov.text}
                  onChange={(e) => setOv({ ...ov, text: e.target.value })}
                  className="mt-1 w-full rounded-[3px] border-2 border-rule bg-paper-2 px-3 py-2 text-[14px] focus:border-ink focus:outline-none"
                />
              </div>
              <p className="text-[12.5px] text-ink-3">
                PayPal must offer this response on the dispute right now, or nothing is sent.
              </p>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 rounded-[3px] bg-ink px-3 py-2 text-[14px] font-semibold text-paper disabled:opacity-60"
                >
                  {busy ? 'Sending…' : 'Approve override'}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('idle')}
                  className="rounded-[3px] px-3 py-2 text-[14px] text-ink-2 hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
