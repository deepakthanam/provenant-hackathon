import type { MockPayPal } from './mock';
import type { Dispute, DisputeReason, DisputeStage, EvidenceFile, Order, PayPalMoney } from './types';

export interface OpenDisputeInput {
  capture_id: string;
  reason: DisputeReason;
  message: string;
  stage?: DisputeStage;
  amount?: PayPalMoney;
  documents?: EvidenceFile[];
}

/**
 * The buyer's side of the mock: approving checkout, opening disputes, accepting offers.
 * (In the real sandbox these are done by logging in as the sandbox personal account.)
 */
export interface MockBuyer {
  approveOrder(orderId: string): Promise<Order>;
  openDispute(input: OpenDisputeInput): Promise<Dispute>;
  acceptOffer(disputeId: string): Promise<Dispute>;
  escalate(disputeId: string): Promise<Dispute>;
}

export function directBuyer(mock: MockPayPal): MockBuyer {
  return {
    approveOrder: (id) => mock.buyerApproveOrder(id),
    openDispute: (i) => mock.buyerOpenDispute(i),
    acceptOffer: (id) => mock.buyerAcceptOffer(id),
    escalate: (id) => mock.buyerEscalate(id),
  };
}

/** Drives the mock's `/_buyer` routes, for processes outside the server (agent, scenarios). */
export function httpBuyer(mockBaseUrl: string, fetchImpl: typeof fetch = fetch): MockBuyer {
  const post = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetchImpl(`${mockBaseUrl}/_buyer${path}`, {
      method: 'POST',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as T & { message?: string };
    if (!res.ok) throw new Error(`mock buyer ${path} failed (${res.status}): ${json.message ?? ''}`);
    return json;
  };
  return {
    approveOrder: (id) => post(`/orders/${encodeURIComponent(id)}/approve`),
    openDispute: (i) =>
      post('/disputes', {
        capture_id: i.capture_id,
        reason: i.reason,
        message: i.message,
        stage: i.stage,
        amount: i.amount,
        documents: i.documents?.map((d) => ({
          name: d.name,
          content_type: d.contentType,
          base64: Buffer.from(d.bytes).toString('base64'),
        })),
      }),
    acceptOffer: (id) => post(`/disputes/${encodeURIComponent(id)}/accept-offer`),
    escalate: (id) => post(`/disputes/${encodeURIComponent(id)}/escalate`),
  };
}
